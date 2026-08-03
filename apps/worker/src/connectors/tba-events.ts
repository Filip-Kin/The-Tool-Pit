/**
 * TBA (The Blue Alliance) Events connector.
 * Syncs the authoritative FRC event list for a season, plus each event's team
 * roster (for team-number search). Unlike the album connectors this does NOT
 * produce moderation candidates - TBA is the source of truth and its rows are
 * written directly by the album-ingest job.
 *
 * Required env var:
 *   TBA_API_KEY - The Blue Alliance API key (https://www.thebluealliance.com/account)
 */
import { politeFetch, delay } from './base.js'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

export interface TbaEventUpsert {
  tbaKey: string
  eventCode: string
  year: number
  name: string
  shortName: string | null
  startDate: string | null
  endDate: string | null
  /** Human 1-indexed competition week, or null. */
  week: number | null
  eventType: number | null
  eventTypeString: string | null
  city: string | null
  stateProv: string | null
  country: string | null
  venue: string | null
  website: string | null
}

export interface TbaEventsResult {
  events: TbaEventUpsert[]
  /** tbaKey → team numbers attending */
  eventTeams: Map<string, number[]>
  stats: { events: number; teams: number; errors: string[] }
}

interface TbaEvent {
  key: string
  event_code: string
  name: string
  short_name: string | null
  start_date: string | null
  end_date: string | null
  year: number
  week: number | null
  event_type: number | null
  event_type_string: string | null
  city: string | null
  state_prov: string | null
  country: string | null
  location_name: string | null
  website: string | null
}

export class TbaEventsConnector {
  name = 'tba_events'

  async run(year: number, opts: { skipTeams?: boolean } = {}): Promise<TbaEventsResult> {
    const tbaApiKey = process.env.TBA_API_KEY
    const errors: string[] = []
    const eventTeams = new Map<string, number[]>()

    if (!tbaApiKey) {
      console.warn('[tba-events] TBA_API_KEY not set - skipping')
      return { events: [], eventTeams, stats: { events: 0, teams: 0, errors: ['TBA_API_KEY not set'] } }
    }

    const headers = { 'X-TBA-Auth-Key': tbaApiKey }
    let raw: TbaEvent[] = []
    try {
      const res = await politeFetch(`${TBA_BASE}/events/${year}`, { headers })
      if (!res.ok) {
        errors.push(`[tba-events] HTTP ${res.status} fetching events/${year}`)
        return { events: [], eventTeams, stats: { events: 0, teams: 0, errors } }
      }
      raw = (await res.json()) as TbaEvent[]
    } catch (err) {
      errors.push(`[tba-events] error fetching events/${year}: ${String(err)}`)
      return { events: [], eventTeams, stats: { events: 0, teams: 0, errors } }
    }

    const events: TbaEventUpsert[] = raw.map((e) => ({
      tbaKey: e.key,
      eventCode: e.event_code.toLowerCase(),
      year: e.year,
      name: e.name,
      shortName: e.short_name,
      startDate: e.start_date,
      endDate: e.end_date,
      // TBA week is zero-indexed; present it 1-indexed. Null stays null.
      week: typeof e.week === 'number' ? e.week + 1 : null,
      eventType: e.event_type,
      eventTypeString: e.event_type_string,
      city: e.city,
      stateProv: e.state_prov,
      country: e.country,
      venue: e.location_name,
      website: e.website,
    }))

    console.log(`[tba-events] ${year}: ${events.length} events${opts.skipTeams ? ' (skipping team rosters)' : ''}`)

    let teamCount = 0
    if (opts.skipTeams) {
      return { events, eventTeams, stats: { events: events.length, teams: 0, errors } }
    }
    for (const ev of events) {
      try {
        const res = await politeFetch(`${TBA_BASE}/event/${ev.tbaKey}/teams/keys`, { headers })
        if (!res.ok) {
          if (res.status !== 404) errors.push(`[tba-events] HTTP ${res.status} for ${ev.tbaKey}/teams/keys`)
          await delay(250)
          continue
        }
        const keys = (await res.json()) as string[]
        const numbers = keys
          .map((k) => parseInt(k.replace(/^frc/i, ''), 10))
          .filter((n) => Number.isInteger(n))
        eventTeams.set(ev.tbaKey, numbers)
        teamCount += numbers.length
      } catch (err) {
        errors.push(`[tba-events] error fetching teams for ${ev.tbaKey}: ${String(err)}`)
      }
      await delay(250)
    }

    console.log(`[tba-events] done - ${events.length} events, ${teamCount} team memberships`)
    return { events, eventTeams, stats: { events: events.length, teams: teamCount, errors } }
  }
}
