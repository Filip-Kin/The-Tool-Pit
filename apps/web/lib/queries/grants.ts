import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  grants,
  grantCycles,
  grantFunders,
  grantRequirements,
  grantFormFields,
  grantWatches,
  favorites,
} from '@the-tool-pit/db'
import type { PrefillFormField } from '@/lib/grants/prefill'
import type {
  PublicGrant,
  PublicGrantCycle,
  PublicGrantRequirement,
  GrantFilters,
} from '@/lib/grants/grant-display'
import { matchesFilters, resolveNextCycle, sortByUrgency } from '@/lib/grants/grant-display'
import type {
  GrantProgram,
  GrantGeoScope,
  GrantEffortLevel,
  GrantDeadlineType,
  GrantCycleStatus,
  GrantRequirementKind,
  FunderType,
} from '@the-tool-pit/db/grant-enums'

/**
 * Read paths for the public grants vertical.
 *
 * Two rules run through all of it:
 *   1. Only status 'published' is ever returned. Nothing scraped reaches a
 *      visitor without a human approving it, so there is no "preview" escape
 *      hatch here.
 *   2. Crawl bookkeeping (contentHash, lastCheckedAt, checkFailureCount,
 *      submitter audit) never leaves the server. `verifiedAt` DOES, because a
 *      team judging a deadline needs to know when a human last checked it.
 */

// Columns a visitor may see. Everything absent from this list is deliberate.
const publicGrantColumns = {
  id: grants.id,
  slug: grants.slug,
  name: grants.name,
  summary: grants.summary,
  description: grants.description,
  infoUrl: grants.infoUrl,
  applicationUrl: grants.applicationUrl,
  programs: grants.programs,
  geoScope: grants.geoScope,
  countries: grants.countries,
  regions: grants.regions,
  localityNote: grants.localityNote,
  awardMin: grants.awardMin,
  awardMax: grants.awardMax,
  awardCurrency: grants.awardCurrency,
  awardNotes: grants.awardNotes,
  renewable: grants.renewable,
  deadlineType: grants.deadlineType,
  effortLevel: grants.effortLevel,
  verifiedAt: grants.verifiedAt,
  funderId: grantFunders.id,
  funderSlug: grantFunders.slug,
  funderName: grantFunders.name,
  funderType: grantFunders.type,
  funderWebsite: grantFunders.website,
} as const

function toPublicGrant(
  row: Record<string, unknown>,
  cycles: PublicGrantCycle[],
  requirements: PublicGrantRequirement[],
): PublicGrant {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    summary: (row.summary as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    infoUrl: row.infoUrl as string,
    applicationUrl: (row.applicationUrl as string | null) ?? null,
    programs: (row.programs as string[]) as GrantProgram[],
    geoScope: row.geoScope as GrantGeoScope,
    countries: (row.countries as string[]) ?? [],
    regions: (row.regions as string[]) ?? [],
    localityNote: (row.localityNote as string | null) ?? null,
    awardMin: (row.awardMin as number | null) ?? null,
    awardMax: (row.awardMax as number | null) ?? null,
    awardCurrency: (row.awardCurrency as string) ?? 'USD',
    awardNotes: (row.awardNotes as string | null) ?? null,
    renewable: (row.renewable as boolean | null) ?? null,
    deadlineType: row.deadlineType as GrantDeadlineType,
    effortLevel: row.effortLevel as GrantEffortLevel,
    verifiedAt: (row.verifiedAt as Date | null) ?? null,
    // The funder join is a LEFT join: grants.funderId is nullable and set to
    // null if a funder row is ever deleted, so a listing must survive it.
    funder: row.funderId
      ? {
          id: row.funderId as string,
          slug: row.funderSlug as string,
          name: row.funderName as string,
          type: row.funderType as FunderType,
          website: (row.funderWebsite as string | null) ?? null,
        }
      : null,
    cycles,
    requirements,
  }
}

/** Cycles for a set of grants, oldest year first so the detail page can show the pattern. */
async function cyclesByGrant(grantIds: string[]): Promise<Map<string, PublicGrantCycle[]>> {
  const map = new Map<string, PublicGrantCycle[]>()
  if (grantIds.length === 0) return map
  const db = getDb()
  const rows = await db
    .select({
      id: grantCycles.id,
      grantId: grantCycles.grantId,
      cycleYear: grantCycles.cycleYear,
      opensAt: grantCycles.opensAt,
      deadlineAt: grantCycles.deadlineAt,
      deadlineNote: grantCycles.deadlineNote,
      decisionAt: grantCycles.decisionAt,
      status: grantCycles.status,
      amountNote: grantCycles.amountNote,
      sourceUrl: grantCycles.sourceUrl,
      verifiedAt: grantCycles.verifiedAt,
      isEstimated: grantCycles.isEstimated,
    })
    .from(grantCycles)
    .where(inArray(grantCycles.grantId, grantIds))
    .orderBy(asc(grantCycles.cycleYear))
  for (const r of rows) {
    const list = map.get(r.grantId) ?? []
    list.push({
      id: r.id,
      cycleYear: r.cycleYear,
      opensAt: r.opensAt,
      deadlineAt: r.deadlineAt,
      deadlineNote: r.deadlineNote,
      decisionAt: r.decisionAt,
      status: r.status as GrantCycleStatus,
      amountNote: r.amountNote,
      sourceUrl: r.sourceUrl,
      verifiedAt: r.verifiedAt,
      isEstimated: r.isEstimated,
    })
    map.set(r.grantId, list)
  }
  return map
}

