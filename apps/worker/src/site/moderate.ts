import { siteUrl } from '@the-tool-pit/types'

/**
 * The worker's one way to decide something on the site.
 *
 * POST /api/internal/moderate on apps/web, shared secret in the header. The
 * decision bodies live there because they are the same code the admin buttons
 * run; this process only ever asks. Two callers: the Discord reaction listener
 * (by message id) and the album enrich job (by row, for an admin's own
 * submission). Off when INTERNAL_API_SECRET is unset: every call answers
 * "not configured" and the caller logs it.
 */

const SECRET_ENV = 'INTERNAL_API_SECRET'

export type ModerateTarget = { messageId: string } | { vertical: string; entityId: string }

/** The site's base URL for internal calls, no trailing slash. */
export function siteBaseUrl(): string {
  // The worker's own env may carry NEXT_PUBLIC_URL; siteUrl() reads it and
  // falls back to production. WEB_INTERNAL_URL overrides when the two services
  // can reach each other on a shorter path than the public one.
  return (process.env.WEB_INTERNAL_URL?.trim() || siteUrl()).replace(/\/+$/, '')
}

export function moderateUrl(): string {
  return `${siteBaseUrl()}/api/internal/moderate`
}

export function moderateConfigured(): boolean {
  return Boolean(process.env[SECRET_ENV]?.trim())
}

export async function askSiteToDecide(
  target: ModerateTarget,
  decision: 'approve' | 'reject',
  actorName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env[SECRET_ENV]?.trim()
  if (!secret) return { ok: false, error: `${SECRET_ENV} is unset` }
  try {
    const res = await fetch(moderateUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ ...target, decision, actor: { name: actorName } }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true }
    return { ok: false, error: body.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: `could not reach the site: ${(err as Error).message}` }
  }
}

/**
 * Ask the site to post a held tool submission to the approvals channel. Never
 * throws; a failure is logged and the submission is still in the admin queue.
 */
export async function askSiteToNotifyHeld(submissionId: string, hold: string | null): Promise<void> {
  const secret = process.env[SECRET_ENV]?.trim()
  if (!secret) return
  try {
    const res = await fetch(`${siteBaseUrl()}/api/internal/notify-held`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ submissionId, hold }),
    })
    if (!res.ok) console.warn(`[notify-held] ${submissionId}: HTTP ${res.status}`)
  } catch (err) {
    console.warn(`[notify-held] ${submissionId}: ${(err as Error).message}`)
  }
}

/** The first clause of a pipeline reason, as a short label for the post. */
export function holdLabel(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim()
  if (!r) return null
  return r.split(/\s[—–-]\s|\.\s|;\s/)[0].slice(0, 120)
}
