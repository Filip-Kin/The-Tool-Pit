import { getDb } from '@/lib/db'
import { listingEdits } from '@the-tool-pit/db'
import type { ListingEntityType } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * One row per owner save that changed something. The save actions in
 * /me/listings write straight to the listing, and this is the only record
 * of who moved what and when; "have the owners actually edited anything" was
 * unanswerable before it.
 */
export async function recordListingEdit(input: {
  entityType: ListingEntityType
  entityId: string
  action: 'fields' | 'links' | 'tags' | 'photos' | 'cover' | 'roster'
  changes: Record<string, unknown>
}): Promise<void> {
  if (Object.keys(input.changes).length === 0) return
  const user = await getCurrentUser()
  if (!user) return
  await getDb().insert(listingEdits).values({ entityType: input.entityType, entityId: input.entityId, userId: user.id, action: input.action, changes: input.changes })
}

/** { field: { from, to } } for every key in `set` whose value differs from `before`. */
export function diffColumns(set: Record<string, unknown>, before: Record<string, unknown> | undefined): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, to] of Object.entries(set)) {
    if (key === 'updatedAt') continue
    const from = before?.[key]
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) out[key] = { from: from ?? null, to: to ?? null }
  }
  return out
}
