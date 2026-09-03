'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  eventListings,
  eventRosterSnapshots,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db'
import type { RosterTeam } from '@the-tool-pit/db'
import { queueNotification } from '@the-tool-pit/db'
import {
  claimListingUrl,
  removeListingUrl,
  type ApprovalEmailPayload,
  type EmailFact,
} from '@the-tool-pit/types'
import { signOutreachRemove } from '@/lib/listings/outreach-token'
import { notifyEventPublished, notifyEventRejected } from '@/lib/notify/approvals'
import { grantEventOwnership } from '@/lib/listings/submitter-ownership'
import { eventPublishBlockers } from '@/lib/events/publish-bar'
import { addHumanEdits, changedKeys, HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db/human-edited'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/event-listings')
  revalidatePath('/events')
}

/** Publish a listing. Requires coordinates so it can actually be placed on the map. */
export async function approveEvent(id: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [e] = await db
    .select({
      latitude: eventListings.latitude,
      longitude: eventListings.longitude,
      startDate: eventListings.startDate,
      venueName: eventListings.venueName,
      address: eventListings.address,
      program: eventListings.program,
      registrationStatus: eventListings.registrationStatus,
    })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!e) return { error: 'Event not found' }

  const missing = eventPublishBlockers(e)
  if (missing.length > 0) {
    // Name everything missing at once. A reviewer who fixes one item, presses
    // the button and is told about the next one learns to dread the button.
    return { error: `Not ready to publish. Add ${missing.join(', and ')}.` }
  }
  await db
    .update(eventListings)
    .set({ status: 'published', publishedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListings.id, id))
  // The organiser who filled this in now runs it, unless they said otherwise.
  await grantEventOwnership(id)
  await notifyEventPublished(id)
  revalidateAll()
  return {}
}

/**
 * Refuse a pending listing, or take a live one back off the map.
 *
 * Same double duty as suppressField, same fix: the status is read before it is
 * written, and the submitter gets the email that matches what actually
 * happened. The reason is required because it is the body of that email.
 */
export async function suppressEvent(id: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  const [before] = await db
    .select({ status: eventListings.status })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!before) return { error: 'Event not found' }

  await db
    .update(eventListings)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventListings.id, id))
  await notifyEventRejected(id, before.status === 'published', clean)
  revalidateAll()
  return {}
}

/**
 * Approve a scraped roster snapshot and let its count reach the public listing.
 *
 * A site-scraped roster lands 'pending': the worker reads it off an event's own
 * page, which can break silently or list last year's teams, so neither the team
 * list NOR the count is public until a human has looked. This is that human's
 * door. It flips the snapshot to 'approved' (which the public roster route then
 * serves) AND writes the count in the same step, so the two never disagree. The
 * waitlist is not registered, so it is left out of the count, exactly as the
 * scrape path computed it.
 *
 * registeredTeamCount is machine-owned, so this write needs no human-edited
 * guard: approving a snapshot IS the human decision for that column.
 */
export async function approveRosterSnapshot(snapshotId: string): Promise<{ error?: string; count?: number }> {
  await assertAdmin()
  const db = getDb()

  const [snap] = await db
    .select({
      id: eventRosterSnapshots.id,
      status: eventRosterSnapshots.status,
      eventListingId: eventRosterSnapshots.eventListingId,
      teams: eventRosterSnapshots.teams,
    })
    .from(eventRosterSnapshots)
    .where(eq(eventRosterSnapshots.id, snapshotId))
    .limit(1)
  if (!snap) return { error: 'Roster snapshot not found.' }
  if (snap.status !== 'pending') return { error: 'This roster snapshot was already handled.' }

  const teams = (snap.teams ?? []) as RosterTeam[]
  const registeredCount = teams.filter((t) => !t.waitlisted).length

  await db
    .update(eventRosterSnapshots)
    .set({ status: 'approved' })
    .where(eq(eventRosterSnapshots.id, snapshotId))

  await db
    .update(eventListings)
    .set({ registeredTeamCount: registeredCount, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(eventListings.id, snap.eventListingId))

  revalidateAll()
  return { count: registeredCount }
}

// #region outreach

/** "12 to 13 July 2026", or the single date, from ISO yyyy-mm-dd strings. */
function outreachDateRange(start: string | null, end: string | null): string | null {
  const fmt = (iso: string) => {
    // Parsed as UTC: these are date-only columns and the server's local zone
    // must not shift an event a day.
    const at = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(at.getTime())) return iso
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at)
  }
  if (start && end && start !== end) return `${fmt(start)} to ${fmt(end)}`
  if (start) return fmt(start)
  if (end) return fmt(end)
  return null
}

/**
 * One outreach card row. A value we hold reads as data; a blank reads as a
 * muted "Not listed - add it" prompt rather than being hidden, because the gap
 * is the thing that gets an organiser to sign in and fill it.
 */
