import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  eventListings,
  listingOwners,
  currentOffseasonSeason,
  offseasonSeasonYear,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  LISTING_WRITE_ROLES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db'
import type { NewEventListing } from '@the-tool-pit/db'
import { uniqueEventSlug } from '@/lib/queries/event-listings'
import { sendApprovalNotice, reviewEventUrl } from '@the-tool-pit/types'
import {
  eventDateRange,
  eventLocation,
  costLabel,
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
} from '@/lib/events/event-display'
import { wrapLongitude } from '@/lib/geo/longitude'
import { containsHateSpeech, urlContainsHateSpeech } from '@the-tool-pit/db/hate-filter'

export interface CreateEventSubmissionInput {
  name: string
  program?: string
  hostTeamNumber?: number
  latitude?: number
  longitude?: number
  venueName?: string
  address?: string
  city?: string
  region?: string
  country?: string
  startDate?: string
  endDate?: string
  days?: number
  parallelDivisions?: boolean
  capacity?: number
  costUsd?: number
  costNote?: string
  registrationStatus?: string
  registrationOpensAt?: string
  registrationClosesAt?: string
  volunteerStatus?: string
  eventStatus?: string
  website?: string
  registrationUrl?: string
  teamListUrl?: string
  volunteerUrl?: string
  chiefDelphiUrl?: string
  contactEmail?: string
  notes?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: submitting an
   * event never requires an account (same as fields). An account only earns
   * attribution and lets the submitter find it again later.
   */
  submittedByUserId?: string
  /**
   * What the "just passing it along" box said, resolved by the route with
   * lib/listings/passing-along.ts. NULL for a signed-out submitter, TRUE means
   * the listing is theirs when a moderator approves it.
   */
  submitterOwns?: boolean | null
  /**
   * Set when this is a renewal, from /events/submit?renew=<id>. It links the
   * new season's listing back to last year's, which is what carries the
   * history and the owners forward.
   *
   * Never trusted: the id is checked against a published listing before it is
   * written, so a made up or unpublished id is dropped rather than stored.
   */
  previousListingId?: string
}

export interface CreateEventSubmissionResult {
  listingId?: string
  status: 'pending' | 'error'
  message: string
}

function pickEnum<T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback
}

/** Keep only YYYY-MM-DD; anything else becomes null so the date columns stay clean. */
function cleanDate(value: string | undefined): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export async function createEventSubmission(
  input: CreateEventSubmissionInput,
): Promise<CreateEventSubmissionResult> {
  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'An event name is required.' }

  if (
    containsHateSpeech(input.name, input.notes, input.venueName, input.city, input.submitterName) ||
    urlContainsHateSpeech(input.website) ||
    urlContainsHateSpeech(input.registrationUrl)
  ) {
    return { status: 'error', message: "This submission can't be accepted." }
  }

  const db = getDb()

  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  // Folded, not dropped. A longitude arriving outside [-180, 180] is a real
  // position on a repeated copy of the world, and discarding it filed the
  // record with NO coordinates at all, so the pin never appeared again and
  // nothing said why. The client normalises too; this is the backstop, and it
  // is the one that matters because an API caller never touches the picker.
  const lng = typeof input.longitude === 'number' ? wrapLongitude(input.longitude) : null

  const hostTeamNumber =
    typeof input.hostTeamNumber === 'number' && Number.isInteger(input.hostTeamNumber) && input.hostTeamNumber > 0
      ? input.hostTeamNumber
      : null

  const days = input.days === 1 || input.days === 2 ? input.days : null
  const capacity =
    typeof input.capacity === 'number' && Number.isInteger(input.capacity) && input.capacity > 0 && input.capacity < 1000
      ? input.capacity
      : null
  const costUsd =
    typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) && input.costUsd >= 0 && input.costUsd < 100000
      ? Math.round(input.costUsd)
      : null

  const registrationStatus = pickEnum(input.registrationStatus, REGISTRATION_STATUSES, 'unknown')
  const eventStatus = pickEnum(input.eventStatus, EVENT_STATUSES, 'confirmed')

  const startDate = cleanDate(input.startDate)
  const endDate = cleanDate(input.endDate)

  // A renewal only counts when it points at a listing that really is published.
  // The id arrives from a query string, so an unchecked one would let anybody
  // hang a new row off any uuid they liked.
  const previousListingId = await resolvePreviousListing(input.previousListingId)

  // The season is the calendar year of the dates. With no dates yet, it is the
  // year we are in, which is the year somebody filling this form in today is
  // thinking about. Never inferred from the previous listing plus one: a
  // renewal that skipped a year would be filed a year early.
  const seasonYear = offseasonSeasonYear(startDate ?? endDate) ?? currentOffseasonSeason()

  // A stable human slug, built from the name once. A later rename keeps it.
  const slug = await uniqueEventSlug(name)

  const values: NewEventListing = {
    name,
    slug,
    program: pickEnum(input.program, EVENT_PROGRAMS, 'frc'),
    hostTeamNumber,
    latitude: lat,
    longitude: lng,
    venueName: input.venueName?.trim() || null,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    country: input.country?.trim() || null,
    seasonYear,
    previousListingId,
    startDate,
    endDate,
    days,
    parallelDivisions: Boolean(input.parallelDivisions),
    capacity,
    costUsd,
    costNote: input.costNote?.trim() || null,
    registrationStatus,
    // An open date only makes sense while registration is not open yet.
    registrationOpensAt: registrationStatus === 'not_open' ? cleanDate(input.registrationOpensAt) : null,
    // A close date only makes sense while registration is open.
    registrationClosesAt: registrationStatus === 'open' ? cleanDate(input.registrationClosesAt) : null,
    volunteerStatus: pickEnum(input.volunteerStatus, VOLUNTEER_STATUSES, 'unknown'),
    eventStatus,
    website: input.website?.trim() || null,
    registrationUrl: input.registrationUrl?.trim() || null,
    teamListUrl: input.teamListUrl?.trim() || null,
    volunteerUrl: input.volunteerUrl?.trim() || null,
    chiefDelphiUrl: input.chiefDelphiUrl?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    notes: input.notes?.trim() || null,
    submitterName: input.submitterName?.trim() || null,
    submitterContact: input.submitterContact?.trim() || null,
    submitterIpHash: input.submitterIpHash,
    submittedByUserId: input.submittedByUserId ?? null,
    submitterOwns: input.submitterOwns ?? null,
    status: 'pending',
    source: 'submission',
  }

  const [row] = await db.insert(eventListings).values(values).returning({ id: eventListings.id })

  // A renewal keeps its owner. Somebody who already runs last year's listing
  // should not have to claim this year's and wait for a moderator to agree
  // they are still the same person.
  if (previousListingId && input.submittedByUserId) {
    await carryOwnershipForward(previousListingId, row.id, input.submittedByUserId)
  }

  // The display helpers do the formatting, so the embed says a date range and a
  // cost the same way the public card does. A moderator comparing the two is
  // reading one wording, not two.
  const display = {
    name,
    program: values.program ?? 'frc',
    startDate: values.startDate ?? null,
    endDate: values.endDate ?? null,
    venueName: values.venueName ?? null,
    city: values.city ?? null,
    region: values.region ?? null,
    country: values.country ?? null,
    capacity: values.capacity ?? null,
    costUsd: values.costUsd ?? null,
    costNote: values.costNote ?? null,
    registrationStatus,
    eventStatus,
    website: values.website ?? null,
    notes: values.notes ?? null,
  }

  sendApprovalNotice({
    vertical: 'event',
    title: name,
    reviewUrl: reviewEventUrl(row.id),
    sourceUrl: values.website ?? null,
    submitter: [values.submitterName, values.submitterContact].filter(Boolean).join(' · ') || null,
    facts: [
      { label: 'Program', value: display.program !== 'frc' ? display.program.toUpperCase() : null, inline: true },
      { label: 'Status', value: EVENT_STATUS_LABEL[eventStatus], inline: true },
      { label: 'Dates', value: eventDateRange(display), inline: true },
      { label: 'Location', value: eventLocation(display) },
      { label: 'Capacity', value: display.capacity != null ? `${display.capacity} teams` : null, inline: true },
      { label: 'Cost', value: costLabel(display), inline: true },
      { label: 'Registration', value: REGISTRATION_STATUS_LABEL[registrationStatus], inline: true },
      { label: 'Notes', value: display.notes },
      { label: 'Renewal of', value: previousListingId ? "last year's listing" : null, inline: true },
    ],
  })

  return {
    listingId: row.id,
    status: 'pending',
    message: "Thanks! We'll review this event and add it to the map.",
  }
}

