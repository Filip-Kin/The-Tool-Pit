import type { EventSearchResult } from '@the-tool-pit/types'
import { listingClaimStates, type ListingClaimState } from '@/lib/queries/listing-ownership'

/**
 * Claim state per album id, as a plain object.
 *
 * An object rather than a Map because these cross into client components: the
 * home feed appends pages through a server action, so the states have to
 * survive serialisation and be merged into React state alongside the events.
 */
export type AlbumClaimStates = Record<string, ListingClaimState>

/**
 * The claim state of every one-album event in a list, in one query.
 *
 * Four surfaces show event cards and every one of them needs this, so it is
 * written once. Events with two or more albums are skipped: their card links
 * to the event page, where the album cards carry their own menus.
 */
export async function soleAlbumClaimStates(events: EventSearchResult[]): Promise<AlbumClaimStates> {
  const ids = events.map((e) => e.soleAlbumId).filter((id): id is string => Boolean(id))
  return Object.fromEntries(await listingClaimStates('album', ids))
}
