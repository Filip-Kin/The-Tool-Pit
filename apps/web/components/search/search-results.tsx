import Link from 'next/link'
import { ToolCard } from '@/components/tools/tool-card'
import { SortControl } from '@/components/search/sort-control'
import { cn } from '@/lib/utils/cn'
import type { SearchResultRow } from '@/lib/search/search'
import type { SearchSortOption } from '@/lib/search/sort'
import { pageHref, type SearchUrlParams } from '@/lib/search/url'
import { getVotedToolIds } from '@/lib/queries/tools'
import { getFavoritedIds } from '@/lib/queries/favorites'

interface SearchResultsProps {
  results: SearchResultRow[]
  total: number
  query: string
  page: number
  pageSize: number
  /** The URL as it stands, so the sort links can carry every other filter with them. */
  params: SearchUrlParams
  sort: SearchSortOption
}

// Async for the same reason ToolGrid is: the visitor's existing votes are
// resolved ONCE for the whole page rather than per card. Search used to skip
// this entirely, so a tool you had already upvoted rendered unpressed here
// while the very same card rendered pressed on a vertical's page.
export async function SearchResults({ results, total, query, page, pageSize, params, sort }: SearchResultsProps) {
  const totalPages = Math.ceil(total / pageSize)
  const ids = results.map((t) => t.id)
  const [voted, favorited] = await Promise.all([getVotedToolIds(ids), getFavoritedIds('tool', ids)])

  return (
    <div className="flex flex-col gap-6">
      {/* Count on the left, sort on the right: the two facts about the list, on
          the row above it. Stacked on a phone, where three sort words and a
          count do not share a line. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          {total === 0 ? (
            query ? (
              <span>No results for &ldquo;{query}&rdquo;</span>
            ) : (
              <span>No tools found</span>
            )
          ) : (
            <span>
              {total.toLocaleString()} {total === 1 ? 'tool' : 'tools'}
              {query && (
                <>
                  {' '}for <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Nothing to order when nothing matched. */}
        {total > 0 && <SortControl params={params} sort={sort} hasQuery={Boolean(query.trim())} />}
      </div>

      {results.length === 0 && query && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm font-medium text-foreground mb-1">No tools found</p>
          <p className="text-xs text-muted">
            Try a different search term, or{' '}
            <Link href="/submit" className="text-primary hover:underline">
              submit it
            </Link>
            .
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              voted={voted.has(tool.id)}
              favorited={favorited.has(tool.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <PaginationLink key={p} page={p} currentPage={page} params={params} />
          ))}
        </div>
      )}
    </div>
  )
}

// Built from the whole URL, not just `q`. It used to rebuild the query string
// from scratch with only the search term in it, so clicking page 2 of an FRC
// scouting search silently dropped the program and the filters and returned a
// different search.
function PaginationLink({ page, currentPage, params }: { page: number; currentPage: number; params: SearchUrlParams }) {
  return (
    <Link
      href={pageHref(params, page)}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors',
        page === currentPage
          ? 'bg-primary text-white'
          : 'text-muted hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {page}
    </Link>
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