function outreachFact(label: string, value: string | null): EmailFact {
  return value ? { label, value } : { label, value: 'Not listed - add it', muted: true }
}

/**
 * Send the one-time outreach email for a listing: tell its scraped public
 * contact that the event is listed, show what we hold, and offer to claim or
 * remove it.
 *
 * ADMIN-TRIGGERED, once per listing, and it refuses in three ways, because the
 * one thing this must never do is annoy an organiser or, worse, email an event
 * that is over:
 *
 *   - NEVER A PAST EVENT. The gate is today < startDate. A missing start date
 *     is treated as "cannot tell", so it is refused too. There is no outreach
 *     about an event that has run.
 *   - NEVER WITHOUT A REAL DESTINATION. Only the scraped contactEmail is used.
 *     No contactEmail, no send. There is no fallback to submitterContact, which
 *     is a free-text admin note, not an address anyone confirmed.
 *   - NEVER TWICE. outreachSentAt is stamped on the listing the moment the row
 *     is queued, and a second attempt sees it and stops. The outbox dedupe key
 *     is a second guard behind it.
 *
 * The recipient has no account, so this does not go through the user-address
 * path the moderation emails use: the row carries the raw contactEmail and the
 * worker's drain sends straight to it. See queueNotification's recipientEmail.
 */
export async function sendEventOutreach(id: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [row] = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      venueName: eventListings.venueName,
      city: eventListings.city,
      region: eventListings.region,
      country: eventListings.country,
      startDate: eventListings.startDate,
      endDate: eventListings.endDate,
      capacity: eventListings.capacity,
      costUsd: eventListings.costUsd,
      costNote: eventListings.costNote,
      registrationUrl: eventListings.registrationUrl,
      volunteerUrl: eventListings.volunteerUrl,
      contactEmail: eventListings.contactEmail,
      outreachSentAt: eventListings.outreachSentAt,
    })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!row) return { error: 'Event not found' }

  if (row.outreachSentAt) return { error: 'Outreach has already been sent for this event.' }

  const email = row.contactEmail?.trim()
  if (!email || !email.includes('@')) return { error: 'This listing has no contact email to reach.' }

  // today < startDate, compared as YYYY-MM-DD strings (lexicographic order is
  // date order for that format). A missing date is not in the future, so it is
  // refused: the rule is no outreach unless we can prove the event is ahead.
  const today = new Date().toISOString().slice(0, 10)
  if (!row.startDate) return { error: 'This event has no start date, so it cannot be confirmed as upcoming.' }
  if (row.startDate <= today) return { error: 'This event has already run, so no outreach is sent.' }

  // The card shows the fields organisers most often leave blank, EVEN WHEN
  // BLANK: seeing the gap is what makes them sign in to fix it. A missing value
  // is a muted "Not listed" prompt, not a hidden row.
  const cost =
    row.costUsd != null
      ? (row.costUsd === 0 ? 'Free' : `$${row.costUsd}`) + (row.costNote?.trim() ? ` (${row.costNote.trim()})` : '')
      : row.costNote?.trim() || null
  const where = [row.venueName, row.city, row.region, row.country].filter((p) => p && p.trim()).join(', ')
  const facts: EmailFact[] = [
    outreachFact('When', outreachDateRange(row.startDate, row.endDate)),
    outreachFact('Where', where || null),
    outreachFact('Registration cost', cost),
    outreachFact('Team sign-up link', row.registrationUrl?.trim() || null),
    outreachFact('Volunteer sign-up link', row.volunteerUrl?.trim() || null),
    outreachFact('Max number of teams', row.capacity != null ? String(row.capacity) : null),
  ]

  const payload: ApprovalEmailPayload = {
    title: row.name,
    vertical: 'event',
    url: claimListingUrl('event', row.id),
    // The one-click "take it down" button beside "Claim & fix it". The token is
    // signed for this listing so the public /listings/remove route can trust an
    // accountless click; suppressing is idempotent, so a re-click is harmless.
    secondaryCta: {
      label: 'Not right? Remove it',
      url: removeListingUrl('event', row.id, signOutreachRemove('event', row.id)),
    },
    facts,
  }

  // Stamp the listing first: it is the guard the button reads and the one that
  // survives the outbox being pruned. Queueing is idempotent behind its dedupe
  // key, so even a replayed action lands one email.
  await db
    .update(eventListings)
    .set({ outreachSentAt: new Date(), outreachSentTo: email, updatedAt: new Date() })
    .where(eq(eventListings.id, id))

  await queueNotification({
    userId: null,
    recipientEmail: email,
    kind: 'listing_outreach',
    subjectType: 'event_listing',
    subjectId: row.id,
    dedupeKey: `listing_outreach:event:${row.id}`,
    payload,
  })

  revalidateAll()
  return {}
}

// #endregion

