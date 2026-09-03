/**
 * TBA off-season events -> event listing candidates.
 *
 * This is the cheap, certain half of event discovery. TBA is structured JSON,
 * so there is no model call anywhere on this path and no parsing worth the
 * name: the fields either arrived or they did not.
 *
 * It reuses ../../connectors/tba-events.ts rather than talking to the API
 * itself. That connector already fetches /events/{year}, maps the payload and
 * handles a missing key, and it takes `skipTeams` precisely so a caller that
 * does not want a roster pays for one request instead of four hundred. We do
 * not want the roster here: event_listings.tbaKey is the link, and the roster
 * sync that already runs for the photos vertical fills the team count.
 *
 * WHAT TBA GIVES US, and therefore what lands on the candidate:
 *   name, start and end date, venue, city, state/province, country, website,
 *   the event key, and the days between the dates.
 *
 * WHAT IT DOES NOT, and therefore what stays a human's job:
 *   cost, capacity, whether registration is open or full, the volunteer
 *   sign-up, an organiser email, whether the event was cancelled, and whether
 *   it is two parallel one-day tournaments. Those are the columns teams
 *   actually choose on, and none of them exists in TBA at all.
 */
import { TbaEventsConnector } from '../../connectors/tba-events.js'
import type {
  EventListingCandidateInput,
  EventListingConnector,
  ListingConnectorContext,
  ListingConnectorResult,
} from '../types.js'

/** TBA event_type ints. 99 = OFFSEASON, 100 = PRESEASON. */
const OFFSEASON_EVENT_TYPES = new Set([99, 100])

/**
 * How far back a finished event is still worth listing. The vertical exists to
 * help a team decide where to go NEXT, so an event that ran in March is noise
 * in a review queue. A fortnight of slack covers an event TBA dated a day out.
 */
const PAST_EVENT_GRACE_DAYS = 14

interface TbaOffseasonConfig {
  /**
   * State / province codes to keep, e.g. ["MI", "IN"]. Empty or absent means
   * every region, which is the default.
   *
   * CODES, NOT NAMES. TBA files a Michigan off-season event as state_prov
   * "MI"; it never writes "Michigan". Filtering on the long form matches
   * nothing and returns an empty crawl that looks like a working one.
   */
  stateProvs?: string[]
  /**
   * Season years whose ALREADY-RUN events are kept as candidates instead of
   * dropped by the past-event cutoff below.
   *
   * The vertical normally lists only what a team can still go to, so a finished
   * event is noise in a review queue. But the site's "already run" view wants
   * this season's past off-seasons too, and a one-time backfill sets e.g.
   * [2026] to surface them. Nothing here publishes: past events land as pending
   * candidates, deduped by tba_key in discover.ts, exactly like every other
   * lead. The daily sweep sends no such value, so its scope is unchanged.
   */
  includePastSeasons?: number[]
}

export class TbaOffseasonEventsConnector implements EventListingConnector {
  name = 'tba_offseason_events'
  vertical = 'event' as const
  sourceKind = 'tba_offseason'

  async run(ctx: ListingConnectorContext): Promise<ListingConnectorResult<EventListingCandidateInput>> {
    const candidates: EventListingCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    let skipped = 0

    const config = (ctx.config ?? {}) as TbaOffseasonConfig
    const keepRegions = (config.stateProvs ?? [])
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0)

    // Seasons whose already-run events are kept rather than dropped by the past
    // cutoff. Empty by default, so the daily sweep still lists only upcoming and
    // just-finished events.
    const includePastSeasons = new Set(
      (config.includePastSeasons ?? []).filter((y): y is number => Number.isInteger(y)),
    )

    if (keepRegions.some((r) => r.length > 3)) {
      // Someone typed "Michigan". Say so loudly rather than crawling to zero.
      limits.push(
        `stateProvs contains a long-form name (${keepRegions.filter((r) => r.length > 3).join(', ')}); TBA only ever writes short codes such as MI, so those entries match nothing`,
      )
    }

