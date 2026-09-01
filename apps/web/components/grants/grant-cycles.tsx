import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PublicGrantCycle } from '@/lib/grants/grant-display'
import { DEADLINE_STATE_LABEL, cycleState, formatDay, formatDeadline, formatPlainDate } from '@/lib/grants/grant-display'

/**
 * Every application window we know of, newest first, past ones included.
 *
 * The history is the point. A team looking at a grant that shut in March can
 * see it shut in March last year too, which is the difference between "gone"
 * and "come back in February". It is also the only way to judge how reliable
 * the dates are: three published years in a row reads very differently from
 * one estimate.
 */
export function GrantCycles({ cycles, now }: { cycles: PublicGrantCycle[]; now: Date }) {
  if (cycles.length === 0) {
    return (
      <p className="text-sm text-muted-2">
        No application windows recorded yet. We will not invent one, so check the funder&apos;s page for dates.
      </p>
    )
  }

  const ordered = [...cycles].sort((a, b) => b.cycleYear - a.cycleYear)

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((cycle) => {
        const state = cycleState(cycle, now)
        const past = state === 'closed'
        const deadline = formatDeadline(cycle.deadlineAt)
        const opens = formatPlainDate(cycle.opensAt)
        const decision = formatPlainDate(cycle.decisionAt)
        const verified = formatDay(cycle.verifiedAt)

        return (
          <li
            key={cycle.id}
            className={cn(
              'flex flex-col gap-2 rounded-md border p-3',
              past ? 'border-border-subtle bg-surface/60' : 'border-border bg-surface',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-sm font-semibold', past ? 'text-muted' : 'text-foreground')}>
                {cycle.cycleYear}
              </span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
                {DEADLINE_STATE_LABEL[state]}
              </span>
              {/*
                An estimated cycle is one we carried over from a previous year,
                not something the funder has published. It says "expected"
                wherever it appears, and it is never used for a reminder.
              */}
              {cycle.isEstimated && (
                <span className="rounded-full bg-official/15 px-2 py-0.5 text-xs text-official">Expected, not confirmed</span>
              )}
            </div>

            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {opens && <CycleRow label="Opens" value={cycle.isEstimated ? `${opens} (expected)` : opens} />}
              {deadline && (
                <CycleRow
                  label={past ? 'Closed' : 'Deadline'}
                  value={cycle.isEstimated ? `${deadline} (expected)` : deadline}
                />
              )}
              {decision && <CycleRow label="Decisions" value={decision} />}
              {cycle.amountNote && <CycleRow label="Award this round" value={cycle.amountNote} />}
            </dl>

            {/* The funder's own wording about the closing time, kept verbatim
                next to the instant we render, because "by close of business"
                and "11:59pm ET" are not the same promise. */}
            {cycle.deadlineNote && <p className="text-xs text-muted">{cycle.deadlineNote}</p>}

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-2">
              {verified ? (
                <span>Dates confirmed by a person on {verified}</span>
              ) : (
                <span>Dates not confirmed by a person yet</span>
              )}
              {cycle.sourceUrl && (
                <a
                  href={cycle.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Where these came from <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function CycleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-xs text-muted-2">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  )
}
