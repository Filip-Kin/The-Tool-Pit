/**
 * TOA (The Orange Alliance) FTC events connector.
 * Syncs the authoritative FTC event list for a season from the self-hosted TOA
 * API, plus each event's team roster. Like tba-events this writes directly
 * (TOA is the source of truth); it does NOT produce moderation candidates.
 *
 * Required env vars:
 *   TOA_API_KEY          - X-TOA-Key header value
 *   TOA_APPLICATION_ORIGIN - X-Application-Origin header value (app name)
 * Optional:
 *   TOA_API_BASE - defaults to https://api.theorangealliance.org
 */
import { politeFetch, delay } from './base.js'

const DEFAULT_BASE = 'https://api.theorangealliance.org'

export interface ToaEventUpsert {
  program: 'ftc'
  tbaKey: string
  sourceKey: string
  eventCode: string
  year: number
  name: string
  startDate: string | null
  endDate: string | null
  eventTypeString: string | null
  city: string | null
  stateProv: string | null
  country: string | null
  venue: string | null
  website: string | null
}

export interface ToaEventsResult {
  events: ToaEventUpsert[]
  /** tbaKey → team numbers attending */
  eventTeams: Map<string, number[]>
  stats: { events: number; teams: number; errors: string[] }
}

interface ToaEvent {
  event_key: string
  season_key: string
  event_code: string
  event_name: string
  event_type_key: string | null
  start_date: string | null
  end_date: string | null
  city: string | null
  state_prov: string | null
  country: string | null
  venue: string | null
  website: string | null
  is_public: boolean
}

interface ToaTeamParticipant {
  team_number: number
}

/** TOA season key "2223" (2022-23) → the spring competition year, 2023. */
export function seasonKeyToYear(seasonKey: string): number {
  return 2000 + parseInt(seasonKey.slice(2, 4), 10)
}

/** Competition year 2023 → TOA season key "2223". */
export function yearToSeasonKey(year: number): string {
  const start = (year - 1) % 100
  const end = year % 100
  return `${String(start).padStart(2, '0')}${String(end).padStart(2, '0')}`
}

/**
 * Build our canonical, year-prefixed key + short code from a TOA event_key.
 * "2223-OK-OT" (season 2223) → { eventCode: "ftcokot", tbaKey: "2023ftcokot" }.
 * The ftc prefix keeps FTC keys from colliding with FRC ones in the URL space.
 */
function deriveKeys(eventKey: string, seasonKey: string, year: number): { eventCode: string; tbaKey: string } {
  const withoutSeason = eventKey.toLowerCase().startsWith(`${seasonKey.toLowerCase()}-`)
    ? eventKey.slice(seasonKey.length + 1)
    : eventKey
  const slug = withoutSeason.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const eventCode = `ftc${slug}`
  return { eventCode, tbaKey: `${year}${eventCode}` }
}

export class ToaEventsConnector {
  name = 'toa_events'

  async run(seasonKey: string, opts: { skipTeams?: boolean } = {}): Promise<ToaEventsResult> {
    const key = process.env.TOA_API_KEY
    const origin = process.env.TOA_APPLICATION_ORIGIN
    const base = process.env.TOA_API_BASE || DEFAULT_BASE
    const errors: string[] = []
    const eventTeams = new Map<string, number[]>()

    if (!key || !origin) {
      console.warn('[toa-events] TOA_API_KEY / TOA_APPLICATION_ORIGIN not set - skipping')
      return { events: [], eventTeams, stats: { events: 0, teams: 0, errors: ['TOA credentials not set'] } }
    }

    const headers = { 'X-TOA-Key': key, 'X-Application-Origin': origin, 'Content-Type': 'application/json' }
    const year = seasonKeyToYear(seasonKey)

    let raw: ToaEvent[] = []
    try {
      const res = await politeFetch(`${base}/api/event?season_key=${encodeURIComponent(seasonKey)}`, { headers })
      if (!res.ok) {
        errors.push(`[toa-events] HTTP ${res.status} fetching events for ${seasonKey}`)
        return { events: [], eventTeams, stats: { events: 0, teams: 0, errors } }
      }
      raw = (await res.json()) as ToaEvent[]
    } catch (err) {
      errors.push(`[toa-events] error fetching events for ${seasonKey}: ${String(err)}`)
      return { events: [], eventTeams, stats: { events: 0, teams: 0, errors } }
    }

    const events: ToaEventUpsert[] = raw
      .filter((e) => e.is_public !== false && e.event_key)
      .map((e) => {
        const { eventCode, tbaKey } = deriveKeys(e.event_key, seasonKey, year)
        return {
          program: 'ftc' as const,
          tbaKey,
          sourceKey: e.event_key,
          eventCode,
          year,
          name: e.event_name,
          startDate: e.start_date ? e.start_date.slice(0, 10) : null,
          endDate: e.end_date ? e.end_date.slice(0, 10) : null,
          eventTypeString: e.event_type_key ?? null,
          city: e.city,
          stateProv: e.state_prov,
          country: e.country,
          venue: e.venue,
          website: e.website,
        }
      })

    console.log(`[toa-events] ${seasonKey} (${year}): ${events.length} events${opts.skipTeams ? ' (skipping rosters)' : ''}`)

    if (opts.skipTeams) {
      return { events, eventTeams, stats: { events: events.length, teams: 0, errors } }
    }

    let teamCount = 0
    for (const ev of events) {
      try {
        const res = await politeFetch(`${base}/api/event/${encodeURIComponent(ev.sourceKey)}/teams`, { headers })
        if (!res.ok) {
          if (res.status !== 404) errors.push(`[toa-events] HTTP ${res.status} for ${ev.sourceKey}/teams`)
          await delay(150)
          continue
        }
        const participants = (await res.json()) as ToaTeamParticipant[]
        const numbers = participants.map((p) => p.team_number).filter((n) => Number.isInteger(n))
        if (numbers.length > 0) {
          eventTeams.set(ev.tbaKey, numbers)
          teamCount += numbers.length
        }
      } catch (err) {
        errors.push(`[toa-events] error fetching teams for ${ev.sourceKey}: ${String(err)}`)
      }
      await delay(150)
    }

    console.log(`[toa-events] done - ${events.length} events, ${teamCount} team memberships`)
    return { events, eventTeams, stats: { events: events.length, teams: teamCount, errors } }
  }
}
