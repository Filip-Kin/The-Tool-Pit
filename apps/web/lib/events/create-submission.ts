import { getDb } from '@/lib/db'
import {
  eventListings,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db'
import type { NewEventListing } from '@the-tool-pit/db'
import { notifyNewEventSubmission } from './notify'

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
  volunteerStatus?: string
  eventStatus?: string
  website?: string
  registrationUrl?: string
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

  const db = getDb()

  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  const lng = typeof input.longitude === 'number' && Math.abs(input.longitude) <= 180 ? input.longitude : null

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

  const values: NewEventListing = {
    name,
    program: pickEnum(input.program, EVENT_PROGRAMS, 'frc'),
    hostTeamNumber,
    latitude: lat,
    longitude: lng,
    venueName: input.venueName?.trim() || null,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    country: input.country?.trim() || null,
    startDate: cleanDate(input.startDate),
    endDate: cleanDate(input.endDate),
    days,
    parallelDivisions: Boolean(input.parallelDivisions),
    capacity,
    costUsd,
    costNote: input.costNote?.trim() || null,
    registrationStatus,
    // An open date only makes sense while registration is not open yet.
    registrationOpensAt: registrationStatus === 'not_open' ? cleanDate(input.registrationOpensAt) : null,
    volunteerStatus: pickEnum(input.volunteerStatus, VOLUNTEER_STATUSES, 'unknown'),
    eventStatus,
    website: input.website?.trim() || null,
    registrationUrl: input.registrationUrl?.trim() || null,
    chiefDelphiUrl: input.chiefDelphiUrl?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    notes: input.notes?.trim() || null,
    submitterName: input.submitterName?.trim() || null,
    submitterContact: input.submitterContact?.trim() || null,
    submitterIpHash: input.submitterIpHash,
    submittedByUserId: input.submittedByUserId ?? null,
    status: 'pending',
    source: 'submission',
  }

  const [row] = await db.insert(eventListings).values(values).returning({ id: eventListings.id })

  void notifyNewEventSubmission({
    listingId: row.id,
    event: {
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
    },
    submitterName: values.submitterName,
    submitterContact: values.submitterContact,
  })

  return {
    listingId: row.id,
    status: 'pending',
    message: "Thanks! We'll review this event and add it to the map.",
  }
}
