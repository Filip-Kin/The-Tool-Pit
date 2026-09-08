/**
 * Publishing a grant candidate, as one function the admin action and a bulk
 * run both call.
 *
 * The admin's publish form and a scripted publish must write EXACTLY the same
 * rows (grant, its cycle, its requirements, the candidate's status, the
 * source's yield counter, the submitter's ownership, the notification), or the
 * two kinds of listing drift apart in ways nobody notices until a team does.
 * So the body lives here, takes the parsed form, and knows nothing about
 * sessions or cache revalidation: the action checks the admin and revalidates,
 * a script supplies its own "who".
 */
import { eq, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantCandidates, grantCycles, grantRequirements, grants } from '@the-tool-pit/db'
import type { GrantSourceKind } from '@the-tool-pit/db'
import { reviewRequirements } from '@/lib/admin/grant-review'
import { bumpSourceCounter, parseCycleFields, parseGrantFields, resolveFunderByName, uniqueGrantSlug } from '@/lib/admin/grants'
import { notifyGrantPublished } from '@/lib/notify/approvals'
import { grantGrantOwnership } from '@/lib/listings/submitter-ownership'

/**
 * The real discovery angle that found this candidate, as a grants.source value.
 *
 * The connector writes it to rawMetadata.discoveredVia as `<connector>:<detail>`
 * (`web_search:...`, `team_sponsors:...`, `seed:...`, `chief_delphi:...`) or the
 * bare `public submission`. sourceId is NOT this signal: a web_search find has
 * no source row and a curated seed does, so keying the label off sourceId
 * inverted it, labelling a crawler find 'admin' and a seed 'web_search'.
 * Anything unrecognised was typed into the admin by hand, which is 'admin'.
 */
export function discoverySourceKind(discoveredVia: string | null | undefined): GrantSourceKind {
  const via = discoveredVia ?? ''
  const connector = (via.includes(':') ? via.slice(0, via.indexOf(':')) : via).trim().toLowerCase()
  switch (connector) {
    case 'web_search':
      return 'web_search'
    case 'team_sponsors':
      return 'team_sponsors'
    case 'chief_delphi':
      return 'chief_delphi'
    case 'seed':
      return 'seed'
    case 'sheet':
      return 'sheet'
    case 'aggregator':
      return 'aggregator'
    case 'public submission':
      return 'submission'
    default:
      return 'admin'
  }
}

/** Look a grant up by uuid or slug. Admins paste either. */
export async function findGrant(ref: string) {
  const clean = ref.trim().toLowerCase()
  if (!clean) return null
  const db = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)
  const [row] = await db
    .select({ id: grants.id, slug: grants.slug, name: grants.name })
    .from(grants)
    .where(isUuid ? or(eq(grants.id, clean), eq(grants.slug, clean)) : eq(grants.slug, clean))
    .limit(1)
  return row ?? null
}

export async function loadCandidate(candidateId: string) {
  const db = getDb()
  const [row] = await db.select().from(grantCandidates).where(eq(grantCandidates.id, candidateId)).limit(1)
  return row ?? null
}

export interface PublishOutcome {
  error?: string
  slug?: string
  grantId?: string
  /** The grant was written but its cycle was refused; the message says why. */
  cycleError?: string
}

export async function publishCandidateFromForm(
  candidateId: string,
  form: FormData,
  who: string,
): Promise<PublishOutcome> {
  const db = getDb()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.matchedGrantId) return { error: 'This candidate is already attached to a grant.' }
  const parsed = parseGrantFields(form)
  if (parsed.error) return { error: parsed.error }
  const now = new Date()
  const slug = await uniqueGrantSlug(parsed.values.name!)
  const funderId = parsed.funderName ? await resolveFunderByName(parsed.funderName) : null
  const status = parsed.values.status ?? 'pending'
  const [created] = await db
    .insert(grants)
    .values({
      ...parsed.values,
      name: parsed.values.name!,
      infoUrl: parsed.values.infoUrl!,
      slug,
      funderId,
      source: discoverySourceKind(candidate.rawMetadata?.discoveredVia),
      verifiedAt: now,
      verifiedBy: who,
      publishedAt: status === 'published' ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: grants.id, slug: grants.slug })
  let cycleError: string | undefined
  if (String(form.get('cycleYear') ?? '').trim()) {
    const cycle = parseCycleFields(form)
    if (cycle.error) {
      cycleError = cycle.error
    } else {
      await db.insert(grantCycles).values({
        grantId: created.id,
        ...cycle.values,
        verifiedAt: now,
        verifiedBy: who,
      })
    }
  }
  const requirements = reviewRequirements(form)
  if (requirements.length > 0) {
    await db.insert(grantRequirements).values(
      requirements.map((r) => ({
        grantId: created.id,
        kind: r.kind,
        operator: r.operator,
        value: r.value,
        label: r.label,
        isBlocking: r.isBlocking,
        sortOrder: r.sortOrder,
      })),
    )
  }
  await db
    .update(grantCandidates)
    .set({
      status: 'published',
      matchedGrantId: created.id,
      rejectionReason: null,
      rejectionKind: null,
      reviewNote: null,
      updatedAt: now,
    })
    .where(eq(grantCandidates.id, candidateId))
  await bumpSourceCounter(candidate.sourceId, 'yield')
  await grantGrantOwnership(candidateId, created.id)
  await notifyGrantPublished(candidateId, {
    name: parsed.values.name!,
    slug: created.slug,
    funderName: parsed.funderName ?? null,
  })
  return { slug: created.slug, grantId: created.id, cycleError }
}
