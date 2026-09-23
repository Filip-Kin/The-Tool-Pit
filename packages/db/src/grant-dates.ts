/**
 * Cycle dates, shared by the worker and the site so a cycle's status and a
 * date-only deadline mean the same thing wherever they are written.
 *
 * Two rules live here:
 *
 * 1. Status comes from the dates whenever there are dates. Opens in the
 *    future: upcoming. Between opening and deadline: open. Deadline past:
 *    closed. 30 of 38 grants published on 2026-09-23 had a cycle stored as
 *    'unknown' (or 'open' in the wrong season) next to dates that said
 *    otherwise.
 *
 * 2. A deadline the funder gave as a day with no time is stored as 23:59 on
 *    that day in the funder's timezone, not left empty. Leaving it empty
 *    (the old "move the date into the note" rule) lost the date: the card
 *    said "dates not confirmed" beside a funder page that said October 17.
 *    The funder's timezone is its state's or province's for a state, local
 *    or regional grant, else America/New_York: the earliest continental US
 *    zone, so a national deadline read as Eastern is never later than the
 *    funder meant.
 */
import type { GrantCycleStatus } from './grant-enums'

// #region status

/**
 * Cycle status from its dates. Derived, never typed by hand, so a cycle cannot
 * sit at 'open' for a year after it shut.
 *
 * With no deadline and no future opening date there is nothing to derive
 * from, and `stated` (what the funder's page says: open or closed) is used;
 * with no statement either, 'unknown'. A page that says "closed" also wins
 * over a deadline still ahead: funders close early when the money runs out.
 */
export function deriveCycleStatus(
  opensAt: string | Date | null | undefined,
  deadlineAt: Date | null | undefined,
  now: Date = new Date(),
  stated?: GrantCycleStatus | string | null,
): GrantCycleStatus {
  if (deadlineAt && deadlineAt.getTime() < now.getTime()) return 'closed'
  if (stated === 'closed' && (deadlineAt || opensAt)) {
    // Closed early, or last round's banner before the new opening date: an
    // opening date still ahead says the next round is coming.
    const opens = parseOpens(opensAt)
    return opens && opens.getTime() > now.getTime() ? 'upcoming' : 'closed'
  }
  const opens = parseOpens(opensAt)
  if (opens && opens.getTime() > now.getTime()) return 'upcoming'
  if (deadlineAt) return 'open'
  if (stated === 'open' || stated === 'closed' || stated === 'upcoming') return stated
  return 'unknown'
}

/**
 * grant_cycles.opens_at is a DATE column, so drizzle hands back 'YYYY-MM-DD'.
 * Parse as UTC midnight; a one-day error on an opening date is not worth
 * carrying a timezone for.
 */
function parseOpens(opensAt: string | Date | null | undefined): Date | null {
  if (!opensAt) return null
  const opens = opensAt instanceof Date ? opensAt : new Date(`${opensAt}T00:00:00Z`)
  return Number.isNaN(opens.getTime()) ? null : opens
}

// #endregion

// #region date-only deadlines

/** The deadline note on a cycle whose deadline had no time of day. A label, not a sentence. */
export const DATE_ONLY_NOTE = 'No time given'

/** True when a cycle's note says its deadline is a date with no time (either wording ever written). */
export function isDateOnlyNote(note: string | null | undefined): boolean {
  return /\bno time given\b|no time of day/i.test(note ?? '')
}

/** The note with the date-only marker taken off, for showing whatever the funder added. */
export function dateOnlyNoteRest(note: string | null | undefined): string {
  return (note ?? '')
    .replace(/^\s*no time given\.?\s*/i, '')
    .replace(/the funder states the date; no time of day given\.?/i, '')
    .replace(/^closes \d{4}-\d{2}-\d{2} \(the funder gives no time of day\)\.?/i, '')
    .trim()
}

/**
 * The calendar day of a date-only deadline. The stored instant is 23:59 in
 * the funder's zone, which is the next day in UTC; twelve hours back lands on
 * the funder's day for every zone from UTC-11 to UTC+11, and on the same day
 * for the rows stored at 23:59:59Z before this rule.
 */
export function dateOnlyDeadlineDay(deadlineAt: Date | string): string {
  const t = deadlineAt instanceof Date ? deadlineAt.getTime() : Date.parse(deadlineAt)
  return new Date(t - 12 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * The zone most of each US state or Canadian province keeps; where a state
 * is split with no clear majority, the earlier zone, so no team misses it.
 */
export const REGION_TIME_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/New_York', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver', PR: 'America/Puerto_Rico',
  AB: 'America/Edmonton', BC: 'America/Vancouver', MB: 'America/Winnipeg', NB: 'America/Moncton', NL: 'America/St_Johns',
  NS: 'America/Halifax', NT: 'America/Yellowknife', NU: 'America/Iqaluit', ON: 'America/Toronto', PE: 'America/Halifax',
  QC: 'America/Toronto', SK: 'America/Regina', YT: 'America/Whitehorse',
}

export const DEFAULT_DEADLINE_TIME_ZONE = 'America/New_York'

/** The zone a date-only deadline is read in: the first state's for a state, local or regional grant, else Eastern. */
export function funderTimeZone(grant: { geoScope?: string | null; regions?: readonly string[] | null }): string {
  if (grant.geoScope === 'state' || grant.geoScope === 'local' || grant.geoScope === 'region') {
    for (const r of grant.regions ?? []) {
      const code = r.trim().toUpperCase().replace(/^(US|CA)-/, '')
      const zone = REGION_TIME_ZONES[code]
      if (zone) return zone
    }
  }
  return DEFAULT_DEADLINE_TIME_ZONE
}

/** Minutes east of UTC that `zone` keeps at `instant`. */
function offsetMinutes(zone: string, instant: number): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = part.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
  return m[1] === '-' ? -minutes : minutes
}

/**
 * 23:59 on `day` ("YYYY-MM-DD") in `zone`, as an ISO instant with the zone's
 * own offset that day ("2026-10-17T23:59:00-04:00"). Null for a malformed day.
 */
export function endOfDayIn(day: string, zone: string = DEFAULT_DEADLINE_TIME_ZONE): string | null {
  const m = day.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59)
  if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 10) !== day.trim()) return null
  let off = offsetMinutes(zone, wall)
  const second = offsetMinutes(zone, wall - off * 60_000)
  if (second !== off) off = second
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  return `${day.trim()}T23:59:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

// #endregion
