import Link from 'next/link'

/**
 * The two halves of a candidate card, shared by both listing verticals.
 *
 * `extracted` and `raw_metadata` are separate jsonb columns on purpose, and
 * they are separate panels here for the same reason. Extracted is what accept
 * writes onto a row. Raw metadata is the discovery trail and the quoted words
 * a parse keyed off, and it never reaches a listing.
 *
 * The evidence panel is not decoration. A forum connector cannot tell a team
 * offering field time from a team asking for one, so a reviewer needs the
 * sentence in front of them or the only honest decision is to reject
 * everything.
 */

/** The sentence a value came from, and which page said it. */
export type ReadEvidence = Record<string, { quote: string; source: string }>

/** A page URL shortened to something readable in a badge. */
function sourceLabel(source: string): string {
  if (source === 'thread') return 'thread'
  try {
    const url = new URL(source)
    const path = url.pathname.replace(/\/$/, '')
    return `${url.host.replace(/^www\./, '')}${path.length > 1 ? path : ''}`
  } catch {
    return source
  }
}

/**
 * One extracted field. A value of null renders as a gap the reviewer must fill.
 *
 * A value read by the model carries the sentence it came from and the page that
 * said it, printed under the value. That is the whole basis for trusting the
 * row: the reviewer checks the words rather than the label, and a quote from
 * the event's own pay page is worth more than one from a forum post.
 */
export function ExtractedList({
  rows,
  evidence,
  keys,
}: {
  rows: [label: string, value: string | number | null | undefined][]
  /** Field name to quote, keyed by the extracted field, not the label. */
  evidence?: ReadEvidence
  /** Label to field name, when the two differ ("dates" holds startDate). */
  keys?: Record<string, string>
}) {
  const filled = rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
  const missing = rows.filter(([, v]) => v === null || v === undefined || v === '').map(([k]) => k)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Extracted</p>
      {filled.length === 0 ? (
        <p className="text-xs text-muted">
          Nothing was read that could be checked against a source. Everything on this lead is in the evidence.
        </p>
      ) : (
        <dl className="flex flex-col gap-1.5 text-xs">
          {filled.map(([label, value]) => {
            const found = evidence?.[keys?.[label] ?? label]
            return (
              <div key={label} className="grid grid-cols-[6rem_1fr] gap-x-3 sm:grid-cols-[7rem_1fr]">
                <dt className="text-muted-2">{label}</dt>
                <dd className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words text-foreground">{String(value)}</span>
                  {found?.quote && (
                    <span className="flex flex-wrap items-start gap-1.5 text-[10px] leading-snug">
                      <span className="shrink-0 rounded bg-official/20 px-1 py-px font-medium uppercase tracking-wide text-official">
                        {sourceLabel(found.source)}
                      </span>
                      <span className="min-w-0 break-words italic text-muted">“{found.quote}”</span>
                    </span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
      {missing.length > 0 && (
        <p className="text-[10px] text-muted-2">not read: {missing.join(', ')}</p>
      )}
    </div>
  )
}

export function EvidencePanel({
  sourceUrl,
  canonicalUrl,
  description,
  discoveredVia,
  evidence,
  signals,
  links,
  readPages,
  readRejected,
  readAt,
}: {
  sourceUrl: string
  canonicalUrl: string | null
  description?: string
  discoveredVia?: string
  evidence?: string[]
  /** Field-spec mentions. Evidence for a human, never a parsed value. */
  signals?: string[]
  links?: string[]
  /** Pages the reader opened, in order. */
  readPages?: string[]
  /** Values the reader offered that its own evidence did not support. */
  readRejected?: string[]
  readAt?: string
}) {
  const url = canonicalUrl ?? sourceUrl
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Evidence</p>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-xs text-primary hover:underline"
      >
        {url}
      </a>

      {description && (
        <p className="whitespace-pre-line rounded border border-border-subtle bg-surface-2 p-2 text-xs leading-snug text-muted">
          {description.length > 900 ? `${description.slice(0, 900)}…` : description}
        </p>
      )}

      {evidence && evidence.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-muted-2">the words a parse keyed off</p>
          {evidence.map((e) => (
            <p key={e} className="border-l-2 border-border pl-2 text-xs text-foreground">
              {e}
            </p>
          ))}
        </div>
      )}

      {signals && signals.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-muted-2">spec mentions, unparsed: the thread may be describing someone else&apos;s field</p>
          <div className="flex flex-wrap gap-1">
            {signals.map((s) => (
              <span key={s} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {links && links.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-muted-2">links found beside the lead</p>
          {links.slice(0, 6).map((l) => (
            <a
              key={l}
              href={l}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[10px] text-muted hover:text-foreground hover:underline"
            >
              {l}
            </a>
          ))}
          {links.length > 6 && <p className="text-[10px] text-muted-2">and {links.length - 6} more</p>}
        </div>
      )}

      {readPages && readPages.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-muted-2">
            pages read{readAt ? ` ${new Date(readAt).toLocaleDateString()}` : ''}
          </p>
          {readPages.map((l) => (
            <a
              key={l}
              href={l}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[10px] text-muted hover:text-foreground hover:underline"
            >
              {l}
            </a>
          ))}
        </div>
      )}

      {readRejected && readRejected.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {/* Not hidden. A field that was offered and thrown out is the most
              useful thing on this panel: it is where a reviewer looks first
              when a value they expected is missing. */}
          <p className="text-[10px] text-muted-2">offered but unsupported, so not written</p>
          {readRejected.slice(0, 8).map((r) => (
            <p key={r} className="text-[10px] leading-snug text-muted">
              {r}
            </p>
          ))}
        </div>
      )}

      {discoveredVia && <p className="text-[10px] text-muted-2">via {discoveredVia}</p>}
    </div>
  )
}

/**
 * Status tabs with counts, identical on both queues.
 *
 * `labels` exists because the candidate status tuple says 'published' where a
 * reviewer means "accepted into a listing". The listing it produced is still
 * pending its own review, so the raw word would be a lie on this screen.
 */
export function StatusTabs({
  basePath,
  statuses,
  active,
  counts,
  labels,
}: {
  basePath: string
  statuses: readonly string[]
  active: string
  counts: Record<string, number>
  labels?: Record<string, string>
}) {
  return (
    // WRAPS on a phone, scrolls on nothing.
    //
    // These were one horizontally-scrolling row, so on a 390px screen the last
    // two statuses sat off the right edge with nothing to say they were there:
    // a queue you cannot see is a queue nobody works. Six short words wrap onto
    // two lines and every one of them is reachable without a drag.
    //
    // The inactive tabs were text-muted, which on this background is a caption
    // grey. They are links, and one of them is where the reviewer is going
    // next.
    <div className="flex flex-wrap gap-x-1 gap-y-0 border-b border-border-subtle">
      {statuses.map((s) => (
        <Link
          key={s}
          href={`${basePath}?status=${s}`}
          className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm capitalize transition-colors ${
            active === s
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-foreground/80 hover:border-border hover:text-foreground'
          }`}
        >
          {labels?.[s] ?? s}
          {counts[s] != null && counts[s] > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                active === s ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-foreground'
              }`}
            >
              {counts[s]}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
