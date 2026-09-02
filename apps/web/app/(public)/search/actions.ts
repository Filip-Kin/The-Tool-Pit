'use server'

import { searchTools, type SearchResultRow } from '@/lib/search/search'
import { getVotedToolIds } from '@/lib/queries/tools'
import { getFavoritedIds } from '@/lib/queries/favorites'
import { SEARCH_PAGE_SIZE, toSearchQuery, type SearchUrlParams } from '@/lib/search/url'

/** One appended page of results, and the visitor state that has to arrive with it. */
export interface SearchBatch {
  tools: SearchResultRow[]
  total: number
  hasMore: boolean
  /** Ids this visitor has already upvoted, within this batch. */
  voted: string[]
  /** Ids this visitor has already saved, within this batch. */
  favorited: string[]
}

/**
 * A page beyond the one the server rendered, for the infinite scroll.
 *
 * The votes and the bookmarks come back with the results, not afterwards. The
 * photos feed learned this the expensive way: cards appended on the client have
 * no other way to find out what the visitor has already done, so they render
 * unpressed over a vote that was counted, and a restored feed of 300 rows came
 * back with every card past the first page missing part of its menu.
 *
 * `page` arrives from the browser, so it is treated as such. The filters go
 * through the same parser the page uses, which drops anything that is not a
 * program slug or a positive integer.
 */
export async function loadMoreSearchResults(params: SearchUrlParams, page: number): Promise<SearchBatch> {
  // A page number is an offset multiplier. Left unclamped, a hand-edited
  // request is an unbounded OFFSET on a table scan.
  const safePage = Number.isInteger(page) ? Math.min(Math.max(page, 1), 1000) : 1

  const results = await searchTools({
    ...toSearchQuery(params),
    page: safePage,
    pageSize: SEARCH_PAGE_SIZE,
  })

  const ids = results.tools.map((t) => t.id)
  const [voted, favorited] = await Promise.all([getVotedToolIds(ids), getFavoritedIds('tool', ids)])

  return {
    tools: results.tools,
    total: results.total,
    hasMore: safePage * SEARCH_PAGE_SIZE < results.total,
    voted: [...voted],
    favorited: [...favorited],
  }
}
