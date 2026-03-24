import Link from 'next/link'
import { Github, ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FreshnessChip } from '@/components/ui/freshness-chip'
import { VoteButton } from '@/components/tools/vote-button'
import { cn } from '@/lib/utils/cn'
import { formatRelativeTime } from '@/lib/utils/time'
import type { SearchResultRow } from '@/lib/search/search'

const PROGRAM_LABELS: Record<string, string> = {
  frc: 'FRC',
  ftc: 'FTC',
  fll: 'FLL',
}

interface ToolCardProps {
  tool: SearchResultRow
  className?: string
}

export function ToolCard({ tool, className }: ToolCardProps) {
  return (
    <article
      className={cn(
        'group relative flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border)]/80 hover:bg-[var(--color-surface-2)]',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Link
            href={`/tools/${tool.slug}`}
            className="truncate text-sm font-semibold text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
          >
            {tool.name}
            <span className="absolute inset-0" aria-hidden />
          </Link>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1">
            {tool.isOfficial && <Badge variant="official">FIRST Official</Badge>}
            {tool.isVendor && <Badge variant="vendor">Vendor</Badge>}
            {tool.isRookieFriendly && <Badge variant="rookie">Rookie Friendly</Badge>}
            {tool.programs.map((p) => (
              <Badge key={p} variant="program">{PROGRAM_LABELS[p] ?? p.toUpperCase()}</Badge>
            ))}
          </div>
        </div>

        {/* GitHub link — prominent */}
        {tool.githubUrl && (
          <a
            href={tool.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 shrink-0 rounded-md p-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] transition-colors"
            aria-label={`GitHub repository for ${tool.name}`}
          >
            <Github className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Summary */}
      {tool.summary && (
        <p className="line-clamp-2 text-xs text-[var(--color-muted)] leading-relaxed">
          {tool.summary}
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <FreshnessChip
            freshnessState={tool.freshnessState}
            lastActivityAt={tool.lastActivityAt}
          />
          {tool.lastActivityAt && (
            <span className="text-xs text-[var(--color-muted-2)]">
              {formatRelativeTime(tool.lastActivityAt)}
            </span>
          )}
        </div>

        <VoteButton
          toolId={tool.id}
          initialCount={tool.voteCount}
          className="relative z-10"
        />
      </div>
    </article>
  )
}
