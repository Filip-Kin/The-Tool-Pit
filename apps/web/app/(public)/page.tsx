import { Suspense } from 'react'
import { JsonLd } from '@/components/seo/json-ld'
import { SearchBar } from '@/components/search/search-bar'
import { ProgramCards } from '@/components/program/program-cards'
import { VerticalCards } from '@/components/layout/vertical-switcher'
import { ToolGrid } from '@/components/tools/tool-grid'
import { SectionHeader } from '@/components/ui/section-header'
import {
  getDiscoverTools,
  getRecentlyUpdatedTools,
  getRookieFriendlyTools,
  getOfficialTools,
  getFavoriteTools,
} from '@/lib/queries/tools'

/**
 * Rendered per visitor, every time.
 *
 * This page used to be `revalidate = 60`, which was right when it was the same
 * page for everybody. It is not any more: the grids show which tools YOU have
 * bookmarked and upvoted, and Favorite tools is your own list. A shared cache
 * of that is wrong twice over. It made signing in look broken, because the
 * refresh after sign-in could be answered from the cache and hand you back the
 * signed-out page. And it could serve one visitor's bookmark highlights to
 * another, which is somebody else's business showing up on your screen.
 *
 * The original reason for not being static still stands and is stronger here:
 * a statically rendered page keeps a suppressed listing, or a stale freshness
 * label, until an unrelated deploy.
 */
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [favorites, discover, recent, rookie, official] = await Promise.all([
    getFavoriteTools(6),
    getDiscoverTools(6),
    getRecentlyUpdatedTools(6),
    getRookieFriendlyTools(6),
    getOfficialTools(6),
  ])

  return (
    <div className="flex flex-col gap-12 pb-20">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'FRC.Tools',
          alternateName: 'The Tool Pit',
          url: 'https://frc.tools/',
          logo: 'https://frc.tools/icon.svg',
          description: 'A community directory of tools, off-season events, practice fields, robot code, photos and grants for FIRST robotics teams (FRC, FTC, FLL).',
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'FRC.Tools',
          alternateName: ['FRC tools', 'The Tool Pit'],
          url: 'https://frc.tools/',
          description: 'Tools, calculators and apps for FRC, FTC and FLL teams, plus off-season events, practice fields, grants, photos and robot code.',
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: 'https://frc.tools/search?q={search_term_string}' },
            'query-input': 'required name=search_term_string',
          },
        }}
      />
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center gap-6 px-4 pt-24 pb-12 text-center">
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
            FRC.Tools is the community directory of FRC tools, calculators and resources, with FTC and FLL alongside.
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
            { label: 'Mechanism Calculators', href: '/search?q=mechanism+calculator' },
            { label: 'Volunteer Tools', href: '/search?q=volunteer' },
            { label: 'Programming', href: '/search?q=programming' },
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

        {/* The other verticals, as cards. Here rather than in the header: this
            is where a first-time visitor actually looks. A veteran said he never
            found the fields and events sites because the old pill row read as
            chrome; cards with an icon and a line of what-it-is fix that. */}
        <div className="relative w-full max-w-4xl pt-8">
          <VerticalCards current="tools" />
        </div>
      </section>

      {/* Browse by program leads: the fastest way in for someone who already
          knows which program they run. */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader title="Browse by Program" />
        <ProgramCards />
      </section>

      {/* Then your own, and only when there is some. A signed-out visitor and a
          signed-in one who has bookmarked nothing both see the page as it was.
          Called Bookmarked because the control on every card is a bookmark. */}
      {favorites.length > 0 && (
        <section className="container mx-auto max-w-6xl px-4">
          <SectionHeader
            title="Bookmarked"
            description="Everything you have bookmarked"
            href="/me"
            linkLabel="See all"
          />
          <Suspense fallback={<ToolGrid.Skeleton count={favorites.length} />}>
            <ToolGrid tools={favorites} />
          </Suspense>
        </section>
      )}

      {/* Discover, not Popular. Popularity alone put WPILib, PathPlanner and the
          rest of the eternal giants here forever, which a veteran reads as a
          link farm of things they already have. This row keeps the same hot
          score but drops that handful (DISCOVER_EXCLUDED_SLUGS), so it surfaces
          newer and rising work. The giants stay one click away under Browse
          all, which sorts by raw popularity. */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title="Discover"
          description="Newer and rising tools, not the usual giants"
          href="/search?sort=popular"
          linkLabel="Browse all"
        />
        <Suspense fallback={<ToolGrid.Skeleton count={6} />}>
          <ToolGrid tools={discover} />
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

      {/* A few sentences of real, server-rendered prose. The rest of the page
          is cards and short labels, so a crawler saw about a hundred words and
          none of the H1. This says what the site is, names every vertical, and
          repeats the words the heading uses, without reading as filler. */}
      <section className="container mx-auto max-w-3xl px-4 pt-4 text-sm leading-relaxed text-muted">
        <h2 className="mb-2 text-base font-semibold text-foreground">The tools your team reaches for, in one place</h2>
        <p>
          FRC.Tools is a community directory for FIRST robotics teams. Search over a thousand tools,
          calculators and apps for FRC, FTC and FLL, then bookmark the ones you use every season. It
          also maps off-season events with their cost and open team slots, lists practice fields you
          can book, archives team robot code and CAD by team and year, gathers event photo albums, and
          tracks grants your team can apply for with the deadlines checked. Everything is free, and any
          team can submit a tool, an event, a field or a grant.
        </p>
      </section>
    </div>
  )
}
