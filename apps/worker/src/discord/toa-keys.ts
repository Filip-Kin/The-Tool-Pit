/**
 * The Orange Alliance's write-key requests, decided by reaction.
 *
 * TOA-API posts each pending request in #api-key-requests (TOA category of
 * this server) as the same bot, seeded with ✅ ❌. A reaction there from a
 * TOA Dev role holder is relayed to TOA-API's POST /api/discord/key-decision,
 * which runs the same decision as the TOA admin dashboard and rewrites the
 * post. TOA-API owns the state: a message that is not a request answers 404
 * and is ignored, one already decided answers 409.
 *
 * Off when TOA_KEY_REQUESTS_CHANNEL_ID, TOA_DEV_ROLE_ID or
 * TOA_DECISION_SECRET is unset. TOA_API_BASE defaults to production, the same
 * variable the toa-events connector reads.
 */

const DEFAULT_BASE = 'https://api.theorangealliance.org'

export interface ToaKeysConfig {
  channelId: string
  devRoleId: string
  secret: string
  base: string
}

export function toaKeysConfig(): ToaKeysConfig | null {
  const channelId = process.env.TOA_KEY_REQUESTS_CHANNEL_ID?.trim()
  const devRoleId = process.env.TOA_DEV_ROLE_ID?.trim()
  const secret = process.env.TOA_DECISION_SECRET?.trim()
  if (!channelId || !devRoleId || !secret) return null
  const base = (process.env.TOA_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, '')
  return { channelId, devRoleId, secret, base }
}

export type ToaDecisionOutcome = { ok: true } | { ok: false; notARequest: boolean; error: string }

export async function askToaToDecide(
  cfg: ToaKeysConfig,
  messageId: string,
  decision: 'approve' | 'reject',
  actorName: string,
): Promise<ToaDecisionOutcome> {
  try {
    const res = await fetch(`${cfg.base}/api/discord/key-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': cfg.secret },
      body: JSON.stringify({ message_id: messageId, decision, actor: actorName }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { _message?: string }
    return { ok: false, notARequest: res.status === 404, error: body._message ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, notARequest: false, error: `could not reach TOA: ${(err as Error).message}` }
  }
}
