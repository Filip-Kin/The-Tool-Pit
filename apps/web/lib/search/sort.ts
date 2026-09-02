/**
 * The sorts search actually implements.
 *
 * Narrower than the shared `SearchSort` type, which also lists 'newest'. Search
 * has never ordered by that, so offering it would be a control that changes the
 * URL and nothing else. The three here are the three the ORDER BY in order-by.ts knows.
 */
export type SearchSortOption = 'relevance' | 'popular' | 'updated'

export const DEFAULT_SEARCH_SORT: SearchSortOption = 'relevance'

export interface SearchSortChoice {
  value: SearchSortOption
  /** What to call it once somebody has typed a query. */
  label: string
  /**
   * What to call it while browsing with no query. Only relevance needs a second
   * word: with nothing to match against, "Best match" is a claim we cannot
   * make. The order is still a real one (see searchOrderBy), so the option
   * stays; it just stops describing itself as matching something.
   */
  browseLabel: string
}

export const SEARCH_SORTS: readonly SearchSortChoice[] = [
  { value: 'relevance', label: 'Best match', browseLabel: 'Recommended' },
  { value: 'popular', label: 'Popular', browseLabel: 'Popular' },
  { value: 'updated', label: 'Recently updated', browseLabel: 'Recently updated' },
]

/**
 * A `?sort=` value from the URL, or the default.
 *
 * Anything unrecognised becomes relevance rather than being handed on. The
 * search page took `sort` off the query string, typed it as a bare string and
 * then dropped it on the floor, so nothing had ever had to be careful about
 * what a visitor can put in a URL. Now that the value reaches an ORDER BY, the
 * boundary gets a guard.
 */
export function parseSearchSort(value: string | null | undefined): SearchSortOption {
  return SEARCH_SORTS.some((s) => s.value === value) ? (value as SearchSortOption) : DEFAULT_SEARCH_SORT
}
