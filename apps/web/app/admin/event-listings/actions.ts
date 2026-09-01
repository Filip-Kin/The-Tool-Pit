'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  eventListings,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db'
import { notifyEventPublished, notifyEventRejected } from '@/lib/notify/approvals'
import { grantEventOwnership } from '@/lib/listings/submitter-ownership'

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
    .select({ latitude: eventListings.latitude, longitude: eventListings.longitude })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!e) return { error: 'Event not found' }
  if (e.latitude == null || e.longitude == null) {
    return { error: 'Set a pin location before publishing - it needs coordinates for the map.' }
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
  if (input.chiefDelphiUrl !== undefined) patch.chiefDelphiUrl = input.chiefDelphiUrl?.trim() || null
  if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail?.trim() || null
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null
  if (input.tbaKey !== undefined) patch.tbaKey = input.tbaKey?.trim().toLowerCase() || null

  await db.update(eventListings).set(patch).where(eq(eventListings.id, id))
  revalidateAll()
  return {}
}
