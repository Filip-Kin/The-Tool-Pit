import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantCandidates, grantSources, grants } from '@the-tool-pit/db'
import type { RawGrantMetadata } from '@the-tool-pit/db'
import { notifyNewGrantSubmission } from './notify'

/**
 * Public grant submissions.
 *
 * A submission is a LEAD, not a listing. It lands in grant_candidates as
 * 'pending' exactly like anything a crawler found, and a human reads the
 * funder's page and publishes it from the admin queue. Nothing here writes to
 * `grants`, and nothing here sets verifiedAt. Someone telling us a deadline is
 * not the same as someone checking it, and a wrong deadline is worse than no
 * deadline.
 */

export interface CreateGrantSubmissionInput {
  /** The funder's own page about the grant. Required: it is what gets checked. */
  infoUrl: string
  name: string
  funderName?: string
  applicationUrl?: string
  summary?: string
  /** Anything else the submitter knows: dates, amounts, who it is for. */
  notes?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: sign-in is
   * never a wall in front of a submission. It only buys attribution and an
   * email when a moderator gets to it.
   */
  submittedByUserId?: string
}

export type CreateGrantSubmissionResult =
  | { status: 'pending'; candidateId: string; message: string }
  | { status: 'duplicate'; message: string; slug?: string }
  | { status: 'error'; message: string }

// #region url canonicalisation

/** Query parameters that identify a click, not a page. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
]

/**
 * Canonical form used as the dedup key: lowercase host, no fragment, no
 * tracking parameters, no trailing slash. Real query strings are KEPT, because
 * plenty of funders serve their grant page as `?page_id=…` and dropping the
 * query would collapse every one of them onto the site root.
 *
 * This mirrors canonicalGrantUrl() in apps/worker/src/grants/connectors/shared.ts
 * rule for rule. The worker is a separate package the web app cannot import, and
 * the two MUST agree: if a submission canonicalised differently from a crawl,
 * the same funder page would sit in the review queue twice.
 */
function canonicalGrantUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim().replace(/[).,;:!?'"]+$/, ''))
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname.includes('.')) return null

  for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1)
  if (u.pathname === '/') u.pathname = ''
  return u.toString()
}

// #endregion

/**
 * The grant_sources row every public submission is filed under.
 *
 * Candidates carry their origin through sourceId rather than a column of their
 * own, and the admin queue ranks sources by how many of their candidates get
 * published or rejected. Public submissions are one such source, so they get
 * one row, found by its fixed target string.
 */
const SUBMISSION_SOURCE_TARGET = 'internal:public-submission'

async function submissionSourceId(): Promise<string | null> {
  const db = getDb()
  const [existing] = await db
    .select({ id: grantSources.id })
    .from(grantSources)
    .where(and(eq(grantSources.kind, 'submission'), eq(grantSources.target, SUBMISSION_SOURCE_TARGET)))
    .limit(1)
  if (existing) return existing.id

  const [created] = await db
    .insert(grantSources)
    .values({
      kind: 'submission',
      label: 'Public submissions',
      target: SUBMISSION_SOURCE_TARGET,
      // Nothing to crawl: this source is a bucket, not a target. Disabled so a
      // scheduler sweeping enabled sources never tries to fetch it.
      enabled: false,
      cadenceHours: 0,
      notes: 'Grants submitted through the public form. Nothing fetches this row.',
    })
    .returning({ id: grantSources.id })
  return created?.id ?? null
}

export async function createGrantSubmission(
  input: CreateGrantSubmissionInput,
): Promise<CreateGrantSubmissionResult> {
  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'Please give the grant a name.' }

  const rawUrl = input.infoUrl?.trim()
  const canonicalUrl = rawUrl ? canonicalGrantUrl(rawUrl) : null
  if (!canonicalUrl) {
    return { status: 'error', message: 'Please give a full link to the funder page, starting with https://' }
  }

  const db = getDb()

  // Already listed? Say so and point at it. Someone who cannot find a grant on
  // the site and submits it again is telling us the search is the problem.
  const listed = await findPublishedByUrl(canonicalUrl)
  if (listed) {
    return {
      status: 'duplicate',
      slug: listed.slug,
      message: `We already list this one as ${listed.name}.`,
    }
  }

  const [queued] = await db
    .select({ id: grantCandidates.id, status: grantCandidates.status })
    .from(grantCandidates)
    .where(eq(grantCandidates.canonicalUrl, canonicalUrl))
    .limit(1)
  if (queued) {
    return {
      status: 'duplicate',
      message:
        queued.status === 'suppressed'
          ? 'Thanks, but this one has been looked at before and turned down.'
          : 'This one is already waiting to be reviewed. Nothing more needed from you.',
    }
  }

  const applicationUrl = input.applicationUrl?.trim() || undefined

  // RawGrantMetadata is the shape the admin queue and the classifier already
  // read, so a submission fills the same fields a crawl would. `contentText` is
  // what a classifier gets handed, and for a submission the most useful text is
  // what the person actually typed, so their notes go there rather than being
  // stapled onto the description.
  const rawMetadata: RawGrantMetadata = {
    title: name,
    description: input.summary?.trim() || undefined,
    funderName: input.funderName?.trim() || undefined,
    applicationUrl,
    discoveredVia: 'public submission',
    contentText: input.notes?.trim() || undefined,
  }

  const sourceId = await submissionSourceId()

  const [row] = await db
    .insert(grantCandidates)
    .values({
      sourceId,
      // The URL as typed, not the canonical form: a few funders serve a
      // different page without their own tracking parameters, and the reviewer
      // should open exactly what the submitter was looking at.
      sourceUrl: rawUrl,
      canonicalUrl,
      rawMetadata,
      // No classification and no confidence score. A person typed this, so
      // there is nothing for a model to decide and no reason to spend a call.
      status: 'pending',
      submitterName: input.submitterName?.trim() || null,
      submitterContact: input.submitterContact?.trim() || null,
      submitterIpHash: input.submitterIpHash || null,
      submittedByUserId: input.submittedByUserId ?? null,
    })
    .returning({ id: grantCandidates.id })

  void notifyNewGrantSubmission({
    candidateId: row.id,
    name,
    funderName: rawMetadata.funderName ?? null,
    infoUrl: rawUrl,
    applicationUrl: applicationUrl ?? null,
    summary: rawMetadata.description ?? null,
    notes: rawMetadata.contentText ?? null,
    submitterName: input.submitterName?.trim() || null,
    submitterContact: input.submitterContact?.trim() || null,
  })

  return {
    status: 'pending',
    candidateId: row.id,
    message:
      'Thanks. Someone will read the funder page and check the dates before this goes on the list, so it will not appear straight away.',
  }
}

/**
 * Is this URL already a published grant?
 *
 * grants.infoUrl is stored as a human typed or approved it, never
 * canonicalised, so the only correct comparison is to canonicalise each stored
 * URL here. The published set is a curated directory in the hundreds, so
 * reading it whole costs nothing, and telling someone their grant is already
 * listed is worth far more than the query.
 */
async function findPublishedByUrl(canonicalUrl: string): Promise<{ slug: string; name: string } | null> {
  const db = getDb()
  const rows = await db
    .select({ slug: grants.slug, name: grants.name, infoUrl: grants.infoUrl, applicationUrl: grants.applicationUrl })
    .from(grants)
    .where(eq(grants.status, 'published'))

  for (const row of rows) {
    for (const raw of [row.infoUrl, row.applicationUrl]) {
      if (!raw) continue
      if (canonicalGrantUrl(raw) === canonicalUrl) return { slug: row.slug, name: row.name }
    }
  }
  return null
}
