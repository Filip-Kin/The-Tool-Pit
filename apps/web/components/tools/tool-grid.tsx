import { ToolCard } from '@/components/tools/tool-card'
import { cn } from '@/lib/utils/cn'
import type { SearchResultRow } from '@/lib/search/search'
import { getVotedToolIds } from '@/lib/queries/tools'
import { getFavoritedIds } from '@/lib/queries/favorites'

interface ToolGridProps {
  /**
   * firstParty is optional so a plain SearchResultRow (search results) still
   * fits; the home page's rows carry it and get the "Built here" badge.
   */
  tools: Array<SearchResultRow & { firstParty?: boolean }>

  /**
   * A curator's line per tool id, for the home page's Featured row. Every other
   * grid leaves this out and gets plain cards.
   */
  notes?: Record<string, string>
  className?: string
}

// Async so the visitor's existing votes are resolved ONCE for the whole grid
// rather than per card. A card cannot do it itself without a query each.
export async function ToolGrid({ tools, notes, className }: ToolGridProps) {
  if (tools.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted">No tools found.</p>
      </div>
    )
  }

  const ids = tools.map((t) => t.id)
  const [voted, favorited] = await Promise.all([getVotedToolIds(ids), getFavoritedIds('tool', ids)])

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          voted={voted.has(tool.id)}
          favorited={favorited.has(tool.id)}
          firstParty={tool.firstParty}
          note={notes?.[tool.id]}
        />
      ))}
    </div>
  )
}

ToolGrid.Skeleton = function ToolGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-lg border border-border bg-surface"
        />
      ))}
    </div>
  )
}
