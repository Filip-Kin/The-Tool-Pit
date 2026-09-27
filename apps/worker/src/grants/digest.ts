/**
 * Daily grant digest: the pure half.
 *
 * WHY A DIGEST. The sweeper queues one grant_alerts row per match per member,
 * and the drain used to send one email per row. A new team profile's first
 * sweep matches every grant that already fits it, so on 2026-09-27 one mentor
 * got 35 separate emails in a few minutes. Now new_match and deadline rows are
 * collected per user and sent as one email a day.
 *
 * THE GATE. A user's digest goes out on the first drain pass at or after
 * 13:00 UTC (9 am US Eastern in summer, 8 am in winter), and only when their
 * last digest is at least 20 hours old. The drain runs every 5 minutes, so in
 * practice that is ~13:00 each day. 20 hours rather than 24 so a digest sent at
 * 13:04 yesterday does not block today's 13:00 pass; the window closes at
 * midnight UTC, 11 hours after it opens, so 20 hours still means one a day.
 * "Last digest" is read off grant_alerts.sent_at for the digest kinds, which
 * needs no new table: a digest stamps every row it carried.
 *
 * Everything here is free of the DB and the transport, so the grouping, the
 * gate, the rendering input and the retry arithmetic test without either.
 */
import type { GrantDigestGroup, GrantDigestItem } from '@the-tool-pit/types'

// #region policy

/**
 * How many delivery attempts one alert gets before it is parked.
 *
 * Parked means "stop trying", not "deleted": the row keeps its error text and
 * an admin can requeue it by resetting `attempts`. There is no `failed` column
 * on grant_alerts, so parking is expressed as attempts stamped at the cap,
 * which is also what keeps the row out of the next drain's SELECT.
 */
export const MAX_ATTEMPTS = 5

/** First retry gap. Doubles per attempt up to RETRY_MAX_MS. */
export const RETRY_BASE_MS = 10 * 60 * 1000

/** Longest gap between retries. Beyond this, waiting longer helps nobody. */
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/** Kinds that go out in the daily digest rather than one email per row. */
export const DIGEST_KINDS = ['new_match', 'deadline'] as const

/** Hour (UTC) the daily send window opens. 13:00 UTC is 9 am EDT. */
export const DIGEST_HOUR_UTC = 13

/** Minimum gap between two digests to the same person. */
export const DIGEST_MIN_GAP_MS = 20 * 60 * 60 * 1000

/** Error text on a deadline row dropped because the date went by first. */
export const DEADLINE_PASSED_ERROR = 'deadline passed before the digest'

/** Backoff after `attempts` failed tries. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (Math.max(1, attempts) - 1))
}

// #endregion

// #region gate

export function isDigestKind(kind: string): boolean {
  return (DIGEST_KINDS as readonly string[]).includes(kind)
}

/**
 * May this user's digest go out on a pass at `now`?
 *
 * Open from 13:00 UTC to midnight UTC, and only when the last digest is at
 * least 20 hours old. Before 13:00 nothing sends and rows wait.
 */
export function digestWindowOpen(now: Date, lastDigestAt: Date | null): boolean {
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return false
  if (!lastDigestAt) return true
  return now.getTime() - lastDigestAt.getTime() >= DIGEST_MIN_GAP_MS
}

// #endregion

// #region grouping

/** The columns of a grant_alerts row the digest reads. */
export interface DigestRow {
  id: string
  userId: string
  kind: string
  payload: unknown
  attempts: number
}

/** Rows grouped by user, in first-seen order. */
export function groupByUser<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const list = out.get(row.userId)
    if (list) list.push(row)
    else out.set(row.userId, [row])
  }
  return out
}

/** A jsonb ISO string as a Date, or null when absent or unparseable. */
function asDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at
}

interface ParsedRow<T> {
  row: T
  kind: 'new_match' | 'deadline'
  teamLabel: string | null
  item: GrantDigestItem
}

