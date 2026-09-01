import { Suspense } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { ProgramCards } from '@/components/program/program-cards'
import { VerticalNav } from '@/components/layout/vertical-switcher'
import { ToolGrid } from '@/components/tools/tool-grid'
import { SectionHeader } from '@/components/ui/section-header'
import {
  getTrendingTools,
  getRecentlyUpdatedTools,
  getRookieFriendlyTools,
  getOfficialTools,
} from '@/lib/queries/tools'

export default async function HomePage() {
  const [trending, recent, rookie, official] = await Promise.all([
    getTrendingTools(6),
    getRecentlyUpdatedTools(6),
    getRookieFriendlyTools(6),
    getOfficialTools(6),
  ])

  return (
    <div className="flex flex-col gap-20 pb-20">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center gap-6 px-4 py-24 text-center">
        {/* Background glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-96 w-96 rounded-full bg-primary opacity-5 blur-3xl" />
        </div>

        <div className="relative flex flex-col items-center gap-4">
          <h1 className="text-4xl font-bold tracking-tight text-balance md:text-6xl">
            The tools that make{' '}
            <span className="text-primary">your season easier</span>
          </h1>
          <p className="max-w-xl text-base text-muted md:text-lg">
            Tools, calculators and resources for FRC, FTC and FLL.
          </p>
        </div>

        <div className="relative w-full max-w-2xl">
          <Suspense>
            <SearchBar autoFocus placeholder="Search tools, calculators, apps…" size="lg" />
          </Suspense>
        </div>

        <div className="relative flex flex-wrap justify-center gap-2">
          {[
            { label: 'Scouting Apps', href: '/search?q=scouting' },
            { label: 'CAD Tools', href: '/search?q=cad' },
            { label: 'Path Planning', href: '/search?q=path+planning' },
            { label: 'Mechanism Calculators', href: '/search?q=mechanism+calculator' },
            { label: 'Volunteer Tools', href: '/search?q=volunteer' },
            { label: 'Programming', href: '/search?q=programming' },
            { label: 'Simulation', href: '/search?q=simulation' },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary"
            >
              {label}
            </a>
          ))}
        </div>

        {/* The other three verticals. Here rather than in the header: this is
            where a first-time visitor actually looks, and the header had no
            room for real labels. */}
        <div className="relative w-full max-w-3xl pt-6">
          <VerticalNav current="tools" />
        </div>
      </section>

      {/* Browse by program */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader title="Browse by Program" />
        <ProgramCards />
      </section>

      {/* Trending */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title="Popular"
          description="Widely used and still maintained"
          href="/search?sort=popular"
          linkLabel="See all"
        />
        <Suspense fallback={<ToolGrid.Skeleton count={6} />}>
          <ToolGrid tools={trending} />
        </Suspense>
      </section>

      {/* Rookie Friendly */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title="Rookie Friendly"
          description="Great starting points for new teams"
          href="/search?rookie=true"
          linkLabel="See all"
        />
        <Suspense fallback={<ToolGrid.Skeleton count={6} />}>
          <ToolGrid tools={rookie} />
        </Suspense>
      </section>

      {/* Official FIRST */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title="Official FIRST Resources"
          description="Directly from FIRST HQ"
          href="/search?official=true"
          linkLabel="See all"
        />
        <Suspense fallback={<ToolGrid.Skeleton count={6} />}>
          <ToolGrid tools={official} />
        </Suspense>
      </section>

      {/* Recently Updated */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title="Recently Updated"
          href="/search?sort=updated"
          linkLabel="See all"
        />
        <Suspense fallback={<ToolGrid.Skeleton count={6} />}>
          <ToolGrid tools={recent} />
        </Suspense>
      </section>
    </div>
  )
}
