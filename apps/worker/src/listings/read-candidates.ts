/**
 * Fill in what a discovered candidate does not say, by reading its sources.
 *
 * Discovery finds a thread and files what a pattern could see. That was venue
 * on 0 of 13 events, city on 0, cost on 0, and a start date on 6, one of them
 * wrong. This job takes each pending candidate afterwards and reads it: the
 * thread, the event's own site, the pages behind the registration and pay
 * links. Everything it writes carries the sentence it came from.
 *
 * SEPARATE FROM DISCOVERY ON PURPOSE. Discovery is one HTTP request per source
 * and finishes in seconds; a read is a model call and a handful of page loads
 * per candidate. Tying them together would mean a slow read holding up a sweep,
 * and a re-read forcing a re-crawl. It also means a candidate that arrived
 * before this job existed can be read now, which is exactly what the 55
 * candidates already in the queue need.
 *
 * STILL NOTHING PUBLISHES. The row it updates is a candidate. A person accepts
 * it into a listing and then approves that listing, as before.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  getDb,
  eventListingCandidates,
  practiceFieldCandidates,
  type ExtractedEventListingFields,
  type ExtractedPracticeFieldFields,
} from '@the-tool-pit/db'
import { readEventCandidate } from './read-event.js'
import { readFieldCandidate } from './read-field.js'
import { fetchChiefDelphiTopic, parseChiefDelphiTopicId } from '../connectors/discourse.js'
import { geocodeVenue, matchTbaEvent } from './locate.js'

/**
 * Every field the reader is asked for, per vertical.
 *
 * On a forced re-read these are cleared before the new answer is applied, so a
 * value the reader no longer returns does not linger. Kept beside the readers
 * they mirror; a field added to a read prompt has to be added here too, or a
 * correction that removes it will not take.
 */
const READER_FIELDS: Record<'event' | 'field', string[]> = {
  event: [
    'name', 'program', 'hostTeamNumber', 'venueName', 'address', 'city', 'region', 'country',
    'startDate', 'endDate', 'days', 'capacity', 'costUsd', 'costNote', 'registrationStatus',
    'volunteerStatus', 'registrationUrl', 'volunteerUrl', 'website', 'teamListUrl', 'contactEmail', 'notes',
  ],
  field: [
    'name', 'teamNumber', 'teamName', 'program', 'address', 'city', 'region', 'country',
    'hours', 'availability', 'coverage', 'perimeter', 'elements', 'hasFms', 'ceilingHeightFt',
    'contactInfo', 'contactUrl', 'website', 'notes',
  ],
}

export interface ReadCandidatesPayload {
  /** 'event' or 'field'. Both when omitted. */
  vertical?: 'event' | 'field'
  /** Read one candidate, ignoring whether it has been read before. */
  candidateId?: string
  /** Re-read candidates that already carry a reading. */
  force?: boolean
  /** Stop after this many, so a first run cannot spend the afternoon. */
  limit?: number
}

export interface ReadCandidatesStats {
  considered: number
  read: number
  unchanged: number
  failed: number
  fieldsAdded: number
}

const DEFAULT_LIMIT = 40

/**
 * The opening post of a Chief Delphi thread, when the candidate came from one.
 *
 * A TBA candidate has no thread and its `website` is the only lead, which is
 * enough: the reader opens it and follows the registration and pay links from
 * there. That is where a TBA event's cost lives, and TBA has never carried it.
 */
async function threadText(sourceUrl: string | null): Promise<string> {
  if (!sourceUrl) return ''
  const topicId = parseChiefDelphiTopicId(sourceUrl)
  if (topicId === null) return ''
  const detail = await fetchChiefDelphiTopic(topicId)
  if (!detail) return ''
  return detail.raw || detail.html.replace(/<[^>]+>/g, ' ')
}

