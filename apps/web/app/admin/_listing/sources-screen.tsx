import Link from 'next/link'
import { ConnectorRunButtons, ListingSourceControls, NewSourceForm } from './source-controls'

/**
 * The sources screen both listing verticals share.
 *
 * Yield and reject are the two numbers on it that matter. A source with a high
 * reject count is not "a bit noisy": it costs a person time on every pass and
 * belongs switched off, and these columns are the evidence for that call. They
 * are written only by the accept and suppress actions on the candidate queues.
 */

export interface ListingSourceRow {
  id: string
  label: string
  kind: string
  target: string
  enabled: boolean
  cadenceHours: number
  lastRunAt: Date | null
  lastError: string | null
  yieldCount: number
  rejectCount: number
  notes: string | null
  /** Candidates from this source nobody has decided on yet. */
  pendingCandidates: number
  /** False for kinds no connector reads, e.g. a hand-filed note. */
  runnable: boolean
}

export function ListingSourcesScreen({
  title,
  backHref,
  backLabel,
  intro,
  sources,
  kinds,
  defaultCadence,
  connectors,
  crawlsHref,
  candidatesHref,
  run,
  setEnabled,
  setCadence,
  create,
  runConnector,
}: {
  title: string
  backHref: string
  backLabel: string
  intro: string
  sources: ListingSourceRow[]
  kinds: readonly string[]
  defaultCadence: number
  connectors: { connector: string; label: string; description: string }[]
  crawlsHref: string
  candidatesHref: string
  run: (sourceId: string) => Promise<{ error?: string }>
  setEnabled: (sourceId: string, enabled: boolean) => Promise<{ error?: string }>
  setCadence: (sourceId: string, cadenceHours: number) => Promise<{ error?: string }>
  create: (input: { kind: string; label: string; target: string; cadenceHours: number; notes?: string }) => Promise<{ error?: string }>
  runConnector: (connector: string) => Promise<{ error?: string }>
}) {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href={backHref} className="text-xs text-muted hover:text-foreground">
          ← {backLabel}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{title}</h1>
      </div>

      <p className="max-w-3xl text-xs text-muted-2">{intro}</p>

      {/* #region run a connector */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Run a sweep now</h2>
        <ConnectorRunButtons connectors={connectors} run={runConnector} />
        <p className="text-[10px] text-muted-2">
          Results land in{' '}
          <Link href={candidatesHref} className="text-primary hover:underline">
            candidates
          </Link>{' '}
          and the run itself shows up in{' '}
          <Link href={crawlsHref} className="text-primary hover:underline">
            crawl jobs
          </Link>
          .
        </p>
      </section>
      {/* #endregion */}

      {/* #region sources */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        {sources.length === 0 ? (
          <p className="max-w-3xl text-sm text-muted">
            No source rows. The connectors still run on their built-in settings and still file
            candidates, so this is not a dead vertical. What is missing is the off switch: add a row
            below and cadence and enabled start applying to it.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="w-28 px-4 py-2 text-left">Cadence</th>
                  <th className="w-44 px-4 py-2 text-left">Last run</th>
                  <th className="w-40 px-4 py-2 text-left">Yield / reject</th>
                  <th className="w-56 px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const decided = s.yieldCount + s.rejectCount
                  const acceptRate = decided > 0 ? Math.round((s.yieldCount / decided) * 100) : null
                  const overdue =
                    s.enabled &&
                    (!s.lastRunAt || Date.now() - new Date(s.lastRunAt).getTime() > s.cadenceHours * 3_600_000)
                  return (
                    <tr key={s.id} className={`border-t border-border-subtle align-top ${s.enabled ? '' : 'opacity-50'}`}>
                      <td className="max-w-sm px-4 py-3">
                        <p className="text-xs font-medium text-foreground">{s.label}</p>
                        <p className="font-mono text-[10px] text-muted-2">{s.kind}</p>
                        <p className="mt-0.5 line-clamp-2 break-all text-[10px] text-muted" title={s.target}>
                          {s.target}
                        </p>
                        {!s.enabled && <p className="mt-1 text-[10px] text-muted-2">switched off</p>}
                        {!s.runnable && (
                          <p className="mt-1 text-[10px] text-muted-2">no connector reads this kind</p>
                        )}
                        {s.pendingCandidates > 0 && (
                          <p className="mt-1 text-[10px] text-official">
                            {s.pendingCandidates} candidates still undecided
                          </p>
                        )}
                        {s.notes && <p className="mt-1 text-[10px] text-muted-2">{s.notes}</p>}
                      </td>

                      <td className="px-4 py-3 text-xs text-muted">
                        every {s.cadenceHours}h
                        {overdue && <span className="mt-0.5 block text-[10px] text-official">due</span>}
                      </td>

                      <td className="px-4 py-3 text-[10px]">
                        <p className="text-muted">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'never run'}</p>
                        {s.lastError && <p className="mt-1 text-frc">{s.lastError.slice(0, 120)}</p>}
                      </td>

                      <td className="px-4 py-3 text-xs">
                        <span className="text-rookie">{s.yieldCount}</span>
                        <span className="text-muted-2"> / </span>
                        <span className="text-frc">{s.rejectCount}</span>
                        {acceptRate != null && (
                          <p
                            className={`mt-0.5 text-[10px] ${
                              acceptRate < 20 ? 'text-frc' : acceptRate < 50 ? 'text-official' : 'text-muted-2'
                            }`}
                          >
                            {acceptRate}% of decided candidates were kept
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <ListingSourceControls
                          sourceId={s.id}
                          enabled={s.enabled}
                          cadenceHours={s.cadenceHours}
                          runnable={s.runnable}
                          run={run}
                          setEnabled={setEnabled}
                          setCadence={setCadence}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {/* #endregion */}

      <NewSourceForm kinds={kinds} defaultCadence={defaultCadence} create={create} />
    </div>
  )
}
