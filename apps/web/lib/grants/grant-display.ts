/**
 * Display shapes, labels and deadline maths for the grants vertical.
 *
 * ZERO DB IMPORTS on purpose. Client components (the explorer, the cards, the
 * submit form) import from here, so pulling in `@the-tool-pit/db` would drag
 * postgres into the browser bundle. Value tuples come from the
 * `@the-tool-pit/db/grant-enums` subpath, which is dependency-free for exactly
 * this reason. Same split as lib/fields/field-display.ts.
 *
 * The filter predicate and the urgency sort live here rather than in the query
 * layer so the server listing and the client explorer run the SAME code. If
 * they drifted, a grant could be visible in one and hidden in the other.
 */
import type {
  GrantProgram,
  GrantGeoScope,
  GrantEffortLevel,
  GrantDeadlineType,
  GrantCycleStatus,
  GrantRequirementKind,
  FunderType,
} from '@the-tool-pit/db/grant-enums'

// #region public shapes

/** A cycle as the public pages see it. Never carries crawl bookkeeping. */
export interface PublicGrantCycle {
  id: string
  cycleYear: number
  /** Drizzle `date` columns come back as 'YYYY-MM-DD' strings, not Dates. */
  opensAt: string | null
  /** timestamptz: a real instant, because "11:59pm ET" is a real instant. */
  deadlineAt: Date | null
  deadlineNote: string | null
  decisionAt: string | null
  status: GrantCycleStatus
  amountNote: string | null
  sourceUrl: string | null
  /** Human confirmation of THESE dates. Rendered, never inferred. */
  verifiedAt: Date | null
  /** Carried over from a previous year: always rendered as "expected". */
  isEstimated: boolean
}

export interface PublicGrantRequirement {
  id: string
  kind: GrantRequirementKind
  label: string
  isBlocking: boolean
  sortOrder: number
}

export interface PublicGrantFunder {
  id: string
  slug: string
  name: string
  type: FunderType
  website: string | null
}

/** A published grant plus everything the listing and detail pages render. */
export interface PublicGrant {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  infoUrl: string
  applicationUrl: string | null
  programs: GrantProgram[]
  geoScope: GrantGeoScope
  countries: string[]
  regions: string[]
  localityNote: string | null
  awardMin: number | null
  awardMax: number | null
  awardCurrency: string
  awardNotes: string | null
  renewable: boolean | null
  deadlineType: GrantDeadlineType
  effortLevel: GrantEffortLevel
  /** When a HUMAN last checked this against the funder's own page. */
  verifiedAt: Date | null
  funder: PublicGrantFunder | null
  cycles: PublicGrantCycle[]
  requirements: PublicGrantRequirement[]
}

// #endregion

// #region deadline maths

/**
 * The state a team actually cares about, derived from the dates rather than
 * read off grantCycles.status. The schema comment is explicit that the stored
 * status is derived on a schedule, so between scheduler runs it can lag; the
 * dates cannot. Stored status is only the fallback when there are no dates.
 */
export type GrantDeadlineState = 'open' | 'upcoming' | 'closed' | 'rolling' | 'unknown'

export interface ResolvedCycle {
  /** The cycle a team cares about, or null when the grant has no cycles yet. */
  cycle: PublicGrantCycle | null
  state: GrantDeadlineState
  /**
   * Whole days from `now` to the deadline instant, rounded up, negative once
   * past. Instant arithmetic, so it is correct no matter which timezone the
   * reader or the funder is in. Null when there is no deadline to count to.
   */
  daysRemaining: number | null
  msRemaining: number | null
  /** True when the chosen cycle's dates are an expectation, not published. */
  isEstimated: boolean
}

const MS_PER_DAY = 86_400_000

/**
 * Parse a 'YYYY-MM-DD' date column as midnight UTC.
 *
 * `new Date('2026-03-01')` already does this, but `new Date('2026-3-1')` does
 * not, and a date column that has been round-tripped through anything is not
 * guaranteed to keep its zero padding. Parsing the parts by hand removes the
 * question, and it never shifts the calendar day by the server's timezone.
 */
export function parsePlainDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

