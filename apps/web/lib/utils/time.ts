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
): 'Current' | 'Stale' | 'Deprecated' | 'Inactive' | null {
  // Use DB-stored state as primary signal
  switch (freshnessState) {
    case 'active':
    case 'evergreen':
    case 'seasonal':
      return 'Current'
    case 'stale':
      return 'Stale'
    // Two facts, two words, and neither is a verdict.
    //
    // "Abandoned" carried a connotation we cannot support. It says someone gave
    // up, when all we know is that a repo stopped moving. wpilibsuite/PathWeaver
    // reports archived: true on GitHub, and it still ships with WPILib and is
    // still used, so calling it abandoned told rookies to avoid an official
    // tool.
    //
    // Deprecated is what an archived repo usually means in FRC: superseded, or
    // finished and folded into something else. Inactive is the plain fact for
    // the rest: nothing has happened in a long time, which is worth knowing and
    // is not an accusation.
    case 'archived':
      return 'Deprecated'
    case 'inactive':
      return 'Inactive'
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
    return 'Inactive'
  }

  return null // Don't show "Unknown" on frontend
}
