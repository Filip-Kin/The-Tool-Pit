import Link from 'next/link'
import { Github, ArrowUpRight, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cardClass } from '@/components/ui/card'
import { FreshnessChip } from '@/components/ui/freshness-chip'
import { VoteButton } from '@/components/tools/vote-button'
import { FavoriteButton } from '@/components/auth/favorite-button'
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
  /**
   * Whether this visitor already upvoted it. Resolved once for the whole grid
   * in ToolGrid rather than per card, which would be one query each.
   */
  voted?: boolean
  /** Whether this visitor already saved it. Resolved once for the whole grid. */
  favorited?: boolean
  /**
   * Whether we host this tool ourselves, its homepage being under frc.tools.
   * Shows a "Built here" badge so first-party work reads apart from the wall of
   * external links. Derived in the query; search cards leave it unset.
   */
  firstParty?: boolean
  /**
   * Why somebody picked this out, in their words. Only the home page's
   * Featured row passes one; everywhere else the card is the same card.
   */
  note?: string
  className?: string
}

export function ToolCard({ tool, voted = false, favorited = false, firstParty = false, note, className }: ToolCardProps) {
  return (
    <article className={cardClass({ interactive: true, className: cn('group relative flex flex-col gap-3', className) })}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Link
            href={`/tools/${tool.slug}`}
            className="truncate text-sm font-semibold text-foreground hover:text-primary transition-colors"
          >
            {tool.name}
            <span className="absolute inset-0" aria-hidden />
          </Link>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1">
            {firstParty && (
              <Badge variant="program" className="gap-1">
                <Wrench className="h-3 w-3" aria-hidden />
                Built here
              </Badge>
            )}
            {tool.isOfficial && <Badge variant="official">FIRST Official</Badge>}
            {tool.isVendor && <Badge variant="vendor">Vendor</Badge>}
            {tool.isRookieFriendly && <Badge variant="rookie">Rookie Friendly</Badge>}
            {tool.isTeamCode && tool.teamNumber && (
              <Badge variant="team">Team {tool.teamNumber}</Badge>
            )}
            {tool.isTeamCode && tool.seasonYear && (
              <Badge variant="season">{tool.seasonYear}</Badge>
            )}
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
            className="relative z-10 shrink-0 rounded-md p-1.5 text-muted hover:text-foreground hover:bg-surface-3 transition-colors"
            aria-label={`GitHub repository for ${tool.name}`}
          >
            <Github className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* The note reads as somebody talking, so it gets a rule and the
          foreground colour and sits above the machine-written summary. */}
      {note && (
        <p className="border-l-2 border-primary/50 pl-2.5 text-xs leading-relaxed text-foreground">
          {note}
        </p>
      )}

      {/* Summary */}
      {tool.summary && (
        <p className="line-clamp-2 text-xs text-muted leading-relaxed">
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
            <span className="text-xs text-muted-2">
              {formatRelativeTime(tool.lastActivityAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <FavoriteButton
            entityType="tool"
            entityId={tool.id}
            initialFavorited={favorited}
            reason="Sign in to bookmark this tool and find it again"
            className="relative z-10"
          />
          <VoteButton
            toolId={tool.id}
            initialCount={tool.voteCount}
            initialVoted={voted}
            className="relative z-10"
          />
        </div>
      </div>
    </article>
  )
}
