import {
  MapPin,
  CalendarDays,
  Users,
  DollarSign,
  ExternalLink,
  Mail,
  HandHeart,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PublicEvent } from '@/lib/events/event-display'
import {
  eventMarkerStyle,
  eventTiming,
  eventDateRange,
  eventLocation,
  costLabel,
  daysLabel,
  fullnessLabel,
  fullnessRatio,
  daysUntil,
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_SHORT,
} from '@/lib/events/event-display'

/** A small round swatch matching this event's pin colour. */
function PinDot({ ev, now }: { ev: PublicEvent; now: Date }) {
  const s = eventMarkerStyle(ev, now)
  return (
    <span
      className="mt-1 inline-block shrink-0 rounded-full border border-white/60"
      style={{ width: 14, height: 14, background: s.color }}
    />
  )
}

/** "In 11 days", "Today", "3 days ago", or a plain confirmed/cancelled note. */
function timingPhrase(ev: PublicEvent, now: Date): string {
  if (ev.eventStatus === 'cancelled') return 'Cancelled'
  const timing = eventTiming(ev, now)
  const d = daysUntil(ev, now)
  if (timing === 'past') return 'Completed'
  if (d == null) return EVENT_STATUS_LABEL[ev.eventStatus]
  if (d <= 0) return 'Happening now'
  if (d === 1) return 'Tomorrow'
  if (d <= 45) return `In ${d} days`
  return EVENT_STATUS_LABEL[ev.eventStatus]
}

/** Registration chip, coloured green when open, amber for waitlist. */
function RegBadge({ ev }: { ev: PublicEvent }) {
  const s = ev.registrationStatus
  if (s === 'unknown') return null
  const tone =
    s === 'open' ? 'bg-rookie/15 text-rookie'
    : s === 'waitlist' ? 'bg-official/15 text-official'
    : 'bg-surface-3 text-muted'
  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', tone)}>{REGISTRATION_STATUS_SHORT[s]}</span>
}

/** A slim fullness bar, shown only when we have a count against a capacity. */
function FullnessBar({ ev }: { ev: PublicEvent }) {
  // A waitlist IS the capacity signal. Most events never publish a team count,
  // so the bar used to be blank on exactly the events where "can I still get
  // in" matters most. If they are taking a waiting list, they are full.
  const ratio = ev.registrationStatus === 'waitlist' ? 1 : fullnessRatio(ev)
  if (ratio == null) return null
  const pct = Math.round(ratio * 100)
  const tone = ratio >= 1 ? 'bg-official' : ratio >= 0.85 ? 'bg-official' : 'bg-rookie'
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-muted-2">
        {ev.registrationStatus === 'waitlist' && fullnessRatio(ev) == null ? 'Full' : `${pct}% full`}
      </span>
    </div>
  )
}

