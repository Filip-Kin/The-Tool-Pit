'use client'

/**
 * A timestamp rendered in the viewer's own timezone, not the server's.
 *
 * The reads inspector runs in server components, so `formatDateTime` there
 * formats with the server's locale and zone (UTC in prod) and every admin sees
 * UTC no matter where they are. This renders the same instant with the browser's
 * zone instead: `undefined` locale and no `timeZone` option both mean "use the
 * runtime's own", which on the client is the viewer's machine.
 *
 * SSR still runs this once in the server's zone, so the first paint is UTC and
 * the client re-render corrects it; `suppressHydrationWarning` is why that
 * mismatch does not log. Only use this for an instant in time. A plain calendar
 * date (an event's start/end) has no zone and must stay on `formatDate`.
 */

const OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

export function LocalTime({ value }: { value: Date | string | number | null | undefined }) {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {d.toLocaleString(undefined, OPTS)}
    </time>
  )
}
