import type { SearchParams } from '@the-tool-pit/types'
import { DEFAULT_SEARCH_SORT, parseSearchSort, type SearchSortOption } from './sort'

/** Results per request. One number, because the page, the sort links and the appended batches all have to agree on it. */
export const SEARCH_PAGE_SIZE = 20

/**
 * Every query parameter /search reads, as they arrive: strings, or missing.
 *
 * This is also what the client hands back to the load-more action, so it is the
 * only place that turns a URL into a query. Parsing it twice, once in the page
 * and once in the action, is how the two quietly come to disagree about what
 * `?official=true` means on page four.
 */
export interface SearchUrlParams {
  q?: string
  program?: string
  type?: string
  role?: string
  fn?: string
  official?: string
  rookie?: string
  sort?: string
  page?: string
  teamcode?: string
  team?: string
  year?: string
}

const PROGRAMS = ['frc', 'ftc', 'fll'] as const

/** A positive integer from a query string, or undefined. Never NaN, which reaches SQL as a syntax error. */
function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function parseSearchPage(params: SearchUrlParams): number {
  return positiveInt(params.page) ?? 1
}

/** The filters, ready for searchTools. Page and size are the caller's business. */
export function toSearchQuery(params: SearchUrlParams): Omit<SearchParams, 'page' | 'pageSize'> {
  const program = PROGRAMS.find((p) => p === params.program)
  return {
    query: params.q ?? '',
    program,
    toolType: params.type || undefined,
    audienceRole: params.role || undefined,
    audienceFunction: params.fn || undefined,
    isOfficial: params.official === 'true' ? true : undefined,
    isRookieFriendly: params.rookie === 'true' ? true : undefined,
    isTeamCode: params.teamcode === 'true' ? true : params.teamcode === 'false' ? false : undefined,
    teamNumber: positiveInt(params.team),
    seasonYear: positiveInt(params.year),
    sort: parseSearchSort(params.sort),
  }
}

/** Rebuild the /search URL, dropping empties so a shared link has no dead parameters in it. */
function searchHref(params: SearchUrlParams, overrides: Partial<Record<keyof SearchUrlParams, string | undefined>>): string {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `/search?${qs}` : '/search'
}

/**
 * The same search under a different sort.
 *
 * Back to page one, because page four of "best match" is not page four of
 * "recently updated" and landing there would look like results vanishing. The
 * default sort is left out of the URL entirely rather than written as
 * `?sort=relevance`, so the plain /search link stays the plain one.
 */
export function sortHref(params: SearchUrlParams, sort: SearchSortOption): string {
  return searchHref(params, {
    sort: sort === DEFAULT_SEARCH_SORT ? undefined : sort,
    page: undefined,
  })
}

/**
 * The same search, one page further in.
 *
 * The reader never clicks this now that results append as they scroll, but it
 * is a real href on a real link: it is what a crawler follows past the first
 * twenty results, and what happens if the JavaScript never arrives.
 */
export function pageHref(params: SearchUrlParams, page: number): string {
  return searchHref(params, { page: page > 1 ? String(page) : undefined })
}
