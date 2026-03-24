import Link from 'next/link'
import { ToolCard } from '@/components/tools/tool-card'
import { cn } from '@/lib/utils/cn'
import type { SearchResultRow } from '@/lib/search/search'

interface SearchResultsProps {
  results: SearchResultRow[]
  total: number
  query: string
  page: number
  pageSize: number
}

export function SearchResults({ results, total, query, page, pageSize }: SearchResultsProps) {
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="flex flex-col gap-6">
      {/* Result count */}
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
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <PaginationLink key={p} page={p} currentPage={page} query={query} />
          ))}
        </div>
      )}
    </div>
  )
}

function PaginationLink({ page, currentPage, query }: { page: number; currentPage: number; query: string }) {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (page > 1) params.set('page', String(page))

  return (
    <Link
      href={`/search?${params.toString()}`}
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
