import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SearchBar } from '@/components/search/search-bar'
import { SearchResults } from '@/components/search/search-results'
import { SearchFilters } from '@/components/search/search-filters'
import { VerticalMatches } from '@/components/search/vertical-matches'
import { searchTools } from '@/lib/search/search'
import { parseSearchSort } from '@/lib/search/sort'
import { parseSearchPage, toSearchQuery, SEARCH_PAGE_SIZE, type SearchUrlParams } from '@/lib/search/url'
import { recordSearchEvent } from '@/lib/analytics/events'
import { getIpHash } from '@/lib/utils/ip'
import { headers } from 'next/headers'

interface PageProps {
  searchParams: Promise<SearchUrlParams>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `"${q}" search` : 'Search Tools',
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams
  const query = params.q ?? ''
  const page = parseSearchPage(params)
  const sort = parseSearchSort(params.sort)

  const results = await searchTools({
    ...toSearchQuery(params),
    page,
    pageSize: SEARCH_PAGE_SIZE,
  })

  // Record analytics (fire-and-forget; don't block render)
  if (query) {
    const hdrs = await headers()
    recordSearchEvent({
      query,
      programFilter: params.program,
      resultCount: results.total,
      ipHash: getIpHash(hdrs.get('x-forwarded-for') ?? ''),
    }).catch(() => {})
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-col gap-4">
        <Suspense>
          <SearchBar
            defaultValue={query}
            placeholder="Search tools, calculators, apps…"
            size="md"
          />
        </Suspense>
        <Suspense>
          <SearchFilters
            program={params.program}
            toolType={params.type}
            isOfficial={params.official === 'true'}
            isRookieFriendly={params.rookie === 'true'}
            audienceRole={params.role}
            audienceFunction={params.fn}
          />
        </Suspense>
      </div>

      {/* Verticals that aren't tools rows (Photos, Fields, Grants, Robot Code,
          Events) surface here as a distinct section when the query names one,
          so a search for "practice fields" or "grants" is not a dead end. */}
      <VerticalMatches query={query} className="mb-8" />

      <Suspense fallback={<SearchResults.Skeleton />}>
        <SearchResults
          results={results.tools}
          total={results.total}
          query={query}
          page={page}
          pageSize={SEARCH_PAGE_SIZE}
          params={params}
          sort={sort}
        />
      </Suspense>
    </div>
  )
}
