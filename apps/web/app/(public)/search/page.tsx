import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SearchBar } from '@/components/search/search-bar'
import { SearchResults } from '@/components/search/search-results'
import { SearchFilters } from '@/components/search/search-filters'
import { searchTools } from '@/lib/search/search'
import { recordSearchEvent } from '@/lib/analytics/events'
import { getIpHash } from '@/lib/utils/ip'
import { headers } from 'next/headers'

interface PageProps {
  searchParams: Promise<{
    q?: string
    program?: string
    type?: string
    role?: string
    fn?: string
    official?: string
    rookie?: string
    sort?: string
    page?: string
  }>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `"${q}" — Search` : 'Search Tools',
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams
  const query = params.q ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const results = await searchTools({
    query,
    program: params.program as 'frc' | 'ftc' | 'fll' | undefined,
    toolType: params.type,
    audienceRole: params.role,
    audienceFunction: params.fn,
    isOfficial: params.official === 'true' ? true : undefined,
    isRookieFriendly: params.rookie === 'true' ? true : undefined,
    page,
    pageSize: 20,
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
          />
        </Suspense>
      </div>

      <Suspense fallback={<SearchResults.Skeleton />}>
        <SearchResults
          results={results.tools}
          total={results.total}
          query={query}
          page={page}
          pageSize={20}
        />
      </Suspense>
    </div>
  )
}
