/**
 * One unambiguous date format for the whole app.
 *
 * A bare `new Date(x).toLocaleDateString()` renders "2/9/2026", which is
 * February 9th to a US reader and September 2nd to everyone else, and the
 * server's locale, not the reader's, decides. FRC's audience is overwhelmingly
 * US, so we spell the month out and lead with it: no reader has to guess.
 */
const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Sep 2, 2026", or "" for a missing/invalid date. */
export function formatDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  return d ? d.toLocaleDateString('en-US', DATE_OPTS) : ''
}

/** "Sep 2, 2026, 9:27 PM", or "" for a missing/invalid date. */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  return d ? d.toLocaleString('en-US', DATETIME_OPTS) : ''
}
