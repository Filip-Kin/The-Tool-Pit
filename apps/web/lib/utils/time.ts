import { formatDistanceToNow, differenceInDays } from 'date-fns'

export function formatRelativeTime(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return null
  return formatDistanceToNow(d, { addSuffix: true })
}

export function getFreshnessLabel(
  freshnessState: string | null | undefined,
  lastActivityAt: Date | string | null | undefined,
): 'Current' | 'Stale' | 'Abandoned' | null {
  // Use DB-stored state as primary signal
  switch (freshnessState) {
    case 'active':
    case 'evergreen':
    case 'seasonal':
      return 'Current'
    case 'stale':
      return 'Stale'
    case 'inactive':
    case 'archived':
      return 'Abandoned'
  }

  // Fall back to date-based heuristic
  if (lastActivityAt) {
    const d = typeof lastActivityAt === 'string' ? new Date(lastActivityAt) : lastActivityAt
    const days = differenceInDays(new Date(), d)
    if (days <= 90) return 'Current'
    if (days <= 365) return 'Stale'
    return 'Abandoned'
  }

  return null // Don't show "Unknown" on frontend
}