/** Requirements for a set of grants, in the order an editor put them in. */
async function requirementsByGrant(grantIds: string[]): Promise<Map<string, PublicGrantRequirement[]>> {
  const map = new Map<string, PublicGrantRequirement[]>()
  if (grantIds.length === 0) return map
  const db = getDb()
  const rows = await db
    .select({
      id: grantRequirements.id,
      grantId: grantRequirements.grantId,
      kind: grantRequirements.kind,
      label: grantRequirements.label,
      isBlocking: grantRequirements.isBlocking,
      sortOrder: grantRequirements.sortOrder,
    })
    .from(grantRequirements)
    .where(inArray(grantRequirements.grantId, grantIds))
    .orderBy(asc(grantRequirements.sortOrder))
  for (const r of rows) {
    const list = map.get(r.grantId) ?? []
    list.push({
      id: r.id,
      kind: r.kind as GrantRequirementKind,
      label: r.label,
      isBlocking: r.isBlocking,
      sortOrder: r.sortOrder,
    })
    map.set(r.grantId, list)
  }
  return map
}

/**
 * Published grants, filtered and sorted by urgency.
 *
 * Filtering happens in JS against the shared `matchesFilters` predicate rather
 * than in SQL. Two reasons: the deadline-window and rolling filters depend on
 * `resolveNextCycle`, which is cycle-picking logic that would have to be
 * rewritten (and kept in sync) as SQL; and the client explorer runs the exact
 * same predicate, so what the server ships and what the browser shows can never
 * disagree. The published set is a directory of hundreds, not millions. If it
 * ever stops being that, push `q`, programmes and countries into SQL first and
 * keep the cycle logic here.
 *
 * There is no LIMIT on purpose. A silent top-N would quietly cap coverage.
 */
export async function listGrants(filters: GrantFilters = {}, now: Date = new Date()): Promise<PublicGrant[]> {
  const db = getDb()
  const rows = await db
    .select(publicGrantColumns)
    .from(grants)
    .leftJoin(grantFunders, eq(grants.funderId, grantFunders.id))
    .where(eq(grants.status, 'published'))

  const ids = rows.map((r) => r.id as string)
  const [cycles, requirements] = await Promise.all([cyclesByGrant(ids), requirementsByGrant(ids)])

  const all = rows.map((r) =>
    toPublicGrant(r as Record<string, unknown>, cycles.get(r.id as string) ?? [], requirements.get(r.id as string) ?? []),
  )
  return sortByUrgency(
    all.filter((g) => matchesFilters(g, filters, now)),
    now,
  )
}

/** One published grant by slug, with every cycle it has ever had. */
export async function getGrantBySlug(slug: string): Promise<PublicGrant | null> {
  const db = getDb()
  const [row] = await db
    .select(publicGrantColumns)
    .from(grants)
    .leftJoin(grantFunders, eq(grants.funderId, grantFunders.id))
    .where(and(eq(grants.slug, slug), eq(grants.status, 'published')))
    .limit(1)
  if (!row) return null

  const id = row.id as string
  const [cycles, requirements] = await Promise.all([cyclesByGrant([id]), requirementsByGrant([id])])
  return toPublicGrant(row as Record<string, unknown>, cycles.get(id) ?? [], requirements.get(id) ?? [])
}

/**
 * Has this user favourited this grant? Read server-side so the detail page
 * paints the correct state on the first render instead of flickering.
 */
export async function isGrantFavorited(userId: string, grantId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(
      and(eq(favorites.userId, userId), eq(favorites.entityType, 'grant'), eq(favorites.entityId, grantId)),
    )
    .limit(1)
  return !!row
}

/**
 * Is this user already watching this grant? Read server-side for the same
 * reason as the favourite: the button must paint correct, not correct itself.
 *
 * The watch API route is built separately from this read, so a missing route
 * only disables the button; it never makes this lie about the stored state.
 */
export async function isGrantWatched(userId: string, grantId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: grantWatches.id })
    .from(grantWatches)
    .where(and(eq(grantWatches.userId, userId), eq(grantWatches.grantId, grantId)))
    .limit(1)
  return !!row
}

/**
 * The admin-maintained application form map for one grant, in the order the
 * funder's form asks the questions.
 *
 * Deliberately does NOT load the team profile. Profile reads are gated on a
 * team_profile_members row and live in app/me/team/profile/queries.ts, which
 * exists so that gate is written once; a public page must go through it rather
 * than select the row itself.
 */
export async function getGrantApplyContext(
  grantId: string,
): Promise<{ formFields: PrefillFormField[] }> {
  const db = getDb()
  const formFields = await db
    .select({
      id: grantFormFields.id,
      fillKind: grantFormFields.fillKind,
      paramName: grantFormFields.paramName,
      profilePath: grantFormFields.profilePath,
      label: grantFormFields.label,
      notes: grantFormFields.notes,
      sortOrder: grantFormFields.sortOrder,
    })
    .from(grantFormFields)
    .where(eq(grantFormFields.grantId, grantId))
    .orderBy(asc(grantFormFields.sortOrder))

  return { formFields }
}

// Re-exported so a caller that already has the query module does not need a
// second import just to work out which cycle matters.
export { resolveNextCycle }
