import { cn } from '@/lib/utils/cn'
import { getFreshnessLabel } from '@/lib/utils/time'

interface FreshnessChipProps {
  freshnessState: string | null | undefined
  lastActivityAt: Date | string | null | undefined
  className?: string
}

const labelConfig = {
  Current: { dot: 'bg-[var(--color-current)]', text: 'text-[var(--color-current)]' },
  Stale: { dot: 'bg-[var(--color-stale)]', text: 'text-[var(--color-stale)]' },
  Abandoned: { dot: 'bg-[var(--color-abandoned)]', text: 'text-[var(--color-abandoned)]' },
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