/** The state of one cycle at instant `now`. */
export function cycleState(cycle: PublicGrantCycle, now: Date): GrantDeadlineState {
  if (cycle.deadlineAt) {
    if (cycle.deadlineAt.getTime() <= now.getTime()) return 'closed'
    const opens = parsePlainDate(cycle.opensAt)
    // opensAt is a plain date, so "opens today" counts as open, not upcoming.
    if (opens && opens.getTime() > now.getTime() + MS_PER_DAY) return 'upcoming'
    return 'open'
  }
  // No deadline on the row: fall back to whatever the scheduler last wrote.
  if (cycle.status === 'open' || cycle.status === 'upcoming' || cycle.status === 'closed') {
    return cycle.status
  }
  return 'unknown'
}

/**
 * Pick the cycle a team actually cares about: the next one still to close
 * (nearest deadline first), and failing that the most recent closed one.
 *
 * A closed grant keeps its cycle rather than resolving to nothing, because
 * "closed, last deadline was 3 March" is the thing that tells a team roughly
 * when to come back. That is the whole reason cycles keep history.
 */
export function resolveNextCycle(grant: PublicGrant, now: Date = new Date()): ResolvedCycle {
  const rolling = grant.deadlineType === 'rolling'
  const cycles = grant.cycles

  if (cycles.length === 0) {
    return {
      cycle: null,
      state: rolling ? 'rolling' : 'unknown',
      daysRemaining: null,
      msRemaining: null,
      isEstimated: false,
    }
  }

  const live = cycles
    .map((cycle) => ({ cycle, state: cycleState(cycle, now) }))
    .filter((c) => c.state === 'open' || c.state === 'upcoming')
    .sort((a, b) => (a.cycle.deadlineAt?.getTime() ?? Infinity) - (b.cycle.deadlineAt?.getTime() ?? Infinity))

  const chosen =
    live[0] ??
    // Nothing live: the most recently closed cycle, by deadline where we have
    // one and by cycle year where we do not.
    [...cycles]
      .map((cycle) => ({ cycle, state: cycleState(cycle, now) }))
      .sort((a, b) => {
        const at = a.cycle.deadlineAt?.getTime()
        const bt = b.cycle.deadlineAt?.getTime()
        if (at != null && bt != null) return bt - at
        if (at != null) return -1
        if (bt != null) return 1
        return b.cycle.cycleYear - a.cycle.cycleYear
      })[0]

  const ms = chosen.cycle.deadlineAt ? chosen.cycle.deadlineAt.getTime() - now.getTime() : null

  return {
    cycle: chosen.cycle,
    // A rolling grant that also happens to carry cycles is still rolling: the
    // cycles are review rounds, not a closing date.
    state: rolling ? 'rolling' : chosen.state,
    daysRemaining: ms == null ? null : Math.ceil(ms / MS_PER_DAY),
    msRemaining: ms,
    isEstimated: chosen.cycle.isEstimated,
  }
}

/**
 * Timezone used to render a deadline's wall-clock date and time.
 *
 * A deadline is an instant, but a team reads it as a date. Rendering it in the
 * reader's own zone turns "11:59pm ET, 28 February" into "1 March, 4:59pm" for
 * a team in New Zealand, which reads like a different deadline. Rendering it in
 * one fixed, named zone with the zone shown is unambiguous, and it is identical
 * on the server and in the browser, so it cannot cause a hydration mismatch.
 * Nearly every grant here is a US one; deadlineNote still carries the funder's
 * own wording next to it.
 */
export const GRANT_DISPLAY_TIME_ZONE = 'America/New_York'

/** "28 Feb 2026, 11:59 pm EST". Fixed zone, so server and client agree. */
export function formatDeadline(at: Date | null | undefined): string | null {
  if (!at) return null
  const stamp = new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: GRANT_DISPLAY_TIME_ZONE,
  }).format(at)

  // The zone abbreviation is taken from en-US, which is the only locale that
  // knows a US zone as "EST" and "EDT"; en-NZ renders the same instant as
  // "GMT-5", which is correct but is not what the funder's own page calls it.
  // The date order stays ours. Both are fixed strings, so this is still
  // identical on the server and in the browser.
  const zone = new Intl.DateTimeFormat('en-US', {
    timeZone: GRANT_DISPLAY_TIME_ZONE,
    timeZoneName: 'short',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value

  return zone ? `${stamp} ${zone}` : stamp
}

/** "28 Feb 2026" for a plain date column, read in UTC so the day never shifts. */
export function formatPlainDate(value: string | null | undefined): string | null {
  const d = parsePlainDate(value)
  if (!d) return null
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/** "12 Aug 2026" for a timestamptz we only want the day of (verified on, etc). */
export function formatDay(at: Date | null | undefined): string | null {
  if (!at) return null
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: GRANT_DISPLAY_TIME_ZONE,
  }).format(at)
}

