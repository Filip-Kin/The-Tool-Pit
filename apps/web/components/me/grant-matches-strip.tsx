import { ArrowUpRight, CalendarClock, HelpCircle } from 'lucide-react'
import { differenceInCalendarDays, format } from 'date-fns'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantMatches, grants, grantCycles, teamProfiles, teamProfileMembers } from '@the-tool-pit/db'
import { GRANTS_ORIGIN, resolveFavoriteHref } from './vertical-links'

/** How many matches the strip shows. Anything beyond this is counted, not dropped. */
const DISPLAY_LIMIT = 4

interface MatchRow {
  id: string
  verdict: string
  grantName: string
  grantSlug: string
  awardMin: number | null
  awardMax: number | null
  currency: string
  teamNumber: number
  program: string
  deadlineAt: Date | null
  /** Human confirmation on the CYCLE. Without it we do not show a date. */
  deadlineVerifiedAt: Date | null
}

/**
 * "Grants you may be eligible for".
 *
 * Matching is per team PROFILE, not per user, so this only has anything to say
 * once a team the user is a MEMBER of also has a profile in the grants
 * vertical. Until the vertical is populated that is nobody, and the strip
 * renders nothing rather than an empty box.
 *
 * It takes a userId and not a list of teams on purpose. It used to resolve
 * profiles by matching the user's accounts.userTeams claims on program and
 * team number, and userTeams is self-asserted: /me/team accepts any number
 * with no verification whatsoever. So anyone could type "FRC 254", and this
 * strip would render 254's live match list, which is computed FROM 254's
 * private profile (EIN, org type, Title I status, budget, region). That
 * contradicts the rule app/me/team/profile/queries.ts states at the top of
 * the file: profile-derived reads go through team_profile_members, and a
 * claim alone never opens one.
 */
export async function GrantMatchesStrip({ userId }: { userId: string }) {
  const data = await loadMatches(userId)
  if (!data || data.rows.length === 0) return null

  const shown = data.rows.slice(0, DISPLAY_LIMIT)
  const hidden = data.total - shown.length

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Grants you may be eligible for</h2>
          <p className="text-sm text-muted">
            Matched against your team profile. Check the funder&apos;s own page before you rely on any of it.
          </p>
        </div>
        {/*
          Points at the grants index, not a /matches page. The grants vertical
          owns its own routes and this file must not invent one, so the honest
          link is the index and the real total is stated in the line below.
        */}
        <a
          href={GRANTS_ORIGIN}
          className="flex shrink-0 items-center gap-1 text-sm text-primary transition-colors hover:text-primary-hover"
        >
          Open grants
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((row) => (
          <li key={row.id}>
            <MatchCard row={row} />
          </li>
        ))}
      </ul>

      {/* No silent caps: say out loud that the strip is showing a subset. */}
      {hidden > 0 && (
        <p className="mt-3 text-xs text-muted-2">
          Showing the {shown.length} highest scoring of {data.total} matches across your teams.
        </p>
      )}
    </section>
  )
}

function MatchCard({ row }: { row: MatchRow }) {
  return (
    <a
      // Same path shape a saved grant uses, resolved through the one helper
      // that knows which origin each vertical lives on.
      href={resolveFavoriteHref('grant', `/grants/${row.grantSlug}`)}
      className="flex h-full flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-foreground">{row.grantName}</span>
        <VerdictTag verdict={row.verdict} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {awardLabel(row) && <span>{awardLabel(row)}</span>}
        <Deadline row={row} />
      </div>
      <span className="text-xs text-muted-2">
        Matched on team {row.teamNumber} ({row.program.toUpperCase()})
      </span>
    </a>
  )
}

/**
 * A deadline is only shown once a human has confirmed the cycle. An unverified
 * scraped date is worse than no date at all, so it renders as an explicit
 * "not confirmed" instead.
 */
