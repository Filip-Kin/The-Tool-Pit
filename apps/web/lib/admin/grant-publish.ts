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
import type { GrantExtraction, GrantSourceKind } from '@the-tool-pit/db'
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

/**
 * Why a candidate cannot be published yet. Empty when it can.
 *
 * Route: the extraction's applyRoute must be portal, form or email (the
 * worker checked where the link lands), or the form itself names an email.
 * Timing: a dated cycle on the form, or a deadlineProof of kind dated,
 * not_public or rolling. "None" means the pages were read and say nothing,
 * which is exactly the listing that later lies to a team.
 */
export function publishBlockers(
  extraction: GrantExtraction | null | undefined,
  values: { applyMethod?: string | null; contactEmail?: string | null; deadlineType?: string | null },
  form: FormData,
): string[] {
  const out: string[] = []
  const route = extraction?.applyRoute
  const emailRoute = values.applyMethod === 'email' && Boolean(values.contactEmail)
  if (!emailRoute) {
    if (!route) out.push('the application link has not been verified (no apply-route check on the extraction)')
    // A closed form is still a real grant with a real entrance; the page says
    // "not taking submissions right now" and the monitor flips it the week it
    // reopens. It publishes when the timing is on record (a past cycle, a
    // window, or the funder's own "opens in ..." sentence); a closed form with
    // no idea of when is a dead end and waits.
    else if (route.status === 'closed') {
      const proof = extraction?.deadlineProof
      const timingKnown = String(form.get('cycleYear') ?? '').trim() !== '' || (proof && (proof.kind !== 'none' || proof.past))
      if (!timingKnown) out.push(`the application is closed and the pages say nothing about when it reopens: ${route.evidence}`)
    }
    else if (route.status === 'walled') out.push(`the application page could not be read: ${route.evidence}`)
    else if (route.status === 'unverified') out.push(`the link does not land on an application: ${route.evidence}`)
  }
  const hasCycle = String(form.get('cycleYear') ?? '').trim() !== '' && String(form.get('deadlineAt') ?? '').trim() !== ''
  const proof = extraction?.deadlineProof
  // "Read N pages, nothing stated" IS the proof that the dates are not public,
  // as long as at least one page was actually read; zero pages read means we
  // know nothing, which is the case the gate exists for.
  const timingOk = hasCycle || values.deadlineType === 'rolling' || (proof && (proof.kind !== 'none' || proof.urlsRead.length >= 1))
  if (!timingOk) out.push(proof ? 'timing could not be checked: none of the pages could be read' : 'timing has not been checked (no deadline-proof on the extraction)')
  return out
}

/** A short generic name gets the funder in front of it; a name that already names the funder is left alone. */
const GENERIC_NAME_RE = /^(the )?((corporate|community|charitable|team|robotics|classroom|small|local|global|competition|academic|stem)\s+)*(giving|grants?|grant program(me)?|program(me)?s?|funding|foundation|sponsorships?|donations?|contributions?|request(s| system)?|application( portal)?|funding requests?|impact fund|enrichment grants?|cash grants?|good neighbor committee)(\s+(program(me)?|request(s)?|portal|application|grants?))*$/i
export function nameWithFunder(name: string, funderName: string | null | undefined): string {
  const n = name.trim()
  const f = (funderName ?? '').trim()
  if (!f) return n
  const funderWords = f.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'foundation', 'company', 'corporation', 'inc', 'llc', 'fund'].includes(w))
  const lower = n.toLowerCase()
  if (funderWords.some((w) => lower.includes(w))) return n
  // "VDOE", "MSOE", "AAUW", "DoW": the funder's initials already name it.
  const initials = f.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(the|and|of|for)$/i.test(w)).map((w) => w[0]).join('').toLowerCase()
  const acronyms = n.match(/\b[A-Za-z]{3,6}\b/g)?.filter((t) => /[A-Z]{2,}/.test(t)).map((t) => t.toLowerCase()) ?? []
  if (initials.length >= 3 && acronyms.some((a) => a === initials || initials.startsWith(a) || a.startsWith(initials.slice(0, 3)))) return n
  // Only a GENERIC name gets the funder in front; a specific one is left alone.
  if (!GENERIC_NAME_RE.test(n)) return n
  return `${f} ${n}`.slice(0, 200)
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
  // A generic programme name ("Corporate Giving Programme", "Community
  // Grants") is unfindable in a list of sixty. When the name does not carry
  // the funder, the funder leads it: "Viasat Corporate Giving Programme".
  parsed.values.name = nameWithFunder(parsed.values.name!, parsed.funderName)
  // THE GATE. A listing goes live only when a team can act on it: the link
  // lands on the application (or applications go by email to an address), and
  // timing is either dated or explained in the funder's own words. Both facts
  // come from the extraction the worker verified (apply-route.ts,
  // deadline-proof.ts); a reviewer who knows better types a reason.
  const override = String(form.get('overrideVerification') ?? '').trim()
  if (!override) {
    const blocked = publishBlockers(candidate.extraction, parsed.values, form)
    if (blocked.length > 0) return { error: `Not ready to publish: ${blocked.join('; ')}. Fix it, or give a reason in "publish anyway".` }
  }
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
