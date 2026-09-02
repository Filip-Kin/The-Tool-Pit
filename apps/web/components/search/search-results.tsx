import { InfiniteSearchResults } from '@/components/search/infinite-search-results'
import type { SearchResultRow } from '@/lib/search/search'
import type { SearchSortOption } from '@/lib/search/sort'
import { searchSignature, type SearchUrlParams } from '@/lib/search/url'
import { getVotedToolIds } from '@/lib/queries/tools'
import { getFavoritedIds } from '@/lib/queries/favorites'

interface SearchResultsProps {
  results: SearchResultRow[]
  total: number
  query: string
  page: number
  pageSize: number
  /** The URL as it stands, so the sort links and the appended pages are the same search. */
  params: SearchUrlParams
  sort: SearchSortOption
}

// Async for the same reason ToolGrid is: the visitor's existing votes are
// resolved ONCE for the whole page rather than per card. Search used to skip
// this entirely, so a tool you had already upvoted rendered unpressed here
// while the very same card rendered pressed on a vertical's page. Every page
// the list appends after this one resolves its own, in the load-more action.
export async function SearchResults({ results, total, query, page, pageSize, params, sort }: SearchResultsProps) {
  const ids = results.map((t) => t.id)
  const [voted, favorited] = await Promise.all([getVotedToolIds(ids), getFavoritedIds('tool', ids)])

  return (
    <InfiniteSearchResults
      // /search is one route, so a new sort or a new filter re-renders this
      // component rather than replacing it, and the already-loaded results
      // would survive the change. Keying on the search discards them.
      key={searchSignature(params)}
      initial={results}
      total={total}
      query={query}
      params={params}
      sort={sort}
      initialPage={page}
      pageSize={pageSize}
      initialVoted={[...voted]}
      initialFavorited={[...favorited]}
    />
  )
}

SearchResults.Skeleton = function SearchResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-4 w-32 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    </div>
  )
}