function Deadline({ row }: { row: MatchRow }) {
  if (!row.deadlineAt || !row.deadlineVerifiedAt) {
    return (
      <span className="flex items-center gap-1 text-muted-2">
        <HelpCircle className="h-3 w-3" />
        Deadline not confirmed
      </span>
    )
  }
  const days = differenceInCalendarDays(row.deadlineAt, new Date())
  return (
    <span className="flex items-center gap-1">
      <CalendarClock className="h-3 w-3" />
      {format(row.deadlineAt, 'd MMM yyyy')}
      {days >= 0 && <span className={days <= 14 ? 'text-official' : 'text-muted-2'}>· {days} days left</span>}
    </span>
  )
}

function VerdictTag({ verdict }: { verdict: string }) {
  const eligible = verdict === 'eligible'
  return (
    <span
      className={
        eligible
          ? 'shrink-0 rounded-full border border-rookie/30 bg-rookie/15 px-2 py-0.5 text-xs font-medium text-rookie'
          : 'shrink-0 rounded-full border border-border bg-surface-3 px-2 py-0.5 text-xs font-medium text-muted'
      }
    >
      {eligible ? 'Eligible' : 'Likely'}
    </span>
  )
}

function awardLabel(row: MatchRow): string | null {
  if (row.awardMax == null && row.awardMin == null) return null
  const money = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: row.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  if (row.awardMin != null && row.awardMax != null && row.awardMin !== row.awardMax) {
    return `${money(row.awardMin)} to ${money(row.awardMax)}`
  }
  return `Up to ${money(row.awardMax ?? row.awardMin!)}`
}

/**
 * Read the user's live matches.
 *
 * Two queries on purpose: the strip shows a handful, but the "and N more" line
 * has to be a real number, and guessing it from a fetched page would be the
 * kind of quiet cap this product is not allowed to have.
 *
 * The whole thing is wrapped because the grants tables may not be migrated on
 * every environment yet, and a missing relation must not take out the personal
 * home page. A failure is logged, never swallowed silently.
 */
async function loadMatches(userId: string): Promise<{ rows: MatchRow[]; total: number } | null> {
  try {
    const db = getDb()

    // Membership, not a claim. Any role reads, including 'viewer'; only
    // writing is restricted further, and that gate lives in the profile
    // queries rather than here.
    const profiles = await db
      .select({ id: teamProfileMembers.profileId })
      .from(teamProfileMembers)
      .where(eq(teamProfileMembers.userId, userId))
    if (profiles.length === 0) return null

    const profileIds = profiles.map((p) => p.id)
    const live = and(
      inArray(grantMatches.profileId, profileIds),
      inArray(grantMatches.verdict, ['eligible', 'likely']),
      isNull(grantMatches.dismissedAt),
      eq(grants.status, 'published'),
    )

    const rows = await db
      .select({
        id: grantMatches.id,
        verdict: grantMatches.verdict,
        grantName: grants.name,
        grantSlug: grants.slug,
        awardMin: grants.awardMin,
        awardMax: grants.awardMax,
        currency: grants.awardCurrency,
        teamNumber: teamProfiles.teamNumber,
        program: teamProfiles.program,
        deadlineAt: grantCycles.deadlineAt,
        deadlineVerifiedAt: grantCycles.verifiedAt,
      })
      .from(grantMatches)
      .innerJoin(grants, eq(grants.id, grantMatches.grantId))
      .innerJoin(teamProfiles, eq(teamProfiles.id, grantMatches.profileId))
      .leftJoin(grantCycles, eq(grantCycles.id, grantMatches.cycleId))
      .where(live)
      .orderBy(desc(grantMatches.score))
      .limit(DISPLAY_LIMIT)

    if (rows.length === 0) return { rows: [], total: 0 }

    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(grantMatches)
      .innerJoin(grants, eq(grants.id, grantMatches.grantId))
      .where(live)

    return { rows, total: counted?.n ?? rows.length }
  } catch (err) {
    console.warn('[me] grant matches unavailable, hiding the strip:', err)
    return null
  }
}
