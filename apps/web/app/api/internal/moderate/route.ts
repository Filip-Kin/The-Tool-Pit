import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { discordApprovalMessages } from '@the-tool-pit/db'
import type { ApprovalVertical } from '@the-tool-pit/types'
import { getDb } from '@/lib/db'
import { decide, DECIDABLE_VERTICALS, type Decision } from '@/lib/moderation/decide'
import { recordDiscordDecision } from '@/lib/discord/decisions'

/**
 * POST /api/internal/moderate
 *
 * The worker's way of saying "somebody with the developer role reacted to this
 * post". The worker holds the Discord gateway connection and the role check;
 * this route holds the decision bodies, because they are the same code the
 * admin buttons run and that code lives here. Nothing else calls this.
 *
 * Auth is a shared secret in the x-internal-secret header, INTERNAL_API_SECRET
 * on both services. Unset means the route does not exist: a 404, not a route
 * that accepts anything. Compared in constant time.
 *
 * Body: { messageId, decision: 'approve' | 'reject', actor: { name } }
 *   or: { vertical, entityId, decision, actor }
 *
 * The first form is a reaction: the message id, not the entity, so the worker
 * never has to know what a post is about. The row this route reads is the one
 * apps/web wrote when the post went out, and its status is the lock: it is
 * flipped to the decision AFTER the body succeeds, by recordDiscordDecision,
 * which also edits the post.
 *
 * The second form is the worker deciding on its own account, with no post
 * behind it: an admin's own album submission, which the enrich job has just
 * matched to its event and which the admin should not have to come back and
 * approve. Same body, same audit stamp, no Discord edit because there is
 * nothing to edit.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorised(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim()
  if (!expected) return false
  const given = req.headers.get('x-internal-secret')?.trim() ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface ModerateBody {
  messageId?: unknown
  vertical?: unknown
  entityId?: unknown
  decision?: unknown
  actor?: { name?: unknown }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: ModerateBody
  try {
    body = (await req.json()) as ModerateBody
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }
  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
  const decision = body.decision === 'approve' || body.decision === 'reject' ? (body.decision as Decision) : null
  const name = typeof body.actor?.name === 'string' && body.actor.name.trim() ? body.actor.name.trim().slice(0, 80) : 'a developer'
  if (!decision) return NextResponse.json({ error: 'decision is required.' }, { status: 400 })

  let vertical: ApprovalVertical
  let entityId: string
  if (messageId) {
    const [row] = await getDb()
      .select({
        vertical: discordApprovalMessages.vertical,
        entityId: discordApprovalMessages.entityId,
        status: discordApprovalMessages.status,
      })
      .from(discordApprovalMessages)
      .where(and(eq(discordApprovalMessages.messageId, messageId)))
      .limit(1)
    if (!row) return NextResponse.json({ error: 'That post is not a decision.' }, { status: 404 })
    if (row.status !== 'pending') return NextResponse.json({ error: `Already ${row.status}.` }, { status: 409 })
    vertical = row.vertical as ApprovalVertical
    entityId = row.entityId
  } else {
    const v = typeof body.vertical === 'string' ? body.vertical.trim() : ''
    const e = typeof body.entityId === 'string' ? body.entityId.trim() : ''
    if (!v || !e) return NextResponse.json({ error: 'messageId, or vertical and entityId, are required.' }, { status: 400 })
    vertical = v as ApprovalVertical
    entityId = e
  }

  if (!DECIDABLE_VERTICALS.has(vertical)) {
    return NextResponse.json({ error: `${vertical} posts are not decided by reaction.` }, { status: 422 })
  }

  const result = await decide(vertical, entityId, decision, { name })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 422 })

  // A no-op when there is no post for the row, which is the second form.
  await recordDiscordDecision(vertical, entityId, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    by: name,
    via: 'discord',
  })
  return NextResponse.json({ ok: true, vertical, entityId, decision })
}
