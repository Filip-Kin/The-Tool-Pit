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

/** One extracted field. A value of null renders as a gap the reviewer must fill. */
export function ExtractedList({ rows }: { rows: [label: string, value: string | number | null | undefined][] }) {
  const filled = rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
  const missing = rows.filter(([, v]) => v === null || v === undefined || v === '').map(([k]) => k)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Extracted</p>
      {filled.length === 0 ? (
        <p className="text-xs text-muted">
          The connector read nothing it was sure of. Everything on this lead is in the evidence.
        </p>
      ) : (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
          {filled.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-2">{label}</dt>
              <dd className="min-w-0 break-words text-foreground">{String(value)}</dd>
            </div>
          ))}
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
}: {
  sourceUrl: string
  canonicalUrl: string | null
  description?: string
  discoveredVia?: string
  evidence?: string[]
  /** Field-spec mentions. Evidence for a human, never a parsed value. */
  signals?: string[]
  links?: string[]
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
    <div className="flex gap-1 overflow-x-auto border-b border-border-subtle">
      {statuses.map((s) => (
        <Link
          key={s}
          href={`${basePath}?status=${s}`}
          className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm capitalize transition-colors ${
            active === s ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-foreground'
          }`}
        >
          {labels?.[s] ?? s}
          {counts[s] != null && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{counts[s]}</span>
          )}
        </Link>
      ))}
    </div>
  )
}
