import { cn } from '@/lib/utils/cn'
import { getFreshnessLabel } from '@/lib/utils/time'

interface FreshnessChipProps {
  freshnessState: string | null | undefined
  lastActivityAt: Date | string | null | undefined
  className?: string
}

// Colour is for the exception, not the rule.
//
// Current is the answer on most of the catalogue, so a green word on every card
// in every grid was the loudest thing on the page and it was saying the least:
// green everywhere carries no information and competes with the tool's own
// name. The word goes quiet and the dot stays green, which is enough to tell
// Current from Inactive at a glance without shouting the normal case.
//
// Stale keeps its amber. That one IS the exception and is worth a look.
const labelConfig = {
  Current: { dot: 'bg-fresh', text: 'text-muted' },
  Stale: { dot: 'bg-stale', text: 'text-stale' },
  // Both share the quiet grey because both mean "not moving". They differ in
  // the one thing that matters to a reader deciding whether to use it.
  Deprecated: { dot: 'bg-abandoned', text: 'text-abandoned' },
  Inactive: { dot: 'bg-abandoned', text: 'text-abandoned' },
}

export function FreshnessChip({ freshnessState, lastActivityAt, className }: FreshnessChipProps) {
  const label = getFreshnessLabel(freshnessState, lastActivityAt)
  if (!label) return null

  const config = labelConfig[label]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.text, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {label}
    </span>
  )
}
