import { ToolCard } from '@/components/tools/tool-card'
import { cn } from '@/lib/utils/cn'
import type { SearchResultRow } from '@/lib/search/search'

interface ToolGridProps {
  tools: SearchResultRow[]
  className?: string
}

export function ToolGrid({ tools, className }: ToolGridProps) {
  if (tools.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center">
        <p className="text-sm text-[var(--color-muted)]">No tools found.</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
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
          className="h-44 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
        />
      ))}
    </div>
  )
}