/** Payload to digest item, or null when the payload cannot be rendered. */
function parseRow<T extends DigestRow>(row: T): ParsedRow<T> | null {
  const p = row.payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.grantName !== 'string' || typeof p.grantUrl !== 'string') return null
  if (row.kind !== 'new_match' && row.kind !== 'deadline') return null

  const deadlineAt = asDate(p.deadlineAt)
  // A deadline reminder without a usable date is not a reminder.
  if (row.kind === 'deadline' && !deadlineAt) return null

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    row,
    kind: row.kind,
    teamLabel: str(p.teamLabel),
    item: {
      grantName: p.grantName,
      grantUrl: p.grantUrl,
      funderName: str(p.funderName),
      awardMin: num(p.awardMin),
      awardMax: num(p.awardMax),
      awardCurrency: str(p.awardCurrency),
      deadlineAt,
      deadlineNote: str(p.deadlineNote),
    },
  }
}

export interface DigestPlan<T> {
  /** Rows the email carries. All stamped sent together. */
  include: T[]
  /** Deadline rows whose date passed before the digest. Parked, not sent. */
  passed: T[]
  /** Rows with a payload no template can use. Parked. */
  unrenderable: T[]
  /** Template input. Empty when `include` is empty. */
  groups: GrantDigestGroup[]
}

/**
 * Sort one user's due rows into what the digest sends, what it drops, and the
 * grouped template input.
 *
 * Grouped by teamLabel. Rows with no team (a watched grant's reminder) fold
 * into the one team when the user has exactly one, so a single-team mentor
 * who also watches a grant gets one list rather than two.
 *
 * A deadline for the same grant and date queued twice (two reminder offsets
 * that both fell due while waiting) is listed once. Both rows still go in
 * `include`, so both are stamped.
 */
export function planDigest<T extends DigestRow>(rows: T[], now: Date): DigestPlan<T> {
  const passed: T[] = []
  const unrenderable: T[] = []
  const parsed: ParsedRow<T>[] = []

  for (const row of rows) {
    const p = parseRow(row)
    if (!p) {
      unrenderable.push(row)
      continue
    }
    if (p.kind === 'deadline' && (p.item.deadlineAt as Date).getTime() < now.getTime()) {
      passed.push(row)
      continue
    }
    parsed.push(p)
  }

  const teams = [...new Set(parsed.map((p) => p.teamLabel).filter((l): l is string => !!l))]
  const fold = teams.length === 1 ? teams[0]! : null

  const byTeam = new Map<string | null, GrantDigestGroup>()
  const seen = new Set<string>()
  for (const p of parsed) {
    const label = p.teamLabel ?? fold
    let group = byTeam.get(label)
    if (!group) {
      group = { teamLabel: label, closingSoon: [], newMatches: [] }
      byTeam.set(label, group)
    }
    const key = `${label ?? ''}|${p.kind}|${p.item.grantUrl}|${p.item.deadlineAt?.toISOString() ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (p.kind === 'deadline') group.closingSoon.push(p.item)
    else group.newMatches.push(p.item)
  }

  // Named teams first in first-seen order, the no-team group last.
  const groups = [...byTeam.values()].sort((a, b) => Number(a.teamLabel === null) - Number(b.teamLabel === null))

  return { include: parsed.map((p) => p.row), passed, unrenderable, groups }
}

// #endregion

// #region failure

export type SendFailure = { retryable: boolean; error: string }

/** What to write on one row after a failed digest send. */
export type RowFailureUpdate =
  | { id: string; attempts: number; park: 'attempts' | 'transport'; error: string }
  | { id: string; attempts: number; park: null; error: string; sendAfter: Date }

/**
 * One failed send is one failed attempt on every row the email carried. Each
 * row keeps its own count, so a row that was already on its fourth try parks
 * while a fresh one in the same email backs off.
 */
export function planDigestFailure(rows: DigestRow[], failure: SendFailure, now: Date): RowFailureUpdate[] {
  return rows.map((row) => {
    const attempts = row.attempts + 1
    if (!failure.retryable) {
      return { id: row.id, attempts: Math.max(MAX_ATTEMPTS, attempts), park: 'transport', error: failure.error }
    }
    if (attempts >= MAX_ATTEMPTS) {
      return {
        id: row.id,
        attempts,
        park: 'attempts',
        error: `gave up after ${attempts} attempts: ${failure.error}`,
      }
    }
    return {
      id: row.id,
      attempts,
      park: null,
      error: failure.error,
      sendAfter: new Date(now.getTime() + retryDelayMs(attempts)),
    }
  })
}

// #endregion
