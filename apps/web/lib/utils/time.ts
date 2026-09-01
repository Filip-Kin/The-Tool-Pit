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
): 'Current' | 'Stale' | 'Archived' | 'Abandoned' | null {
  // Use DB-stored state as primary signal
  switch (freshnessState) {
    case 'active':
    case 'evergreen':
    case 'seasonal':
      return 'Current'
    case 'stale':
      return 'Stale'
    // Archived is not abandoned, and conflating them libels good software.
    // wpilibsuite/PathWeaver reports archived: true on GitHub because WPILib
    // stopped developing it there, and the app still ships and is still used.
    // Calling that "Abandoned" tells a rookie to avoid an official tool.
    // Archiving is a deliberate act by a maintainer and usually means finished
    // or moved, so the chip says what happened and lets the reader judge.
    case 'archived':
      return 'Archived'
    case 'inactive':
      return 'Abandoned'
  }

  // Fall back to date-based heuristic
  if (lastActivityAt) {
    const d = typeof lastActivityAt === 'string' ? new Date(lastActivityAt) : lastActivityAt
    // Must match computeFreshnessState in apps/worker/src/jobs/freshness.ts.
    // FRC is seasonal: in September, 8 months ago was build season. A year is
    // the first gap worth flagging, two years means a season was missed.
    const days = differenceInDays(new Date(), d)
    if (days <= 365) return 'Current'
    if (days <= 730) return 'Stale'
    return 'Abandoned'
  }

  return null // Don't show "Unknown" on frontend
}
