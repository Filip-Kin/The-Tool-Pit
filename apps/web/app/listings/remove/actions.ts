'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { eventListings, practiceFields } from '@the-tool-pit/db'
import { verifyOutreachRemove } from '@/lib/listings/outreach-token'

/**
 * The verticals outreach goes out for, and where each one lives. Outreach is
 * sent for events and practice fields, and both are taken down the same way: a
 * status flip to 'suppressed', which is idempotent, so a double submit or a
 * replayed link changes nothing the second time. Adding a vertical to outreach
 * is adding a row here.
 */
const REMOVE_TARGETS = {
  event: {
    revalidate: (id: string) => ['/events', `/events/${id}`, '/admin/event-listings'],
    async remove(db: ReturnType<typeof getDb>, id: string): Promise<boolean> {
      const [row] = await db
        .select({ id: eventListings.id, status: eventListings.status })
        .from(eventListings)
        .where(eq(eventListings.id, id))
        .limit(1)
      if (!row) return false
      if (row.status !== 'suppressed') {
        await db
          .update(eventListings)
          .set({
            status: 'suppressed',
            rejectionReason: 'Removed by the event contact from the outreach email.',
            updatedAt: new Date(),
          })
          .where(eq(eventListings.id, id))
      }
      return true
    },
  },
  field: {
    revalidate: (id: string) => ['/fields', `/fields/${id}`, '/admin/practice-fields'],
    async remove(db: ReturnType<typeof getDb>, id: string): Promise<boolean> {
      const [row] = await db
        .select({ id: practiceFields.id, status: practiceFields.status })
        .from(practiceFields)
        .where(eq(practiceFields.id, id))
        .limit(1)
      if (!row) return false
      if (row.status !== 'suppressed') {
        await db
          .update(practiceFields)
          .set({
            status: 'suppressed',
            rejectionReason: 'Removed by the field contact from the outreach email.',
            updatedAt: new Date(),
          })
          .where(eq(practiceFields.id, id))
      }
      return true
    },
  },
} as const

export function isRemoveTarget(type: string): type is keyof typeof REMOVE_TARGETS {
  return type in REMOVE_TARGETS
}

/**
 * The accountless "take my listing down" action behind the outreach email.
 *
 * Called from the confirm page's form, never linked directly, and it re-checks
 * the signed token before touching anything: the token in the link is the only
 * authorisation, so it is verified here again rather than trusted from the GET
 * that rendered the page. Works for every vertical outreach goes out for, and
 * only a suppress ever happens, which is idempotent, so a double submit or a
 * replayed link changes nothing the second time.
 */
export async function confirmOutreachRemoval(formData: FormData): Promise<void> {
  const entityType = String(formData.get('type') ?? '')
  const entityId = String(formData.get('id') ?? '')
  const token = String(formData.get('token') ?? '')

  // Same guard the page renders behind. A tampered id or token lands on the
  // error state rather than suppressing the wrong listing.
  if (!isRemoveTarget(entityType) || !entityId || !verifyOutreachRemove(entityType, entityId, token)) {
    redirect('/listings/remove?error=1')
  }

  const db = getDb()
  const target = REMOVE_TARGETS[entityType]
  const found = await target.remove(db, entityId)
  if (!found) redirect('/listings/remove?error=1')

  for (const path of target.revalidate(entityId)) revalidatePath(path)

  redirect(
    `/listings/remove?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}` +
      `&token=${encodeURIComponent(token)}&done=1`,
  )
}
