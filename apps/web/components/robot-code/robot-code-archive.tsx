import Link from 'next/link'
import { Suspense } from 'react'
import { ToolCard } from '@/components/tools/tool-card'
import { RobotCodeFilters } from './robot-code-filters'
import type { SearchResponse } from '@/lib/search/search'

interface RobotCodeArchiveProps {
  results: SearchResponse
  availableYears: number[]
  stats: { totalRepos: number; totalTeams: number; totalYears: number }
  program?: string
  seasonYear?: number
  teamNumber?: number
  page: number
}

export function RobotCodeArchive({
  results,
  availableYears,
  stats,
  program,
  seasonYear,
  teamNumber,
  page,
}: RobotCodeArchiveProps) {
  const totalPages = Math.ceil(results.total / results.pageSize)

  function buildPageUrl(p: number) {
    const params = new URLSearchParams()
    if (program) params.set('program', program)
    if (seasonYear) params.set('year', String(seasonYear))
    if (teamNumber) params.set('team', String(teamNumber))
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/robot-code${qs ? '?' + qs : ''}`
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      {/* Hero */}
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">Robot Code Archive</h1>
        <p className="text-sm text-muted">
          {stats.totalRepos.toLocaleString()} repositories from {stats.totalTeams.toLocaleString()} teams across {stats.totalYears} seasons
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <Suspense>
          <RobotCodeFilters
            program={program}
            seasonYear={seasonYear}
            teamNumber={teamNumber}
            availableYears={availableYears}
          />
        </Suspense>
      </div>

      {/* Results */}
      {results.tools.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm font-medium text-foreground mb-1">No repositories found</p>
          <p className="text-xs text-muted">Try adjusting your filters.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted">
            {results.total.toLocaleString()} {results.total === 1 ? 'repository' : 'repositories'}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              {page > 1 && (
                <Link
                  href={buildPageUrl(page - 1)}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                  Previous
                </Link>
              )}
              <span className="text-xs text-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={buildPageUrl(page + 1)}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