/** Compact, selectable list row. Leads with the date, because timing is the point. */
export function EventCard({
  event: ev,
  now,
  selected,
  onSelect,
  distance,
}: {
  event: PublicEvent
  now: Date
  selected: boolean
  onSelect: (id: string) => void
  distance?: string | null
}) {
  const loc = eventLocation(ev)
  const cost = costLabel(ev)
  const full = fullnessLabel(ev)
  const cancelled = ev.eventStatus === 'cancelled'
  return (
    // The border and background live on this wrapper, not on the button,
    // because the Register link is a SIBLING of the button. An anchor nested
    // inside a button is invalid HTML and the two click targets fight over the
    // same tap.
    <div
      className={cn(
        'rounded-lg border transition-colors',
        selected ? 'border-primary bg-surface-2' : 'border-border-subtle bg-surface hover:bg-surface-2',
      )}
    >
    <button
      type="button"
      onClick={() => onSelect(ev.id)}
      className="flex w-full cursor-pointer items-start gap-3 p-3 text-left"
    >
      <PinDot ev={ev} now={now} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate font-medium', cancelled ? 'text-muted-2 line-through' : 'text-foreground')}>
            {ev.name}
          </span>
          {ev.program !== 'frc' && (
            <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {ev.program}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {ev.startDate && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3 shrink-0" />
              {eventDateRange(ev)}
            </span>
          )}
          <span className={cn('font-medium', cancelled ? 'text-frc' : 'text-primary')}>{timingPhrase(ev, now)}</span>
        </div>

        {(loc || distance) && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-2">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{loc}</span>
            {distance && <span className="ml-auto shrink-0 pl-2 font-medium text-muted">{distance} away</span>}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RegBadge ev={ev} />
          {full && (
            <span className="flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-muted">
              <Users className="h-3 w-3" />
              {full}
            </span>
          )}
          {cost && (
            <span className="flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-muted">
              <DollarSign className="h-3 w-3" />
              {/* The icon is the currency marker, so the value drops its own. */}
              {cost.replace(/^\$/, '')}
            </span>
          )}
        </div>

        <FullnessBar ev={ev} />
      </div>
    </button>

    </div>
  )
}

/** Full detail view, used in the dialog and on the shareable /events/[id] page. */
export function EventDetail({ event: ev, now }: { event: PublicEvent; now: Date }) {
  const loc = eventLocation(ev)
  const cost = costLabel(ev)
  const full = fullnessLabel(ev)
  const days = daysLabel(ev)
  const cancelled = ev.eventStatus === 'cancelled'
  const registerHref = ev.registrationUrl ?? ev.website ?? ev.chiefDelphiUrl
  // Volunteering falls back the same way registration does: the dedicated link
  // if there is one, otherwise the event's own page, which is where the form
  // usually lives. Null when nobody is asking for volunteers or we have no
  // link at all, because a button that lands you nowhere useful is worse than
  // no button.
  const volunteerHref =
    ev.volunteerStatus === 'open' && !cancelled ? (ev.volunteerUrl ?? ev.website ?? ev.chiefDelphiUrl) : null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn('text-2xl font-bold', cancelled ? 'text-muted-2 line-through' : 'text-foreground')}>{ev.name}</h1>
          {ev.program !== 'frc' && (
            <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {ev.program}
            </span>
          )}
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', cancelled ? 'bg-frc/15 text-frc' : 'bg-primary/15 text-primary')}>
            {timingPhrase(ev, now)}
          </span>
        </div>
        {ev.startDate && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <CalendarDays className="h-4 w-4" />
            {eventDateRange(ev)}
            {days && <span className="text-muted-2">· {days}</span>}
          </p>
        )}
        {loc && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-2">
            <MapPin className="h-4 w-4" />
            {ev.address ? `${ev.address}, ${[ev.city, ev.region, ev.country].filter(Boolean).join(', ')}` : loc}
          </p>
        )}
      </div>

      {full && fullnessRatio(ev) != null && (
        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Users className="h-4 w-4" /> {full}
            </span>
            <span className="text-muted-2">{Math.round((fullnessRatio(ev) ?? 0) * 100)}% full</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn('h-full rounded-full', (fullnessRatio(ev) ?? 0) >= 0.85 ? 'bg-official' : 'bg-rookie')}
              style={{ width: `${Math.round((fullnessRatio(ev) ?? 0) * 100)}%` }}
            />
          </div>
          {ev.teamCountUpdatedAt && (
            <p className="mt-2 text-xs text-muted-2">
              Team count last checked {new Date(ev.teamCountUpdatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {ev.registrationOpensAt && ev.registrationStatus === 'not_open' && (
          <Row icon={<Clock className="h-4 w-4" />} label="Registration opens" value={eventDateRange({ startDate: ev.registrationOpensAt, endDate: null })} />
        )}
        {cost && <Row icon={<DollarSign className="h-4 w-4" />} label="Cost" value={cost} />}
        {/* Capacity answers "can I still get in", which a finished or
            cancelled event cannot be asked. */}
        {!full && ev.capacity != null && !cancelled && eventTiming(ev, now) !== 'past' && (
          <Row icon={<Users className="h-4 w-4" />} label="Capacity" value={`${ev.capacity} teams`} />
        )}
        {ev.hostTeamNumber != null && <Row icon={<Users className="h-4 w-4" />} label="Hosted by" value={`Team ${ev.hostTeamNumber}`} />}
      </dl>

      {ev.notes && <p className="whitespace-pre-wrap text-sm text-muted">{ev.notes}</p>}

      {/* Two rows on purpose: the things you DO with this event, then the
          places you read more about it. Five equal buttons in one wrap read as
          a pile with no order to them. */}
      {(registerHref || volunteerHref) && !cancelled && (
        <div className="flex flex-wrap gap-3">
          {registerHref && (
            <a href={registerHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
              {ev.registrationUrl ? 'Register' : 'Event page'} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {volunteerHref && (
            <a href={volunteerHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
              <HandHeart className="h-4 w-4" /> Volunteer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {(ev.website || ev.tbaKey) && (
        <div className="flex flex-wrap gap-3">
          {ev.website && registerHref !== ev.website && volunteerHref !== ev.website && (
            <a href={ev.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
              Event website <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {ev.tbaKey && (
            <a href={`https://www.thebluealliance.com/event/${ev.tbaKey}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
              The Blue Alliance <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {ev.contactEmail && (
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
          <Mail className="h-4 w-4 shrink-0 text-muted-2" />
          <a href={`mailto:${ev.contactEmail}`} className="text-primary hover:underline">{ev.contactEmail}</a>
        </div>
      )}
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-2">{icon}</span>
      <div>
        <dt className="text-xs text-muted-2">{label}</dt>
        <dd className="text-sm text-foreground">{value}</dd>
      </div>
    </div>
  )
}
