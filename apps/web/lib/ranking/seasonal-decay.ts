import { sql, type SQL } from 'drizzle-orm'
import { tools } from '@the-tool-pit/db'

/**
 * How much a listing's age should count against it in the Popular row.
 *
 * # Why elapsed days are the wrong clock
 *
 * Popular used to mean "collected the most stars ever", tempered by a three
 * step freshness multiplier. The steps land at 365 and 730 days, so a listing
 * pushed 364 days ago scored 1.0x and one pushed 366 days ago scored 0.35x. A
 * single day either side of an arbitrary line moved a tool by a factor of
 * nearly three, and inside each band a repo touched last week and one touched
 * eleven months ago were treated as identical.
 *
 * The fix is not a finer set of steps measured in days, because days are not
 * the unit this catalogue runs on. FIRST is seasonal. FRC competes January to
 * April and picks up again around November, FTC and FLL start in September, and
 * for everyone the genuinely quiet stretch is MAY TO AUGUST. A summer of
 * silence on an FRC library is what a normal summer looks like. Charging for it
 * makes the whole directory look like it is dying every June and recover every
 * January, which is a fact about the calendar and not about the software.
 *
 * # The clock
 *
 * Only months OUTSIDE May to August count toward a listing's age. September
 * through April is eight counted months, so one counted year is eight. A summer
 * contributes nothing.
 *
 * ONE GLOBAL WINDOW, not one per programme. The programme calendars differ at
 * the edges, FRC picking up in November against FTC in September, but they
 * agree on the quiet part, and 1084 of 1325 programme rows are FRC anyway. A
 * per programme curve would be three things to keep in step for a difference
 * that does not reach the ordering.
 *
 * # The half life
 *
 * Eight counted months, which is one counted year. Checked against the real
 * corpus rather than picked: at a one year half life the top eight of Popular
 * do not move at all and the two genuinely quiet entries, Road Runner and
 * QDriverStation, both last touched November 2025, drop six places each. At a
 * two year half life Road Runner moves two places and nothing else changes,
 * which is not worth having. Nothing new enters the top 20 under either, so the
 * curve reorders the middle and leaves the canon alone, which is the whole
 * requirement.
 *
 * # What this does NOT replace
 *
 * The inactive and archived exclusion in getTrendingTools stays. Decay cannot
 * do that job: WPILib silent for two full seasons would still score 1301 * 0.25
 * and lead the page over every maintained tool in the catalogue. Decay reorders
 * and exclusion removes, and they are not substitutes.
 *
 * A listing with no lastActivityAt keeps a flat multiplier and never decays.
 * That is 478 of 1094 published listings, and it is not evidence they are dead,
 * it is the absence of a repo to check. A calculator has no commit history.
 */

/** May, June, July and August. Silence across these months is a normal summer. */
export const QUIET_MONTHS = [5, 6, 7, 8] as const

/** September through April. One counted year. */
export const COUNTED_MONTHS_PER_YEAR = 8

/** Half life, in counted months. Eight is one counted year. */
export const DECAY_HALF_LIFE_MONTHS = 8

/**
 * Flat multiplier for a listing whose last activity is unknown.
 *
 * Carried over unchanged from the freshness multiplier it replaces. Unknown
 * means we have not checked, usually because there is no repo to check, so it
 * sits below a confirmed-current listing and well above a decayed one.
 */
export const UNKNOWN_ACTIVITY_MULTIPLIER = 0.7

/**
 * Counted months from a fixed epoch to this date, ignoring May to August.
 *
 * The counting year starts in September, so position 0 is September and
 * position 7 is April. Everything from position 8 on is the quiet stretch and
 * clamps to 8, which is what makes a summer free: every date from 1 May to 31
 * August maps to the same number.
 *
 * Whole months on purpose. "Count the months that were not summer" is one line
 * a person can check by hand against a calendar, and month resolution is ample
 * for a curve whose half life is eight of them.
 */
export function countedMonths(date: Date): number {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const countingYear = month < 9 ? year - 1 : year
  const positionInYear = (month - 9 + 12) % 12
  return countingYear * COUNTED_MONTHS_PER_YEAR + Math.min(positionInYear, COUNTED_MONTHS_PER_YEAR)
}

/**
 * The ranking multiplier for one listing. 1.0 is undecayed.
 *
 * Exported and pure so the curve can be checked without a database, and so the
 * SQL below has something to be tested against.
 */
export function seasonalDecay(lastActivityAt: Date | null | undefined, now: Date = new Date()): number {
  if (!lastActivityAt) return UNKNOWN_ACTIVITY_MULTIPLIER
  const age = Math.max(0, countedMonths(now) - countedMonths(lastActivityAt))
  return Math.pow(0.5, age / DECAY_HALF_LIFE_MONTHS)
}

/** countedMonths for a timestamp column, as SQL. Mirrors the function above. */
function countedMonthsSql(column: SQL | typeof tools.lastActivityAt): SQL<number> {
  return sql<number>`(
    (extract(year from ${column})::int - case when extract(month from ${column})::int < 9 then 1 else 0 end)
      * ${COUNTED_MONTHS_PER_YEAR}
    + least((extract(month from ${column})::int - 9 + 12) % 12, ${COUNTED_MONTHS_PER_YEAR})
  )`
}

/**
 * The decay multiplier as a SQL expression, for ordering in the database.
 *
 * Computed in the query rather than stored in a column. A stored decayed score
 * is wrong the moment it is written, because the input that moves is the clock
 * and not the tool, so keeping it true would need its own daily job to rewrite
 * 1094 rows that nothing had actually changed. This costs one arithmetic
 * expression per row over a table of a thousand.
 */
export const seasonalDecaySql: SQL<number> = sql<number>`
  case
    when ${tools.lastActivityAt} is null then ${UNKNOWN_ACTIVITY_MULTIPLIER}
    else power(
      0.5,
      greatest(0, ${countedMonthsSql(sql`now()`)} - ${countedMonthsSql(tools.lastActivityAt)})::numeric
        / ${DECAY_HALF_LIFE_MONTHS}
    )
  end
`
