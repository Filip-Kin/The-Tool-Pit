import { eq, and, isNotNull, asc, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings } from '@the-tool-pit/db'
import type { PublicEvent } from '@/lib/events/event-display'
import type { RegistrationStatus, VolunteerStatus, EventStatus } from '@the-tool-pit/db'

/** Columns exposed publicly - never the submitter audit fields. */
const publicColumns = {
  id: eventListings.id,
  program: eventListings.program,
  name: eventListings.name,
  hostTeamNumber: eventListings.hostTeamNumber,
  latitude: eventListings.latitude,
  longitude: eventListings.longitude,
  venueName: eventListings.venueName,
  address: eventListings.address,
  city: eventListings.city,
  region: eventListings.region,
  country: eventListings.country,
  startDate: eventListings.startDate,
  endDate: eventListings.endDate,
  days: eventListings.days,
  parallelDivisions: eventListings.parallelDivisions,
  capacity: eventListings.capacity,
  costUsd: eventListings.costUsd,
  costNote: eventListings.costNote,
  registrationStatus: eventListings.registrationStatus,
  registrationOpensAt: eventListings.registrationOpensAt,
  volunteerStatus: eventListings.volunteerStatus,
  eventStatus: eventListings.eventStatus,
  website: eventListings.website,
  registrationUrl: eventListings.registrationUrl,
  chiefDelphiUrl: eventListings.chiefDelphiUrl,
  contactEmail: eventListings.contactEmail,
  notes: eventListings.notes,
  tbaKey: eventListings.tbaKey,
  registeredTeamCount: eventListings.registeredTeamCount,
  teamCountUpdatedAt: eventListings.teamCountUpdatedAt,
} as const

function toPublic(row: Record<string, unknown>): PublicEvent {
  return {
    ...row,
    registrationStatus: row.registrationStatus as RegistrationStatus,
    volunteerStatus: row.volunteerStatus as VolunteerStatus,
    eventStatus: row.eventStatus as EventStatus,
    teamCountUpdatedAt:
      row.teamCountUpdatedAt instanceof Date ? row.teamCountUpdatedAt.toISOString() : (row.teamCountUpdatedAt as string | null),
  } as PublicEvent
}

/**
 * All published events that have coordinates (so they can be placed on the
 * map). Ordered by start date ascending, nulls last, so the natural list order
 * already leads with what is coming up. The explorer re-sorts for "past below
 * upcoming" and "nearest first", but this is the stable default.
 */
export async function getPublishedEvents(): Promise<PublicEvent[]> {
  const db = getDb()
  const rows = await db
    .select(publicColumns)
    .from(eventListings)
    .where(
      and(
        eq(eventListings.status, 'published'),
        isNotNull(eventListings.latitude),
        isNotNull(eventListings.longitude),
      ),
    )
    // asc puts nulls last in Postgres, which is what we want (dateless events
    // sink below dated ones).
    .orderBy(asc(eventListings.startDate), desc(eventListings.createdAt))
  return rows.map(toPublic)
}

/** A single published event by id, for its shareable detail page. */
export async function getPublishedEventById(id: string): Promise<PublicEvent | null> {
  const db = getDb()
  const [row] = await db
    .select(publicColumns)
    .from(eventListings)
    .where(and(eq(eventListings.id, id), eq(eventListings.status, 'published')))
    .limit(1)
  return row ? toPublic(row) : null
}
