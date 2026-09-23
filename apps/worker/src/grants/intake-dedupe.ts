/**
 * Intake dedupe: is this accepted candidate a grant we already list?
 *
 * The 2026-09 review found 75 duplicates the pipeline let through: the same
 * programme under a second URL (a vendor repost, a news post, last cycle's
 * page, a Chief Delphi thread) of a grant already published. Each one cost a
 * person a read and a click. The check runs after classification and before
 * the paid extraction, so a duplicate costs nothing past the classifier.
 *
 * A match is one of:
 *   - the same funder (case-insensitive) AND the same programme name once
 *     years, FY and season tokens and filler words are gone, or
 *   - the same application URL (fragment and trailing slash stripped, query
 *     kept: every Foundant logon is grantinterface.com/Home/Logon?urlkey=<x>).
 *
 * The URL alone is not enough on a shared entrance. One portal login serves
 * many funds (Montana CF's login also serves the Colstrip Impacts Foundation it
 * administers), so on an entrance URL (isEntranceUrl) the name has to match
 * too. A wrong duplicate hides a real grant, which is worse than a second row
 * a person marks by hand.
 *
 * The name logic is a port of normalizeGrantName in
 * apps/web/lib/admin/grant-publish.ts, not an import: the worker does not
 * depend on the web app. It strips FY27-style tokens and "season" as well.
 */
import { getDb, grants, grantFunders, grantCandidates, eq, and, not, inArray } from '@the-tool-pit/db'
import type { GrantCandidate, RawGrantMetadata } from '@the-tool-pit/db'
import { isEntranceUrl } from '@the-tool-pit/db/grant-urls'

// #region pure

export function normalizeGrantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fy ?)?20\d\d(\s?[-–/]\s?(20)?\d\d)?\b/g, ' ')
    .replace(/\bfy ?\d\d\b/g, ' ')
    .replace(/\b(program|programme|programs|programmes|grant|grants|application|applications|season|cycle|the|a|an|for|of|and)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercased funder name with punctuation collapsed, for comparison. */
export function normalizeFunderName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The name with the funder's name taken out. The publish path leads a generic
 * name with the funder ("Viasat Corporate Giving Programme"), and a candidate
 * page usually names only the programme, so both sides drop it when the funder
 * is the same.
 */
function nameWithoutFunder(name: string, funder: string): string {
  const n = normalizeGrantName(name)
  const f = normalizeGrantName(funder)
  if (!f) return n
  const stripped = ` ${n} `.replace(` ${f} `, ' ').trim()
  return stripped || n
}

/** Fragment and trailing slash stripped, query kept, scheme and www ignored. */
export function normalizeApplicationUrl(url: string | null | undefined): string {
  const raw = (url ?? '').trim()
  if (!raw) return ''
  return raw
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+(\?|$)/, '$1')
    .toLowerCase()
}

export interface ExistingGrant {
  id: string
  slug: string
  name: string
  funder: string | null
  applicationUrl: string | null
}

export interface DuplicateQuery {
  name: string | null | undefined
  funderName: string | null | undefined
  /** Every URL the candidate is known by: its page, its application link. */
  urls: (string | null | undefined)[]
}

export interface DuplicateMatch {
  grant: ExistingGrant
  by: 'funder_and_name' | 'application_url'
}

export function findDuplicateGrant(want: DuplicateQuery, existing: ExistingGrant[]): DuplicateMatch | null {
  const wantFunder = normalizeFunderName(want.funderName)
  const wantName = want.name?.trim() ? normalizeGrantName(want.name) : ''
  const wantUrls = new Map<string, string>()
  for (const u of want.urls) {
    const key = normalizeApplicationUrl(u)
    if (key) wantUrls.set(key, u!)
  }

  for (const g of existing) {
    const sameFunder = wantFunder !== '' && normalizeFunderName(g.funder) === wantFunder
    const sameName =
      wantName !== '' &&
      (normalizeGrantName(g.name) === wantName ||
        (sameFunder && nameWithoutFunder(g.name, g.funder ?? '') === nameWithoutFunder(want.name!, want.funderName ?? '')))
    if (sameFunder && sameName) return { grant: g, by: 'funder_and_name' }

    const key = normalizeApplicationUrl(g.applicationUrl)
    if (key && wantUrls.has(key)) {
      // A shared portal login proves nothing on its own.
      if (!isEntranceUrl(g.applicationUrl) || sameName) return { grant: g, by: 'application_url' }
    }
  }
  return null
}

