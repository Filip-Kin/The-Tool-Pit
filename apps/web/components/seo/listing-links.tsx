import Link from 'next/link'

/**
 * A plain, server-rendered list of links to every listing on an index page.
 *
 * The explorers render their lists in the browser, so a crawler that lands on
 * /events sees one listing link and the other hundred exist only in the
 * sitemap. Search Console showed 1,539 pages "discovered, not indexed" for
 * exactly that reason. This is the same set of links as real HTML, collapsed
 * under a heading so it is a browse-as-a-list for a person too.
 */
export function ListingLinks({ title, links }: { title: string; links: Array<{ href: string; label: string; meta?: string | null }> }) {
  if (links.length === 0) return null
  const sorted = [...links].sort((a, b) => a.label.localeCompare(b.label))
  return (
    <details className="container mx-auto max-w-6xl px-4">
      <summary className="cursor-pointer text-sm font-medium text-muted hover:text-foreground">
        {title} ({sorted.length})
      </summary>
      <nav aria-label={title} className="mt-3 columns-1 gap-x-8 text-sm sm:columns-2 lg:columns-3">
        {sorted.map((l) => (
          <div key={l.href} className="break-inside-avoid py-0.5">
            <Link href={l.href} className="text-foreground hover:underline">
              {l.label}
            </Link>
            {l.meta ? <span className="ml-1 text-muted-2">{l.meta}</span> : null}
          </div>
        ))}
      </nav>
    </details>
  )
}
