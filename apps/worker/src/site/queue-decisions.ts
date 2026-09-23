import { siteUrl } from '@the-tool-pit/types'

/**
 * Ask the site to publish a grant candidate.
 *
 * POST /api/internal/queue-decisions on apps/web, shared secret in the header,
 * the same config as ./moderate.ts (WEB_INTERNAL_URL or the public URL, and
 * INTERNAL_API_SECRET). The route runs publishCandidateFromForm, the body the
 * review deck's Publish button runs, so publishBlockers and duplicateOfExisting
 * decide exactly as they would for a person. This process only ever asks.
 *
 * overrideVerification is never sent from here and there is no parameter for
 * it. A gate refusal comes back verbatim and the caller records it where the
 * admin queue shows it.
 */

const SECRET_ENV = 'INTERNAL_API_SECRET'

export function queueDecisionsUrl(): string {
  return `${(process.env.WEB_INTERNAL_URL?.trim() || siteUrl()).replace(/\/+$/, '')}/api/internal/queue-decisions`
}

/**
 * What the site said about one publish.
 *
 * - published: the grant and its cycle were written.
 * - published_no_cycle: the grant was written but its cycle was refused
 *   ("Grant saved, but the cycle was not"). It is live; the message says what
 *   an editor has to add.
 * - refused: the publish gate (or the candidate's state) said no. `error` is
 *   the site's own words.
 * - unavailable: the request never produced a decision (secret unset, site
 *   unreachable, HTTP error, malformed reply). Not a verdict on the candidate.
 */
export type GrantPublishResult =
  | { status: 'published'; slug: string }
  | { status: 'published_no_cycle'; slug: string; error: string }
  | { status: 'refused'; error: string }
  | { status: 'unavailable'; error: string }

interface RouteResult {
  id?: string
  ok?: boolean
  error?: string
  slug?: string
}

/** Pure: turn the route's reply for one decision into a GrantPublishResult. */
export function readPublishResult(httpOk: boolean, httpStatus: number, body: unknown, candidateId: string): GrantPublishResult {
  const obj = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; results?: unknown }
  if (!httpOk) {
    return { status: 'unavailable', error: typeof obj.error === 'string' ? obj.error : `HTTP ${httpStatus}` }
  }
  const results = Array.isArray(obj.results) ? (obj.results as RouteResult[]) : []
  const mine = results.find((r) => r?.id === candidateId) ?? (results.length === 1 ? results[0] : undefined)
  if (!mine) return { status: 'unavailable', error: 'the site answered with no result for this candidate' }
  if (mine.ok) {
    return mine.slug ? { status: 'published', slug: mine.slug } : { status: 'unavailable', error: 'the site said ok but returned no slug' }
  }
  const error = typeof mine.error === 'string' && mine.error.trim() ? mine.error : 'refused with no reason given'
  // The route reports a written grant with a refused cycle as ok:false plus the
  // slug of the grant it wrote. The grant is live.
  if (mine.slug) return { status: 'published_no_cycle', slug: mine.slug, error }
  return { status: 'refused', error }
}

export async function askSiteToPublishGrant(candidateId: string, actorName = 'auto'): Promise<GrantPublishResult> {
  const secret = process.env[SECRET_ENV]?.trim()
  if (!secret) return { status: 'unavailable', error: `${SECRET_ENV} is unset` }
  try {
    const res = await fetch(queueDecisionsUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        actor: { name: actorName },
        decisions: [{ kind: 'grant', id: candidateId, action: 'publish' }],
      }),
    })
    const body = await res.json().catch(() => ({}))
    return readPublishResult(res.ok, res.status, body, candidateId)
  } catch (err) {
    return { status: 'unavailable', error: `could not reach the site: ${(err as Error).message}` }
  }
}