// #region renewal

/**
 * Check a claimed previous listing and hand back its id, or null.
 *
 * Null for anything we cannot stand behind: no id given, not a uuid we hold,
 * or a listing that is not published. A renewal chain that points at a
 * rejected or deleted row tells the reader a history that never happened.
 */
async function resolvePreviousListing(id: string | undefined): Promise<string | null> {
  const wanted = id?.trim()
  if (!wanted) return null
  try {
    const db = getDb()
    const [prev] = await db
      .select({ id: eventListings.id })
      .from(eventListings)
      .where(and(eq(eventListings.id, wanted), eq(eventListings.status, 'published')))
      .limit(1)
    return prev?.id ?? null
  } catch {
    // A malformed uuid makes Postgres throw rather than return no rows. That is
    // a bad link, not a broken submission, so the event still goes in without
    // the chain.
    return null
  }
}

/**
 * Give the renewing user the same role on the new listing they hold on the old
 * one.
 *
 * ONLY THE SUBMITTER, and only when they ALREADY hold a write role on last
 * year's listing. This is not a general ownership transfer: copying every
 * owner across would hand a role to people who have not touched the account in
 * a year, and copying it for a stranger who guessed the renew link would hand
 * away the listing outright. The one case this covers is the organiser filling
 * in next year's form while signed in, which is the case that matters.
 *
 * Best effort. The listing is already inserted by this point and a failure to
 * write a permission row must not turn a good submission into an error; they
 * can still claim it the normal way.
 */
async function carryOwnershipForward(
  previousListingId: string,
  newListingId: string,
  userId: string,
): Promise<void> {
  try {
    const db = getDb()
    const [held] = await db
      .select({ role: listingOwners.role })
      .from(listingOwners)
      .where(
        and(
          eq(listingOwners.entityType, 'event'),
          eq(listingOwners.entityId, previousListingId),
          eq(listingOwners.userId, userId),
          inArray(listingOwners.role, [...LISTING_WRITE_ROLES]),
        ),
      )
      .limit(1)
    if (!held) return

    await db.insert(listingOwners).values({
      entityType: 'event',
      entityId: newListingId,
      userId,
      role: held.role,
      verifiedVia: 'self_submitted',
    })
  } catch (err) {
    console.error(
      `[events/renew] could not carry ownership from ${previousListingId} to ${newListingId}: ${(err as Error).message}`,
    )
  }
}

// #endregion
