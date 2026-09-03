import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  eventListings,
  eventEditProposals,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db'
import type { EventEditProposalData } from '@the-tool-pit/db'
import { wrapLongitude } from '@/lib/geo/longitude'
import { sendApprovalNotice, reviewEventEditUrl } from '@the-tool-pit/types'

export interface CreateEventEditInput {
  name?: string
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
  /** Submitter's explanation of what changed / why. */
  note?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: suggesting an
   * edit never requires an account, an account only earns attribution.
   */
  submittedByUserId?: string
}

export interface CreateEventEditResult {
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

export async function createEventEditProposal(
  listingId: string,
  input: CreateEventEditInput,
): Promise<CreateEventEditResult> {
  const db = getDb()

  const [listing] = await db
    .select({ id: eventListings.id, status: eventListings.status })
    .from(eventListings)
    .where(eq(eventListings.id, listingId))
    .limit(1)
  if (!listing || listing.status !== 'published') {
    return { status: 'error', message: 'That event could not be found.' }
  }

  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'An event name is required.' }

  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  // Folded, not dropped, exactly as the submit path does it: a longitude past
  // [-180, 180] is a real spot on a repeated world, and dropping it filed the
  // record with no coordinates so the pin vanished. The client normalises too;
  // this is the backstop for a caller that never touched the picker.
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

  // teamListUrl rides in the proposed jsonb alongside the typed fields. The
  // EventEditProposalData type lives in packages/db and does not name it yet,
  // so the value is captured here with a local widening. It reaches the
  // listing once event-edits applies it (see the report note).
  const proposed: EventEditProposalData & { teamListUrl?: string | null } = {
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
    // A close date only makes sense while registration is open.
    registrationClosesAt: registrationStatus === 'open' ? cleanDate(input.registrationClosesAt) : null,
    volunteerStatus: pickEnum(input.volunteerStatus, VOLUNTEER_STATUSES, 'unknown'),
    eventStatus: pickEnum(input.eventStatus, EVENT_STATUSES, 'confirmed'),
    website: input.website?.trim() || null,
    registrationUrl: input.registrationUrl?.trim() || null,
    teamListUrl: input.teamListUrl?.trim() || null,
    volunteerUrl: input.volunteerUrl?.trim() || null,
    chiefDelphiUrl: input.chiefDelphiUrl?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    notes: input.notes?.trim() || null,
  }

  const [proposal] = await db
    .insert(eventEditProposals)
    .values({
      eventListingId: listingId,
      proposed,
      note: input.note?.trim() || null,
      submitterName: input.submitterName?.trim() || null,
      submitterContact: input.submitterContact?.trim() || null,
      submitterIpHash: input.submitterIpHash,
      submittedByUserId: input.submittedByUserId ?? null,
      status: 'pending',
    })
    .returning({ id: eventEditProposals.id })

  // Ping the moderators. It deep-links /admin/event-edits, which now exists.
  sendApprovalNotice({
    vertical: 'event_edit',
    title: name,
    reviewUrl: reviewEventEditUrl(proposal.id),
    submitter: [input.submitterName, input.submitterContact].filter(Boolean).join(' · ') || null,
    facts: [{ label: 'What changed', value: input.note ?? null }],
  })

  return { status: 'pending', message: "Thanks! Your edit is in for review." }
}