/** Short countdown for a card: "closes today", "3 days left", "in 6 weeks". */
export function formatCountdown(daysRemaining: number | null): string | null {
  if (daysRemaining == null) return null
  if (daysRemaining < 0) return 'closed'
  if (daysRemaining === 0) return 'closes today'
  if (daysRemaining === 1) return '1 day left'
  if (daysRemaining <= 21) return `${daysRemaining} days left`
  if (daysRemaining <= 60) return `${Math.round(daysRemaining / 7)} weeks left`
  return `${Math.round(daysRemaining / 30)} months left`
}

/** Urgency tone for the countdown. Amber inside a fortnight, red inside a week. */
export function countdownTone(daysRemaining: number | null): 'urgent' | 'soon' | 'normal' {
  if (daysRemaining == null || daysRemaining < 0) return 'normal'
  if (daysRemaining <= 7) return 'urgent'
  if (daysRemaining <= 21) return 'soon'
  return 'normal'
}

// #endregion

// #region labels

export const PROGRAM_LABEL: Record<GrantProgram, string> = {
  frc: 'FRC',
  ftc: 'FTC',
  fll: 'FLL',
  any: 'Any STEM programme',
}

export const FUNDER_TYPE_LABEL: Record<FunderType, string> = {
  foundation: 'Foundation',
  corporate: 'Corporate',
  government: 'Government',
  nonprofit: 'Non-profit',
  community: 'Community',
  university: 'University',
  other: 'Funder',
}

export const GEO_SCOPE_LABEL: Record<GrantGeoScope, string> = {
  international: 'International',
  national: 'National',
  state: 'State or province',
  region: 'Regional',
  local: 'Local',
}

export const EFFORT_LABEL: Record<GrantEffortLevel, string> = {
  low: 'Light application',
  medium: 'Moderate application',
  high: 'Heavy application',
  unknown: 'Effort unknown',
}

export const EFFORT_SHORT_LABEL: Record<GrantEffortLevel, string> = {
  low: 'Light',
  medium: 'Moderate',
  high: 'Heavy',
  unknown: 'Unknown effort',
}

export const DEADLINE_TYPE_LABEL: Record<GrantDeadlineType, string> = {
  fixed: 'One-off deadline',
  annual_window: 'Opens every year',
  rolling: 'Rolling, no deadline',
  unknown: 'Deadline not confirmed',
}

export const DEADLINE_STATE_LABEL: Record<GrantDeadlineState, string> = {
  open: 'Open now',
  upcoming: 'Opens soon',
  closed: 'Closed',
  rolling: 'Rolling',
  unknown: 'Dates not confirmed',
}

/**
 * Grouping headings for requirements. `isBlocking` is the real split, not the
 * kind: a blocking requirement can rule a team out, everything else is context.
 */
export const REQUIREMENT_KIND_LABEL: Record<GrantRequirementKind, string> = {
  org_type: 'Organisation type',
  fiscal_sponsor_ok: 'Fiscal sponsor',
  country: 'Country',
  region: 'State or region',
  program: 'Programme',
  team_age_years: 'Team age',
  rookie_only: 'Rookie teams',
  title_i: 'Title I',
  school_type: 'School type',
  student_count: 'Student numbers',
  demographics: 'Demographics',
  matching_funds: 'Matching funds',
  prior_grantee: 'Previous grantees',
  use_of_funds: 'Use of funds',
  application_material: 'What you must submit',
  other: 'Also note',
}

/**
 * Country codes we can name. Anything not in here renders as the raw code
 * rather than a guess, because inventing "TR = Turkey" style mappings is how
 * a listing ends up quietly wrong about who can apply.
 */
const COUNTRY_LABEL: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  GB: 'United Kingdom',
  AU: 'Australia',
  NZ: 'New Zealand',
  IL: 'Israel',
  TR: 'Türkiye',
  BR: 'Brazil',
  CN: 'China',
  TW: 'Chinese Taipei',
  JP: 'Japan',
  IN: 'India',
  NL: 'Netherlands',
  DE: 'Germany',
}