export async function processReadCandidatesJob(
  payload: ReadCandidatesPayload = {},
): Promise<ReadCandidatesStats> {
  const db = getDb()
  const stats: ReadCandidatesStats = { considered: 0, read: 0, unchanged: 0, failed: 0, fieldsAdded: 0 }
  const limit = payload.limit ?? DEFAULT_LIMIT

  const verticals = payload.vertical ? [payload.vertical] : (['event', 'field'] as const)

  for (const vertical of verticals) {
    const table = vertical === 'event' ? eventListingCandidates : practiceFieldCandidates

    // Pending only, and unread unless told otherwise. `readAt` in rawMetadata is
    // the marker: a candidate a moderator has already accepted or rejected is
    // not worth a model call.
    const rows = await db
      .select()
      .from(table)
      .where(
        and(
          payload.candidateId ? eq(table.id, payload.candidateId) : eq(table.status, 'pending'),
          payload.force || payload.candidateId
            ? sql`true`
            : or(isNull(table.rawMetadata), sql`${table.rawMetadata}->>'readAt' is null`),
        ),
      )
      .limit(limit)

    stats.considered += rows.length

    for (const row of rows) {
      const meta = (row.rawMetadata ?? {}) as Record<string, unknown>
      const title = typeof meta.title === 'string' ? meta.title : ''
      const links = Array.isArray(meta.links) ? (meta.links as string[]) : []
      const existing = (row.extracted ?? {}) as Record<string, unknown>

      try {
        const text = await threadText(row.sourceUrl)

        const read =
          vertical === 'event'
            ? await readEventCandidate({
                threadUrl: row.sourceUrl,
                title: title || String(existing.name ?? ''),
                threadText: text,
                website: typeof existing.website === 'string' ? existing.website : links[0],
              })
            : await readFieldCandidate({
                threadUrl: row.sourceUrl,
                title: title || String(existing.name ?? ''),
                threadText: text,
                links,
              })

        if (!read) {
          stats.failed++
          continue
        }

        // WHAT DISCOVERY WROTE WINS ON A FIELD IT FILLED, on an ordinary pass.
        // TBA's dates and venue come from a structured feed rather than a
        // reading of prose, so a model's answer does not replace one. What TBA
        // leaves empty, which is cost, capacity, registration state and
        // contact, is what the read is for.
        //
        // EXCEPT ON A RE-READ, where that rule is backwards. Asking for a
        // candidate to be read again means the reading it has is wrong: Beach
        // Blitz kept a start date of 1 November through two re-reads, because
        // the first pattern-matched pass had written it and "existing wins"
        // protected it, while the correct 30 October was thrown away each time.
        const rereading = Boolean(payload.force || payload.candidateId)

        // On a FORCED re-read the reader is the authority for everything it
        // reads, so a field it now omits must be CLEARED rather than kept. A
        // discovery-set days of 3 survived otherwise: the reader correctly
        // returned no days, and the old value merged straight back over the
        // top. So the reader-owned keys are stripped from the existing record
        // before the new answer goes on. Fields only discovery holds, a TBA
        // key most of all, are not reader-owned and stay.
        const readerOwned = new Set(READER_FIELDS[vertical])
        const base = rereading
          ? Object.fromEntries(Object.entries(stripEmpty(existing)).filter(([k]) => !readerOwned.has(k)))
          : stripEmpty(existing)
        const merged: Record<string, unknown> = rereading
          ? { ...base, ...read.fields }
          : { ...read.fields, ...base }
        const added = Object.keys(read.fields).filter((k) => !(k in stripEmpty(existing))).length

        // A PIN AND A TBA CODE, both lookups rather than readings.
        //
        // A listing cannot go on the map without coordinates, and the venue and
        // address are sitting right there: doing it here is the difference
        // between a moderator pressing Accept and a moderator pressing Accept
        // and then hunting for a school on a map. The TBA code matters for a
        // different reason: it is what lets the roster refresh keep the
        // registered team count current afterwards.
        const located =
          merged.latitude == null || merged.longitude == null
            ? await geocodeVenue({
                venueName: merged.venueName as string | undefined,
                address: merged.address as string | undefined,
                city: merged.city as string | undefined,
                region: merged.region as string | undefined,
                country: merged.country as string | undefined,
              })
            : null
        if (located) {
          merged.latitude = located.latitude
          merged.longitude = located.longitude
        }

        const matched =
          // `tbaKey` is a column on the events candidate table only, so it is
          // read off the row through a narrow cast rather than by widening the
          // union both tables share.
          vertical === 'event' && !merged.tbaKey && !(row as { tbaKey?: string | null }).tbaKey
            ? await matchTbaEvent({
                name: String(merged.name ?? title),
                startDate: merged.startDate as string | undefined,
                city: merged.city as string | undefined,
                region: merged.region as string | undefined,
              })
            : null
        if (matched) merged.tbaKey = matched.tbaKey

        await db
          .update(table)
          .set({
            extracted: merged as ExtractedEventListingFields & ExtractedPracticeFieldFields,
            rawMetadata: {
              ...meta,
              readAt: new Date().toISOString(),
              readEvidence: {
                ...read.evidence,
                // The pin and the code carry their working, same as every
                // value the model produced.
                ...(located
                  ? { latitude: { quote: located.resolved, source: `geocode: ${located.query}` } }
                  : {}),
                ...(matched ? { tbaKey: { quote: matched.why, source: 'the blue alliance' } } : {}),
              },
              readPages: read.pagesRead,
              readRejected: read.rejected,
            },
            updatedAt: new Date(),
          })
          .where(eq(table.id, row.id))

        stats.read++
        stats.fieldsAdded += added
        console.log(
          `[read-candidates] ${vertical} ${row.id}: +${added} fields from ${read.pagesRead.length} pages` +
            (read.rejected.length > 0 ? `, ${read.rejected.length} dropped` : ''),
        )
      } catch (err) {
        stats.failed++
        console.error(`[read-candidates] ${vertical} ${row.id} failed:`, err)
      }
    }
  }

  console.log(
    `[read-candidates] ${stats.read}/${stats.considered} read, ${stats.fieldsAdded} fields added, ${stats.failed} failed`,
  )
  return stats
}

/** Drop keys whose value is null, undefined or an empty string. */
function stripEmpty(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === '') continue
    out[k] = v
  }
  return out
}
