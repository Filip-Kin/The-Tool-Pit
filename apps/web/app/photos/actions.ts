'use server'

import { getEventsByDatePage } from '@/lib/queries/albums'
import { soleAlbumClaimStates } from '@/lib/albums/claim-states'

/**
 * Next page of the chronological home feed, for infinite scroll.
 *
 * Carries the claim states for this page's one-album events. The feed appends
 * client-side, so a card loaded on page four has no other way to learn whether
 * its album is claimable, and a menu that silently offers nothing below the
 * fold is worse than no menu at all.
 */
export async function loadMoreEvents(offset: number) {
  const page = await getEventsByDatePage({ limit: 30, offset })
  return { ...page, claimStates: await soleAlbumClaimStates(page.events) }
}