export function countryLabel(code: string): string {
  return COUNTRY_LABEL[code.toUpperCase()] ?? code
}

/** One line describing who can apply geographically. */
export function geographyLabel(grant: Pick<PublicGrant, 'geoScope' | 'countries' | 'regions' | 'localityNote'>): string {
  if (grant.geoScope === 'international') return 'International'
  const parts: string[] = []
  if (grant.regions.length > 0) parts.push(grant.regions.join(', '))
  if (grant.countries.length > 0) parts.push(grant.countries.map(countryLabel).join(', '))
  if (grant.localityNote) parts.push(grant.localityNote)
  return parts.length > 0 ? parts.join(' · ') : GEO_SCOPE_LABEL[grant.geoScope]
}

function money(amount: number, currency: string): string {
  // Locale is pinned so the server and the browser format identically.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** "$2,500 to $10,000", "up to $5,000", "from $1,000", or null when unknown. */
export function formatAwardRange(
  grant: Pick<PublicGrant, 'awardMin' | 'awardMax' | 'awardCurrency'>,
): string | null {
  const { awardMin: min, awardMax: max, awardCurrency: cur } = grant
  if (min != null && max != null) {
    return min === max ? money(min, cur) : `${money(min, cur)} to ${money(max, cur)}`
  }
  if (max != null) return `up to ${money(max, cur)}`
  if (min != null) return `from ${money(min, cur)}`
  return null
}

/** The number a size filter compares against: the top of the range if we have one. */
export function awardCeiling(grant: Pick<PublicGrant, 'awardMin' | 'awardMax'>): number | null {
  return grant.awardMax ?? grant.awardMin ?? null
}

// #endregion

// #region filtering and sorting

export interface GrantFilters {
  /** Free text over name, funder, summary. */
  q?: string
  programs?: GrantProgram[]
  countries?: string[]
  /** State or province codes. Matched against grants.regions. */
  regions?: string[]
  /** Award band, compared against the top of the grant's range. */
  awardMin?: number
  awardMax?: number
  /** Only grants closing within this many days. Rolling grants always pass. */
  withinDays?: number
  effortLevels?: GrantEffortLevel[]
  /** Only rolling grants, for a team that has missed every deadline this year. */
  rollingOnly?: boolean
  /** Hide closed grants. Off by default: a closed grant still tells you when to come back. */
  hideClosed?: boolean
}

export const EMPTY_GRANT_FILTERS: GrantFilters = {}

/** Preset award bands for the filter UI. `max` null means "and above". */
export const AWARD_BANDS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: 'to1k', label: 'Up to $1k', min: 0, max: 1000 },
  { key: '1kto5k', label: '$1k to $5k', min: 1000, max: 5000 },
  { key: '5kto25k', label: '$5k to $25k', min: 5000, max: 25000 },
  { key: '25kplus', label: '$25k and up', min: 25000, max: null },
]

/** Preset deadline windows for the filter UI. */
export const DEADLINE_WINDOWS: { key: string; label: string; days: number }[] = [
  { key: '30', label: 'Closes in 30 days', days: 30 },
  { key: '60', label: 'Closes in 60 days', days: 60 },
  { key: '90', label: 'Closes in 90 days', days: 90 },
]

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.includes(x))
}

/**
 * Does one grant pass the filters? Pure, so the server listing and the client
 * explorer cannot disagree about what is visible.
 */
