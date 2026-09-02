import { toPublicFreshnessLabel, type FreshnessState } from '@the-tool-pit/db/tool-enums'
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
  // The state-to-label mapping lives in packages/db and this used to repeat it
  // word for word, including the reasoning about "Deprecated" and "Inactive".
  // The copy in packages/db had no callers at all, so the shared one was the
  // dead one and the duplicate was what shipped.
  const fromState = toPublicFreshnessLabel(freshnessState as FreshnessState | null | undefined)
  if (fromState) return fromState

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
