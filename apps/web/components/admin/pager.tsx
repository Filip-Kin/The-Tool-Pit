import { ButtonLink } from '@/components/ui/button'

/**
 * Prev / page / Next, under an admin table.
 *
 * Ten admin screens had written this out by hand and had arrived at two
 * spellings of the same three elements, differing only by a `transition-colors`
 * that half of them had. Nothing about paging through candidates is different
 * on the grants screen than on the album screen, so it is one component.
 *
 * `href` is a function rather than a base string because the screens carry
 * different query state into the link: a status, a search term, a crawl id. The
 * caller already knows how to build its own URL.
 */
export function Pager({
  page,
  totalPages,
  href,
}: {
  page: number
  totalPages: number
  href: (page: number) => string
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex justify-center gap-2">
      {page > 1 && (
        <ButtonLink href={href(page - 1)} variant="secondary" size="sm">
          ← Prev
        </ButtonLink>
      )}
      <span className="px-3 py-1.5 text-sm text-muted">
        {page} / {totalPages}
      </span>
      {page < totalPages && (
        <ButtonLink href={href(page + 1)} variant="secondary" size="sm">
          Next →
        </ButtonLink>
      )}
    </div>
  )
}