export async function unsuppressEvent(id: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db.update(eventListings).set({ status: 'pending', updatedAt: new Date() }).where(eq(eventListings.id, id))
  revalidateAll()
}

export async function deleteEvent(id: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  // event_roster_snapshots cascades on delete.
  await db.delete(eventListings).where(eq(eventListings.id, id))
  revalidateAll()
}

export interface EventEditInput {
  name?: string
  program?: string
  hostTeamNumber?: number | null
  latitude?: number | null
  longitude?: number | null
  venueName?: string | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  startDate?: string | null
  endDate?: string | null
  days?: number | null
  parallelDivisions?: boolean
  capacity?: number | null
  costUsd?: number | null
  costNote?: string | null
  registrationStatus?: string
  registrationOpensAt?: string | null
  volunteerStatus?: string
  eventStatus?: string
  website?: string | null
  registrationUrl?: string | null
  volunteerUrl?: string | null
  teamListUrl?: string | null
  chiefDelphiUrl?: string | null
  contactEmail?: string | null
  notes?: string | null
  tbaKey?: string | null
}

function inEnum<T extends readonly string[]>(v: string | undefined, allowed: T): T[number] | undefined {
  return v && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined
}

/** Only YYYY-MM-DD survives; empty or malformed becomes null. */
function cleanDate(v: string | null | undefined): string | null {
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** Edit any listing attribute, including repositioning the pin. */
export async function updateEvent(id: string, input: EventEditInput): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    if (!input.name.trim()) return { error: 'Name cannot be empty.' }
    patch.name = input.name.trim()
  }
  if (input.program !== undefined) patch.program = inEnum(input.program, EVENT_PROGRAMS) ?? 'frc'
  if (input.hostTeamNumber !== undefined) patch.hostTeamNumber = input.hostTeamNumber
  if (input.latitude !== undefined) patch.latitude = input.latitude
  if (input.longitude !== undefined) patch.longitude = input.longitude
  if (input.venueName !== undefined) patch.venueName = input.venueName?.trim() || null
  if (input.address !== undefined) patch.address = input.address?.trim() || null
  if (input.city !== undefined) patch.city = input.city?.trim() || null
  if (input.region !== undefined) patch.region = input.region?.trim() || null
  if (input.country !== undefined) patch.country = input.country?.trim() || null
  if (input.startDate !== undefined) patch.startDate = cleanDate(input.startDate)
  if (input.endDate !== undefined) patch.endDate = cleanDate(input.endDate)
  if (input.days !== undefined) patch.days = input.days === 1 || input.days === 2 ? input.days : null
  if (input.parallelDivisions !== undefined) patch.parallelDivisions = input.parallelDivisions
  if (input.capacity !== undefined) patch.capacity = input.capacity
  if (input.costUsd !== undefined) patch.costUsd = input.costUsd
  if (input.costNote !== undefined) patch.costNote = input.costNote?.trim() || null
  if (input.registrationStatus !== undefined) patch.registrationStatus = inEnum(input.registrationStatus, REGISTRATION_STATUSES) ?? 'unknown'
  if (input.registrationOpensAt !== undefined) patch.registrationOpensAt = cleanDate(input.registrationOpensAt)
  if (input.volunteerStatus !== undefined) patch.volunteerStatus = inEnum(input.volunteerStatus, VOLUNTEER_STATUSES) ?? 'unknown'
  if (input.eventStatus !== undefined) patch.eventStatus = inEnum(input.eventStatus, EVENT_STATUSES) ?? 'confirmed'
  if (input.website !== undefined) patch.website = input.website?.trim() || null
  if (input.registrationUrl !== undefined) patch.registrationUrl = input.registrationUrl?.trim() || null
  if (input.volunteerUrl !== undefined) patch.volunteerUrl = input.volunteerUrl?.trim() || null
  if (input.teamListUrl !== undefined) patch.teamListUrl = input.teamListUrl?.trim() || null
  if (input.chiefDelphiUrl !== undefined) patch.chiefDelphiUrl = input.chiefDelphiUrl?.trim() || null
  if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail?.trim() || null
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null
  if (input.tbaKey !== undefined) patch.tbaKey = input.tbaKey?.trim().toLowerCase() || null

  // Record what the moderator actually MOVED, so a later refresh leaves it be.
  // Earned by changing a value, never by pressing Save: marking every field on
  // the form would freeze a venue nobody read out of a future TBA correction.
  const [before] = await db
    .select()
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)

  const claimed = changedKeys(patch, (before ?? {}) as Record<string, unknown>, HUMAN_EDITABLE_EVENT_KEYS)
  const humanEditedFields = addHumanEdits(before?.humanEditedFields, claimed)

  await db
    .update(eventListings)
    .set({ ...patch, ...(humanEditedFields ? { humanEditedFields } : {}) })
    .where(eq(eventListings.id, id))
  revalidateAll()
  return {}
}
