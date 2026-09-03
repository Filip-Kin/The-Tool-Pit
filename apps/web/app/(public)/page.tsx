import { Suspense } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { ProgramCards } from '@/components/program/program-cards'
import { VerticalNav } from '@/components/layout/vertical-switcher'
import { ToolGrid } from '@/components/tools/tool-grid'
import { SectionHeader } from '@/components/ui/section-header'
import {
  getDiscoverTools,
  getFirstPartyTools,
  getRecentlyUpdatedTools,
  getRookieFriendlyTools,
  getOfficialTools,
  getFavoriteTools,
  getFeaturedTools,
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
  const [favorites, featured, firstParty, discover, recent, rookie, official] = await Promise.all([
    getFavoriteTools(6),
    getFeaturedTools(6),
    getFirstPartyTools(6),
    getDiscoverTools(6),
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

        {/* The other three verticals. Here rather than in the header: this is
            where a first-time visitor actually looks, and the header had no
            room for real labels. */}
        <div className="relative w-full max-w-3xl pt-6">
          <VerticalNav current="tools" />
        </div>
      </section>

      {/* Featured leads the page. Popular, Rookie Friendly and Official are all
          rows a reader would guess were here, and none of them can say why one
          particular tool is worth the click. This is the row that can, so it
          goes first. Nothing is featured to begin with and the section renders
          nothing at all until something is, so an unset home page is the old
          home page rather than an empty shelf. No link out: it is a short list
          somebody chose, not a category you can browse. */}
      {featured.tools.length > 0 && (
        <section className="container mx-auto max-w-6xl px-4">
          <SectionHeader title="Featured" description="Worth a look, and why" />
          <Suspense fallback={<ToolGrid.Skeleton count={featured.tools.length} />}>
            <ToolGrid tools={featured.tools} notes={featured.notes} />
          </Suspense>
        </section>
      )}

      {/* Built here. The feedback that drove this: the front page mixed our own
          first-party tools, the ones we host under frc.tools, into a wall of
          external links with no way to tell them apart. This section is the
          separation, and every card here also carries a "Built here" badge, so
          the distinction survives when the tool shows up in another row. Renders
          nothing until there is a first-party tool to show. */}
      {firstParty.length > 0 && (
        <section className="container mx-auto max-w-6xl px-4">
          <SectionHeader
            title="Built on FRC.tools"
            description="First-party tools we host and maintain"
          />
          <Suspense fallback={<ToolGrid.Skeleton count={firstParty.length} />}>
            <ToolGrid tools={firstParty} />
          </Suspense>
        </section>
      )}

      {/* Then your own, and only when there is some. A signed-out visitor and a
          signed-in one who has bookmarked nothing both see the page as it was.
          Called Bookmarked because the control on every card is a bookmark;
          it was "Favorite tools" next to a button that says bookmark. */}
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

      {/* Browse by program */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader title="Browse by Program" />
        <ProgramCards />
      </section>

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
    </div>
  )
}
