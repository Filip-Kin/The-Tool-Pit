import { siteBaseUrl } from './moderate.js'

/**
 * The worker's way to apply or dismiss grant_changes rows: POST
 * /api/internal/queue-decisions on apps/web, shared secret in the header
 * (x-internal-secret = INTERNAL_API_SECRET), the same route the queue review
 * agents use. The apply body lives on the site because it is the code the
 * admin Apply button runs; this process only asks.
 *
 * Never throws. Off when INTERNAL_API_SECRET is unset: every id comes back
 * refused with the reason, and the caller leaves the rows pending.
 */

const SECRET_ENV = 'INTERNAL_API_SECRET'

export interface GrantChangeDecisionResult {
  id: string
  ok: boolean
  error?: string
}

export function queueDecisionsUrl(): string {
  return `${siteBaseUrl()}/api/internal/queue-decisions`
}

export async function askSiteToDecideGrantChanges(
  ids: string[],
  action: 'apply' | 'dismiss',
  actorName: string,
): Promise<GrantChangeDecisionResult[]> {
  if (ids.length === 0) return []
  const refuseAll = (error: string) => ids.map((id) => ({ id, ok: false, error }))
  const secret = process.env[SECRET_ENV]?.trim()
  if (!secret) return refuseAll(`${SECRET_ENV} is unset`)
  try {
    const res = await fetch(queueDecisionsUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        actor: { name: actorName },
        decisions: ids.map((id) => ({ kind: 'grant_change', id, action })),
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string; results?: Array<{ id: string; ok: boolean; error?: string }> }
    if (!res.ok || !Array.isArray(body.results)) return refuseAll(body.error ?? `HTTP ${res.status}`)
    const byId = new Map(body.results.map((r) => [r.id, r]))
    return ids.map((id) => {
      const r = byId.get(id)
      return r ? { id, ok: r.ok, ...(r.error ? { error: r.error } : {}) } : { id, ok: false, error: 'no result for this id' }
    })
  } catch (err) {
    return refuseAll(`could not reach the site: ${(err as Error).message}`)
  }
}

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