export function matchesFilters(grant: PublicGrant, filters: GrantFilters, now: Date = new Date()): boolean {
  const q = filters.q?.trim().toLowerCase()
  if (q) {
    const hay = [grant.name, grant.funder?.name, grant.summary, grant.localityNote]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }

  // 'any' funds every programme, so it matches whatever the team picked.
  if (filters.programs?.length && !grant.programs.includes('any') && !overlaps(grant.programs, filters.programs)) {
    return false
  }

  if (filters.countries?.length && !overlaps(grant.countries, filters.countries)) return false

  // A national grant carries no regions, so a region filter must not hide it:
  // the schema requires regions only for scopes narrower than national.
  if (filters.regions?.length && grant.regions.length > 0 && !overlaps(grant.regions, filters.regions)) {
    return false
  }

  if (filters.effortLevels?.length && !filters.effortLevels.includes(grant.effortLevel)) return false

  const ceiling = awardCeiling(grant)
  if (filters.awardMin != null || filters.awardMax != null) {
    // An unknown award size is kept rather than dropped. Hiding a grant because
    // nobody has confirmed its number yet is a silent cap on coverage.
    if (ceiling != null) {
      if (filters.awardMin != null && ceiling < filters.awardMin) return false
      if (filters.awardMax != null && ceiling > filters.awardMax) return false
    }
  }

  const resolved = resolveNextCycle(grant, now)
  if (filters.rollingOnly && resolved.state !== 'rolling') return false
  if (filters.hideClosed && resolved.state === 'closed') return false

  if (filters.withinDays != null && resolved.state !== 'rolling') {
    if (resolved.daysRemaining == null) return false
    if (resolved.daysRemaining < 0 || resolved.daysRemaining > filters.withinDays) return false
  }

  return true
}

/** Sort rank for the urgency ordering. Lower sorts first. */
const STATE_RANK: Record<GrantDeadlineState, number> = {
  open: 0,
  upcoming: 1,
  rolling: 2,
  unknown: 3,
  closed: 4,
}

/**
 * Urgency order: whatever is closing soonest, then rolling, then anything we
 * cannot date, then closed grants (most recently closed first, because that is
 * the best predictor of when the next window opens).
 */
export function sortByUrgency(grants: PublicGrant[], now: Date = new Date()): PublicGrant[] {
  const decorated = grants.map((grant) => ({ grant, resolved: resolveNextCycle(grant, now) }))
  decorated.sort((a, b) => {
    const rank = STATE_RANK[a.resolved.state] - STATE_RANK[b.resolved.state]
    if (rank !== 0) return rank
    if (a.resolved.state === 'closed') {
      // Most recently closed first.
      return (b.resolved.msRemaining ?? -Infinity) - (a.resolved.msRemaining ?? -Infinity)
    }
    const at = a.resolved.msRemaining
    const bt = b.resolved.msRemaining
    if (at != null && bt != null && at !== bt) return at - bt
    if (at != null && bt == null) return -1
    if (at == null && bt != null) return 1
    return a.grant.name.localeCompare(b.grant.name)
  })
  return decorated.map((d) => d.grant)
}

// #endregion

// #region expected reopening

/**
 * When a closed annual grant is expected to come round again.
 *
 * Only ever derived for `annual_window` grants, and only from a deadline the
 * funder actually published in a previous year. For a one-off or an unknown
 * deadline type this returns null rather than a guess: a wrong date is worse
 * than no date, and this string is the one place on the card where we are
 * talking about a date nobody has confirmed. The caller always renders it with
 * the word "expected" attached.
 */
export function expectedNextWindow(grant: PublicGrant, now: Date = new Date()): string | null {
  if (grant.deadlineType !== 'annual_window') return null

  const dated = grant.cycles.filter((c) => c.deadlineAt != null)
  if (dated.length === 0) return null

  // The most recent published deadline is the best predictor we have. Prefer a
  // cycle the funder published over one we already estimated ourselves,
  // otherwise an estimate gets used to make the next estimate.
  const published = dated.filter((c) => !c.isEstimated)
  const basis = (published.length > 0 ? published : dated).reduce((latest, c) =>
    (c.deadlineAt as Date).getTime() > (latest.deadlineAt as Date).getTime() ? c : latest,
  )

  // Roll the known deadline forward a year at a time until it is ahead of us.
  // Comparing month numbers instead would get the current month wrong: a
  // deadline of 20 March last year is still to come on 5 March this year but
  // already gone on 25 March, and only the whole date can tell those apart.
  // The loop runs once per year the listing has been dormant, so it is a
  // handful of iterations at worst.
  const projected = new Date((basis.deadlineAt as Date).getTime())
  while (projected.getTime() <= now.getTime()) {
    projected.setUTCFullYear(projected.getUTCFullYear() + 1)
  }

  return new Intl.DateTimeFormat('en-NZ', {
    month: 'long',
    year: 'numeric',
    timeZone: GRANT_DISPLAY_TIME_ZONE,
  }).format(projected)
}

// #endregion