    const currentYear = new Date().getFullYear()
    // Current season plus next. Off-season events run inside their season year,
    // and next year is one cheap request that catches an event registered early
    // for the following autumn. TBA answers an unopened year with an empty list.
    const years = [currentYear, currentYear + 1]

    const connector = new TbaEventsConnector()
    const cutoff = new Date(Date.now() - PAST_EVENT_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10)
    let pastEvents = 0
    let filteredByRegion = 0

    for (const year of years) {
      const result = await connector.run(year, { skipTeams: true })
      errors.push(...result.stats.errors)

      for (const event of result.events) {
        if (event.eventType === null || !OFFSEASON_EVENT_TYPES.has(event.eventType)) {
          skipped++
          continue
        }

        if (keepRegions.length > 0 && !keepRegions.includes((event.stateProv ?? '').toUpperCase())) {
          filteredByRegion++
          skipped++
          continue
        }

        // An event with no dates at all cannot be judged past or future, so it
        // is kept: a reviewer can see it, an automatic drop is invisible.
        // Already-run events are normally dropped; for a season named in
        // includePastSeasons they are kept, which is how the one-time backfill of
        // this year's finished off-seasons reaches the review queue.
        const last = event.endDate ?? event.startDate
        if (last && last < cutoff && !includePastSeasons.has(year)) {
          pastEvents++
          skipped++
          continue
        }

        const startDate = event.startDate ?? undefined
        const endDate = event.endDate ?? undefined
        const tbaUrl = `https://www.thebluealliance.com/event/${event.tbaKey}`

        candidates.push({
          // TBA's own event page is both the dedup key and the page a reviewer
          // reads. The organiser's site goes on `extracted.website`, because it
          // is frequently missing and cannot be the key.
          sourceUrl: tbaUrl,
          canonicalUrl: tbaUrl,
          title: event.name,
          description: `TBA lists this as ${event.eventTypeString ?? 'an off-season event'}. Dates, venue and location are TBA's. Cost, capacity, registration state and an organiser contact are not in TBA and still have to be filled in by hand.`,
          discoveredVia: `tba:events/${year} event_type=${event.eventType}`,
          tbaKey: event.tbaKey,
          tbaEventType: event.eventType ?? undefined,
          links: event.website ? [event.website] : undefined,
          extracted: {
            name: event.name,
            // The /events/{year} endpoint is the FRC event list. FTC comes from
            // the Orange Alliance sync, which is a different connector.
            program: 'frc',
            venueName: event.venue ?? undefined,
            address: event.address ?? undefined,
            city: event.city ?? undefined,
            region: event.stateProv ?? undefined,
            country: event.country ?? undefined,
            startDate,
            endDate,
            // NOT days. TBA gives the span, and competition days are not the
            // span: a Friday-to-Sunday event with a Friday load-in is two
            // days, not three. The reader works it out from the schedule; a
            // guess from the dates is the exact mistake that put a 3 on
            // several listings.
            website: event.website ?? undefined,
            tbaKey: event.tbaKey,
          },
        })
      }
    }

    if (pastEvents > 0) {
      limits.push(
        `${pastEvents} off-season events that finished more than ${PAST_EVENT_GRACE_DAYS} days ago were not listed`,
      )
    }
    if (includePastSeasons.size > 0) {
      limits.push(
        `backfill mode: already-run events kept for season(s) ${[...includePastSeasons].sort().join(', ')}`,
      )
    }
    if (filteredByRegion > 0) {
      limits.push(
        `${filteredByRegion} off-season events were dropped by the stateProvs filter (${keepRegions.join(', ')})`,
      )
    }
    limits.push(`seasons swept: ${years.join(', ')}; earlier seasons were not read`)

    console.log(
      `[tba-offseason-events] ${candidates.length} candidates from ${years.join('/')}, ${skipped} skipped`,
    )
    return { candidates, skipped, errors, limits }
  }
}
