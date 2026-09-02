import { SegmentedLinks } from '@/components/ui/segmented-control'
import { SEARCH_SORTS, type SearchSortOption } from '@/lib/search/sort'
import { sortHref, type SearchUrlParams } from '@/lib/search/url'

/**
 * How the results are ordered.
 *
 * There was no control at all until now, so `?sort=updated` was something you
 * could only reach by typing it, and the page dropped it on the floor when you
 * did. Links rather than a menu: the sort ends up in the URL, which means it
 * can be shared, bookmarked and undone with Back.
 *
 * The default is a segment like the other two, highlighted, not an absence.
 * Relevance being "whatever happens when you pick nothing" is exactly what made
 * the missing control easy to miss.
 */
export function SortControl({
  params,
  sort,
  hasQuery,
}: {
  params: SearchUrlParams
  sort: SearchSortOption
  /** Picks the wording. With nothing typed there is no match to be best at. */
  hasQuery: boolean
}) {
  return (
    <SegmentedLinks
      label="Sort results"
      size="sm"
      value={sort}
      options={SEARCH_SORTS.map((choice) => ({
        value: choice.value,
        label: hasQuery ? choice.label : choice.browseLabel,
        href: sortHref(params, choice.value),
      }))}
    />
  )
}
