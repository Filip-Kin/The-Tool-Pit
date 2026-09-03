/**
 * Fill the blanks on a published event that came in without them.
 *
 * The events seeded from Filip's spreadsheet carry the facts he typed: the
 * venue, the dates, the cost. What they do not carry is everything a website
 * holds that a spreadsheet row does not: a team-list page, a volunteer link, an
 * organiser email, the registration state. The reader finds those, and a
 * published event has a website and often a Chief Delphi thread to read them
 * from, exactly as a candidate does.
 *
 * ONLY BLANKS ARE FILLED. A field that already has a value is a fact somebody
 * entered, and it is left untouched: this is not a re-read that overwrites, it
 * is a fill that completes. Registration and volunteer status count as blank
 * only when they read 'unknown', which is the value a seed row gets when nobody
 * said. The pin and the TBA key are filled the same way, when absent.
 *
 * Never marks anything human-edited: a machine-filled blank stays refreshable,
 * and the one field a later pass would touch, the roster count, is not written
 * here anyway.
 */
import { and, eq, sql } from 'drizzle-orm'
import { getDb, eventListings, type ExtractedEventListingFields } from '@the-tool-pit/db'
import { readEventCandidate } from './read-event.js'
import { geocodeVenue, matchTbaEvent } from './locate.js'
import { fetchChiefDelphiTopic, parseChiefDelphiTopicId } from '../connectors/discourse.js'

export interface EnrichListingStats {
  considered: number
  read: number
  filled: number
  noSource: number
  failed: number
}

/** Which extracted fields may fill a blank listing column. The pin and tbaKey are handled apart. */
const FILLABLE: (keyof ExtractedEventListingFields)[] = [
  'venueName', 'address', 'city', 'region', 'country', 'hostTeamNumber',
  'startDate', 'endDate', 'days', 'capacity', 'costUsd', 'costNote',
  'registrationStatus', 'registrationClosesAt', 'volunteerStatus', 'registrationUrl', 'volunteerUrl',
  'website', 'teamListUrl', 'contactEmail', 'notes',
]

function isBlank(value: unknown, key: string): boolean {
  if (value === null || value === undefined || value === '') return true
  // A status that reads 'unknown' is the seed default, not a stated fact.
  if ((key === 'registrationStatus' || key === 'volunteerStatus') && value === 'unknown') return true
  return false
}

/** Enrich one published event. Returns which columns it filled. */
export async function enrichPublishedEvent(listingId: string): Promise<string[]> {
  const db = getDb()
  const [listing] = await db.select().from(eventListings).where(eq(eventListings.id, listingId)).limit(1)
  if (!listing) return []

  // Something to read: the thread if there is one, else the event's own site.
  const source = listing.chiefDelphiUrl || listing.website
  if (!source) return []

  let threadText = ''
  const topicId = listing.chiefDelphiUrl ? parseChiefDelphiTopicId(listing.chiefDelphiUrl) : null
  if (topicId !== null) {
    const detail = await fetchChiefDelphiTopic(topicId)
    if (detail) threadText = detail.raw || detail.html.replace(/<[^>]+>/g, ' ')
  }

  const read = await readEventCandidate({
    threadUrl: listing.chiefDelphiUrl || listing.website || '',
    title: listing.name,
    threadText,
    website: listing.website ?? undefined,
  })
  if (!read) return []

  const row = listing as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const filled: string[] = []

  for (const key of FILLABLE) {
    if (!isBlank(row[key], key)) continue
    const value = (read.fields as Record<string, unknown>)[key]
    if (value === undefined || value === null || value === '') continue
    patch[key] = value
    filled.push(key)
  }

  // A pin, when the event has none. Same strictness as the reader: a real
  // address or a venue with a town, landing in the region the row claims.
  if (listing.latitude == null || listing.longitude == null) {
    const located = await geocodeVenue({
      venueName: (patch.venueName as string) ?? listing.venueName,
      address: (patch.address as string) ?? listing.address,
      city: (patch.city as string) ?? listing.city,
      region: (patch.region as string) ?? listing.region,
      country: (patch.country as string) ?? listing.country,
    })
    if (located) {
      patch.latitude = located.latitude
      patch.longitude = located.longitude
      filled.push('latitude')
    }
  }

  // A TBA key, when absent, so the roster refresh can track the count.
  if (!listing.tbaKey) {
    const matched = await matchTbaEvent({
      name: listing.name,
      startDate: (patch.startDate as string) ?? (listing.startDate as string | null),
      city: (patch.city as string) ?? listing.city,
      region: (patch.region as string) ?? listing.region,
    })
    if (matched) {
      patch.tbaKey = matched.tbaKey
      filled.push('tbaKey')
    }
  }

  if (filled.length === 0) return []

  await db.update(eventListings).set({ ...patch, updatedAt: new Date() }).where(eq(eventListings.id, listingId))
  console.log(`[enrich-listing] ${listing.name}: filled ${filled.join(', ')}`)
  return filled
}

/**
 * Enrich a batch of published events that are missing the website-only fields.
 *
 * `scope` picks which: 'upcoming' or 'past' by whether the start date has
 * passed, or a set of ids. Only listings with a source to read and at least one
 * blank worth filling are touched.
 */
export async function enrichPublishedEvents(input: {
  ids?: string[]
  scope?: 'upcoming' | 'past'
  limit?: number
}): Promise<EnrichListingStats> {
  const db = getDb()
  const stats: EnrichListingStats = { considered: 0, read: 0, filled: 0, noSource: 0, failed: 0 }

  const rows = await db
    .select({ id: eventListings.id, startDate: eventListings.startDate })
    .from(eventListings)
    .where(
      and(
        eq(eventListings.status, 'published'),
        input.ids && input.ids.length > 0
          ? sql`${eventListings.id} in (${sql.join(input.ids.map((id) => sql`${id}::uuid`), sql`, `)})`
          : sql`true`,
        input.scope === 'upcoming' ? sql`${eventListings.startDate} >= current_date` : sql`true`,
        input.scope === 'past' ? sql`${eventListings.startDate} < current_date` : sql`true`,
        // Only the ones that have a source and a gap worth reading for.
        sql`(${eventListings.website} is not null or ${eventListings.chiefDelphiUrl} is not null)`,
        sql`(${eventListings.teamListUrl} is null or ${eventListings.contactEmail} is null or ${eventListings.volunteerUrl} is null or ${eventListings.registrationStatus} = 'unknown')`,
      ),
    )
    .limit(input.limit ?? 20)

  stats.considered = rows.length
  for (const r of rows) {
    try {
      const filled = await enrichPublishedEvent(r.id)
      if (filled.length > 0) {
        stats.read++
        stats.filled += filled.length
      }
    } catch (err) {
      stats.failed++
      console.error(`[enrich-listing] ${r.id} failed:`, err)
    }
  }

  console.log(`[enrich-listing] ${stats.read}/${stats.considered} enriched, ${stats.filled} fields filled, ${stats.failed} failed`)
  return stats
}
