'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { eventListings } from '@the-tool-pit/db'
import { verifyOutreachRemove } from '@/lib/listings/outreach-token'

/**
 * The accountless "take my listing down" action behind the outreach email.
 *
 * Called from the confirm page's form, never linked directly, and it re-checks
 * the signed token before touching anything: the token in the link is the only
 * authorisation, so it is verified here again rather than trusted from the GET
 * that rendered the page. Only 'event' is a real target today (outreach only
 * goes out for event listings), and only a suppress ever happens, which is
 * idempotent, so a double submit or a replayed link changes nothing the second
 * time.
 */
export async function confirmOutreachRemoval(formData: FormData): Promise<void> {
  const entityType = String(formData.get('type') ?? '')
  const entityId = String(formData.get('id') ?? '')
  const token = String(formData.get('token') ?? '')

  // Same guard the page renders behind. A tampered id or token lands on the
  // error state rather than suppressing the wrong listing.
  if (entityType !== 'event' || !entityId || !verifyOutreachRemove(entityType, entityId, token)) {
    redirect('/listings/remove?error=1')
  }

  const db = getDb()
  const [row] = await db
    .select({ id: eventListings.id, status: eventListings.status })
    .from(eventListings)
    .where(eq(eventListings.id, entityId))
    .limit(1)
  if (!row) redirect('/listings/remove?error=1')

  if (row.status !== 'suppressed') {
    await db
      .update(eventListings)
      .set({
        status: 'suppressed',
        rejectionReason: 'Removed by the event contact from the outreach email.',
        updatedAt: new Date(),
      })
      .where(eq(eventListings.id, entityId))
    revalidatePath('/events')
    revalidatePath(`/events/${entityId}`)
    revalidatePath('/admin/event-listings')
  }

  redirect(
    `/listings/remove?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}` +
      `&token=${encodeURIComponent(token)}&done=1`,
  )
}
