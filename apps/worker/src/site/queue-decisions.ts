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
