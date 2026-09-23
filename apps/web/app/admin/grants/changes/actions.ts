'use server'

import { revalidatePath } from 'next/cache'
import { assertAdmin } from '@/lib/admin/auth'
import { adminIdentity, revalidateGrantPublic } from '@/lib/admin/grants'
import { applyGrantChangeBody, dismissGrantChangeBody, reopenGrantChangeBody } from '@/lib/admin/grant-change-decisions'

const QUEUE_PATH = '/admin/grants/changes'

/**
 * Admin buttons for the change queue. The bodies are in
 * lib/admin/grant-change-decisions.ts, shared with
 * /api/internal/queue-decisions; these check the admin and revalidate.
 */

export async function applyGrantChange(changeId: string, confirmed: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const who = await adminIdentity()
  const out = await applyGrantChangeBody(changeId, who, { confirmed })
  if (out.error || !out.grant) return { error: out.error }

  revalidatePath(QUEUE_PATH)
  revalidatePath(`/admin/grants/${out.grant.id}`)
  revalidateGrantPublic(out.grant.slug)
  return {}
}

export async function dismissGrantChange(changeId: string, note?: string): Promise<{ error?: string }> {
  await assertAdmin()
  const who = await adminIdentity()
  const out = await dismissGrantChangeBody(changeId, who, note)
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  return {}
}

/** Put a change back in the queue after a wrong dismissal. */
export async function reopenGrantChange(changeId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await reopenGrantChangeBody(changeId)
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  return {}
}