export interface OtherCandidate {
  id: string
  canonicalUrl: string | null
  createdAt: Date
}

/**
 * Another open candidate for the same page. The older row is the one that
 * stays, so two rows never mark each other; ties go to the lower id.
 */
export function findEarlierCandidate(
  me: { id: string; canonicalUrl: string | null; createdAt: Date },
  others: OtherCandidate[],
): OtherCandidate | null {
  const key = normalizeApplicationUrl(me.canonicalUrl)
  if (!key) return null
  const earlier = others
    .filter((o) => o.id !== me.id && normalizeApplicationUrl(o.canonicalUrl) === key)
    .filter((o) => o.createdAt.getTime() < me.createdAt.getTime() || (o.createdAt.getTime() === me.createdAt.getTime() && o.id < me.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
  return earlier[0] ?? null
}

// #endregion

// #region database

export async function loadExistingGrants(): Promise<ExistingGrant[]> {
  return getDb()
    .select({ id: grants.id, slug: grants.slug, name: grants.name, funder: grantFunders.name, applicationUrl: grants.applicationUrl })
    .from(grants)
    .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
}

/** What the candidate says it is, before or after extraction. */
export function duplicateQueryFor(candidate: Pick<GrantCandidate, 'canonicalUrl' | 'sourceUrl' | 'classification' | 'extraction' | 'rawMetadata'>): DuplicateQuery {
  const meta = (candidate.rawMetadata ?? {}) as RawGrantMetadata
  const fields = candidate.extraction?.fields
  return {
    name: fields?.name.value ?? candidate.classification?.name ?? null,
    funderName: fields?.funderName.value ?? candidate.classification?.funderName ?? meta.funderName ?? null,
    urls: [
      candidate.extraction?.applyRoute?.url,
      fields?.applicationUrl.value,
      meta.applicationUrl,
      candidate.canonicalUrl,
      candidate.sourceUrl,
    ],
  }
}

export type IntakeDedupeOutcome =
  | { duplicate: false }
  | { duplicate: true; reason: string; matchedGrantId: string | null }

/**
 * Check one candidate and, on a hit, mark it 'duplicate' with the reason.
 * Only a row still 'pending' or 'flagged' is changed, so a decision a person
 * made in the meantime stands.
 */
export async function dedupeCandidateAtIntake(
  candidate: Pick<GrantCandidate, 'id' | 'canonicalUrl' | 'sourceUrl' | 'classification' | 'extraction' | 'rawMetadata' | 'createdAt'>,
): Promise<IntakeDedupeOutcome> {
  const db = getDb()
  let reason: string | null = null
  let matchedGrantId: string | null = null

  const hit = findDuplicateGrant(duplicateQueryFor(candidate), await loadExistingGrants())
  if (hit) {
    reason = `Duplicate of ${hit.grant.slug} (auto)`
    matchedGrantId = hit.grant.id
  } else if (candidate.canonicalUrl) {
    const others = await db
      .select({ id: grantCandidates.id, canonicalUrl: grantCandidates.canonicalUrl, createdAt: grantCandidates.createdAt })
      .from(grantCandidates)
      .where(
        and(
          eq(grantCandidates.canonicalUrl, candidate.canonicalUrl),
          inArray(grantCandidates.status, ['pending', 'flagged']),
          not(eq(grantCandidates.id, candidate.id)),
        ),
      )
    const earlier = findEarlierCandidate(candidate, others)
    if (earlier) reason = `Duplicate of candidate ${earlier.id} (auto)`
  }
  if (!reason) return { duplicate: false }

  await db
    .update(grantCandidates)
    .set({ status: 'duplicate', matchedGrantId, rejectionReason: reason, updatedAt: new Date() })
    .where(and(eq(grantCandidates.id, candidate.id), inArray(grantCandidates.status, ['pending', 'flagged'])))
  return { duplicate: true, reason, matchedGrantId }
}

// #endregion
