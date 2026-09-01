import Link from 'next/link'
import { CalendarClock, Coins, Globe2, Gauge, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PublicGrant } from '@/lib/grants/grant-display'
import {
  DEADLINE_STATE_LABEL,
  EFFORT_SHORT_LABEL,
  FUNDER_TYPE_LABEL,
  PROGRAM_LABEL,
  countdownTone,
  expectedNextWindow,
  formatAwardRange,
  formatCountdown,
  formatDay,
  formatDeadline,
  geographyLabel,
  resolveNextCycle,
} from '@/lib/grants/grant-display'

/**
 * One grant in the listing.
 *
 * A closed grant is dimmed, not hidden. Knowing that a grant closed in March
 * and comes round again next March is what lets a team plan for it, so the
 * card keeps its place in the list and says when the window is expected back.
 *
 * `now` is passed in rather than read from the clock so the whole listing is
 * dated from a single instant. The explorer is a client component, so a card
 * that called `new Date()` itself would render one string on the server and a
 * different one during hydration the moment a countdown ticked over a day.
 */
export function GrantCard({ grant, now }: { grant: PublicGrant; now: Date }) {
  const resolved = resolveNextCycle(grant, now)
  const closed = resolved.state === 'closed'
  const award = formatAwardRange(grant)
  const countdown = formatCountdown(resolved.daysRemaining)
  const tone = countdownTone(resolved.daysRemaining)
  const deadline = formatDeadline(resolved.cycle?.deadlineAt ?? null)
  const nextWindow = closed ? expectedNextWindow(grant, now) : null
  const verified = formatDay(grant.verifiedAt)

  return (
    <Link
      href={`/${grant.slug}`}
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors',
        closed
          ? 'border-border-subtle bg-surface/60 hover:border-border hover:bg-surface'
          : 'border-border-subtle bg-surface hover:border-border hover:bg-surface-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={cn('font-semibold text-foreground', closed && 'text-muted')}>{grant.name}</h2>
          {grant.funder && (
            <p className="mt-0.5 truncate text-sm text-muted">
              {grant.funder.name}
              <span className="text-muted-2"> · {FUNDER_TYPE_LABEL[grant.funder.type]}</span>
            </p>
          )}
        </div>
        <DeadlinePill state={resolved.state} countdown={countdown} tone={tone} estimated={resolved.isEstimated} />
      </div>

      {grant.summary && (
        <p className={cn('line-clamp-2 text-sm', closed ? 'text-muted-2' : 'text-muted')}>{grant.summary}</p>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
        {award && (
          <Fact icon={<Coins className="h-3.5 w-3.5" />} label="Award">
            {award}
          </Fact>
        )}
        {deadline && (
          <Fact icon={<CalendarClock className="h-3.5 w-3.5" />} label={closed ? 'Last deadline' : 'Deadline'}>
            {/* isEstimated dates are never shown bare. See the "expected"
                treatment on the detail page: a carried-over date that reads
                like a published one is exactly the wrong deadline we refuse
                to ship. */}
            {resolved.isEstimated ? `${deadline} (expected)` : deadline}
          </Fact>
        )}
        <Fact icon={<Globe2 className="h-3.5 w-3.5" />} label="Who can apply">
          {geographyLabel(grant)}
        </Fact>
        {grant.effortLevel !== 'unknown' && (
          <Fact icon={<Gauge className="h-3.5 w-3.5" />} label="Effort">
            {EFFORT_SHORT_LABEL[grant.effortLevel]}
          </Fact>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        {grant.programs.map((p) => (
          <span key={p} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-muted">
            {PROGRAM_LABEL[p]}
          </span>
        ))}
        {nextWindow && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-muted-2">
            Expected back {nextWindow}
          </span>
        )}
        {verified && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-2" title="Last checked by a person">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified {verified}
          </span>
        )}
      </div>
    </Link>
  )
}

/**
 * The state badge. It says the state first and the countdown second, because
 * "Closed" on its own is useful and "3 days left" on its own is not.
 */
function DeadlinePill({
  state,
  countdown,
  tone,
  estimated,
}: {
  state: ReturnType<typeof resolveNextCycle>['state']
  countdown: string | null
  tone: 'urgent' | 'soon' | 'normal'
  estimated: boolean
}) {
  const open = state === 'open'
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
        state === 'closed' && 'bg-surface-3 text-muted-2',
        state === 'rolling' && 'bg-rookie/15 text-rookie',
        state === 'unknown' && 'bg-surface-3 text-muted',
        state === 'upcoming' && 'bg-surface-3 text-muted',
        open && tone === 'urgent' && 'bg-frc/15 text-frc',
        open && tone === 'soon' && 'bg-official/15 text-official',
        open && tone === 'normal' && 'bg-primary/15 text-primary',
      )}
    >
      {open && countdown ? countdown : DEADLINE_STATE_LABEL[state]}
      {estimated && state !== 'closed' && <span className="font-normal"> · expected</span>}
    </span>
  )
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-2" aria-hidden>
        {icon}
      </span>
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
