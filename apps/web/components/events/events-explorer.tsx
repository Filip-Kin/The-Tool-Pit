'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Search, LocateFixed, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { PublicEvent, DistanceUnit } from '@/lib/events/event-display'
import {
  eventTiming,
  daysUntil,
  distanceKm,
  formatDistance,
  unitFromLocale,
} from '@/lib/events/event-display'
import type { EventProgram } from '@the-tool-pit/db/event-enums'
import { EventCard } from './event-card'
import { EventLegend } from './event-legend'
import { EventDialog } from './event-dialog'

// FRC first and foremost, matching the fields explorer.
const PROGRAMS: { value: EventProgram; label: string }[] = [
  { value: 'frc', label: 'FRC' },
  { value: 'ftc', label: 'FTC' },
  { value: 'fll', label: 'FLL' },
]

// The map only runs in the browser (Leaflet touches window), so load it client-only.
const EventMap = dynamic(() => import('./event-map').then((m) => m.EventMap), {
  ssr: false,
  loading: () => <div className="h-[560px] rounded-lg border border-border bg-surface" />,
})

type When = 'upcoming' | 'past' | 'all'
type SortBy = 'date' | 'distance'
type GeoState = 'idle' | 'locating' | 'granted' | 'denied' | 'unsupported'

export function EventsExplorer({ events, now }: { events: PublicEvent[]; now: Date }) {
  const [program, setProgram] = useState<EventProgram>('frc')
  const [q, setQ] = useState('')
  // Show everything by default. The map is fed from the same filtered rows as
  // the list, so hiding past events hid a third of the pins, and the sort
  // already floats upcoming events to the top without deleting the rest.
  const [when, setWhen] = useState<When>('all')
  const [openOnly, setOpenOnly] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [geo, setGeo] = useState<GeoState>('idle')
  const [unit, setUnit] = useState<DistanceUnit>('km')

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('unsupported')
      return
    }
    setGeo('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGeo('granted')
      },
      () => setGeo('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }

  useEffect(() => {
    setUnit(unitFromLocale(typeof navigator !== 'undefined' ? navigator.language : undefined))
  }, [])

  function open(id: string) {
    setSelectedId(id)
    setOpenId(id)
  }

  const programCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of events) counts[e.program] = (counts[e.program] ?? 0) + 1
    return counts
  }, [events])

  // How many upcoming (not past, not cancelled) events this program has, for the
  // "Upcoming" tab count - the number the vertical is built to surface.
  const upcomingCount = useMemo(
    () =>
      events.filter((e) => e.program === program && e.eventStatus !== 'cancelled' && eventTiming(e, now) !== 'past')
        .length,
    [events, program, now],
  )

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const rows = events
      .filter((e) => {
        if (e.program !== program) return false
        const past = eventTiming(e, now) === 'past'
        if (when === 'upcoming' && past) return false
        if (when === 'past' && !past) return false
        if (openOnly && e.registrationStatus !== 'open') return false
        if (query) {
          const hay = [e.name, e.venueName, e.city, e.region].filter(Boolean).join(' ').toLowerCase()
          if (!hay.includes(query)) return false
        }
        return true
      })
      .map((e) => ({
        event: e,
        km:
          userLoc && e.latitude != null && e.longitude != null
            ? distanceKm(userLoc.lat, userLoc.lng, e.latitude, e.longitude)
            : null,
      }))

    rows.sort((a, b) => {
      if (sortBy === 'distance' && userLoc) return (a.km ?? Infinity) - (b.km ?? Infinity)
      // Past always below upcoming, then within each group by date: upcoming
      // soonest first, past most recent first.
      //
      // The bucket comparison has to come FIRST. Without it a past event and an
      // upcoming one fell through to daysUntil, which is NEGATIVE for anything
      // already run, so an event from July sorted above one happening next
      // week. Kettering Kickoff on 12 September sat below three events that had
      // already finished.
      const aPast = eventTiming(a.event, now) === 'past' ? 1 : 0
      const bPast = eventTiming(b.event, now) === 'past' ? 1 : 0
      if (aPast !== bPast) return aPast - bPast
      if (aPast === 1) return dateKey(b.event.startDate) - dateKey(a.event.startDate)

      // Both still to come. A cancelled one sinks below the live ones so the
      // next real event leads.
      const aCancel = a.event.eventStatus === 'cancelled' ? 1 : 0
      const bCancel = b.event.eventStatus === 'cancelled' ? 1 : 0
      if (aCancel !== bCancel) return aCancel - bCancel
      const ad = daysUntil(a.event, now) ?? Infinity
      const bd = daysUntil(b.event, now) ?? Infinity
      return ad - bd
    })
    return rows
  }, [events, q, when, openOnly, program, sortBy, userLoc, now])

  const mapEvents = useMemo(() => filtered.map((r) => r.event), [filtered])

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:items-start">
      {/* Controls */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
        <SegmentedControl
          label="Program"
          options={PROGRAMS.map((p) => ({ ...p, count: programCounts[p.value] }))}
          value={program}
          onChange={(v) => { setProgram(v); setSelectedId(null) }}
        />

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search event, venue, or city"
              className="input"
              style={{ paddingLeft: '2.25rem' }}
            />
          </div>
          <button
            type="button"
            onClick={() => { locate(); setSortBy('distance') }}
            disabled={geo === 'locating'}
            title={geo === 'granted' ? 'Sorted by distance' : 'Use my location'}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
              geo === 'granted' ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-surface text-muted hover:text-foreground',
            )}
          >
            {geo === 'locating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
            <span className="hidden sm:inline">{geo === 'granted' ? 'Located' : 'Near me'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="When"
            size="sm"
            options={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
              { value: 'all', label: 'All' },
            ]}
            value={when}
            onChange={setWhen}
          />
          <Chip active={openOnly} onClick={() => setOpenOnly((v) => !v)}>Registration open</Chip>
          {userLoc && (
            <SegmentedControl
              label="Sort"
              size="sm"
              options={[
                { value: 'date', label: 'By date' },
                { value: 'distance', label: 'Nearest' },
              ]}
              value={sortBy}
              onChange={setSortBy}
            />
          )}
        </div>
        {geo === 'denied' && (
          <p className="text-xs text-muted-2">Location is off, so events can&apos;t be sorted by distance.</p>
        )}
      </div>

      {/* Map + legend */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-20 lg:self-start">
        <EventMap events={mapEvents} now={now} selectedId={selectedId} onSelect={open} userLoc={userLoc} />
        <EventLegend />
      </div>

      {/* Results list */}
      <div className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2">
        <p className="text-xs text-muted-2">
          {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          {when === 'upcoming' && ' upcoming'}
          {sortBy === 'distance' && userLoc ? ' · nearest first' : when !== 'past' ? ' · soonest first' : ''}
        </p>
        {filtered.map(({ event: e, km }) => (
          <EventCard
            key={e.id}
            event={e}
            now={now}
            selected={e.id === selectedId}
            onSelect={open}
            distance={km != null ? formatDistance(km, unit) : null}
          />
        ))}
        {filtered.length === 0 && (
          <p className="rounded-lg border border-border-subtle bg-surface p-6 text-center text-sm text-muted-2">
            {(programCounts[program] ?? 0) === 0
              ? `No ${PROGRAMS.find((p) => p.value === program)?.label ?? ''} events on the map yet.`
              : when === 'upcoming'
                ? `No upcoming ${PROGRAMS.find((p) => p.value === program)?.label ?? ''} events. Try Past or All.`
                : 'No events match these filters.'}
          </p>
        )}
        {when === 'upcoming' && upcomingCount === 0 && (programCounts[program] ?? 0) > 0 && (
          <p className="text-center text-xs text-muted-2">The season&apos;s events have all run. Switch to Past to see them.</p>
        )}
      </div>

      <EventDialog event={events.find((e) => e.id === openId) ?? null} now={now} onClose={() => setOpenId(null)} />
    </div>
  )
}

function dateKey(iso: string | null): number {
  return iso ? new Date(`${iso}T00:00:00`).getTime() : 0
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-surface-2 text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
