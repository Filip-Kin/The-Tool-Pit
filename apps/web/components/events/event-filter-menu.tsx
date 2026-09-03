'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { DateField } from '@/components/ui/date-field'
import type { DistanceUnit } from '@/lib/events/event-display'
import { NO_FILTERS, activeFilterCount, type EventFilters } from '@/lib/events/event-filters'

/**
 * The five-way filter menu on the off-season map: distance, cost, team number,
 * second robots, and dates.
 *
 * A MENU AND NOT FIVE MORE CONTROLS IN THE COLUMN. The explorer's left column
 * already carries the program tabs, a search box, the location button, the
 * timing tabs, a registration chip and a sort control, and the map has to stay
 * on screen beside them. Five more always-visible controls would push the
 * results list below the fold on a laptop. So these live behind one button that
 * carries a count when any of them are on, and every active filter also shows
 * as a chip under the button, which is the pattern a reader already knows from
 * a shopping or travel site: the panel is where you set them, the chips are how
 * you see and undo them without opening anything.
 *
 * DISTANCE IS TYPED, COST IS STEPPED. A team knows its own driving limit and
 * will type it, and rounding that to the nearest preset would answer a question
 * nobody asked. A budget is vaguer, so the cost slider over round numbers is
 * quicker than inventing a figure.
 */

// Distance is stored in km whatever the reader's unit, and converts on the way
// in and out, so nobody types a figure and sees it come back as "161".
const KM_PER_MILE = 1.609344

const COST_STEPS = [0, 100, 150, 200, 250, 300, 400, 500, 750, 1000] as const

/** A figure typed in the reader's unit, as kilometres. */
function toKm(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * KM_PER_MILE : value
}

/** Stored kilometres, back in the reader's unit. Integers round-trip exactly. */
function fromKm(km: number, unit: DistanceUnit): number {
  return Math.round(unit === 'mi' ? km / KM_PER_MILE : km)
}

export function distanceFilterLabel(km: number, unit: DistanceUnit): string {
  return `Within ${fromKm(km, unit)} ${unit}`
}

export function costFilterLabel(usd: number): string {
  return usd === 0 ? 'Free entry' : `Up to $${usd.toLocaleString()}`
}

/** "Sep 12 – Oct 31", one end open when only one is set. */
export function dateFilterLabel(from: string, to: string): string {
  const f = from ? shortDate(from) : null
  const t = to ? shortDate(to) : null
  if (f && t) return `${f} – ${t}`
  if (f) return `From ${f}`
  return `Until ${t ?? ''}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  return `${MONTHS[(m ?? 1) - 1]} ${d}`
}

/** One labelled block inside the panel. */
function Section({
  label,
  value,
  children,
  hint,
}: {
  label: string
  /** The current setting, shown on the right of the heading the way a slider readout is. */
  value?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">{label}</span>
        {value && <span className="text-xs font-medium text-foreground">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-2">{hint}</p>}
    </div>
  )
}

/**
 * A range input over an array of round values, where the position one past the
 * end means "no limit". Putting "Any" at the far right keeps the slider reading
 * left-to-right as loosest-to-tightest in one direction only.
 */
function StepSlider({
  id,
  count,
  index,
  onChange,
  label,
}: {
  id: string
  /** How many real steps. The slider runs 0..count, where `count` is "Any". */
  count: number
  index: number
  onChange: (index: number) => void
  label: string
}) {
  return (
    <input
      id={id}
      type="range"
      min={0}
      max={count}
      step={1}
      value={index}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-primary"
    />
  )
}

export function EventFilterMenu({
  filters,
  onChange,
  unit,
  hasLocation,
  counts,
  rosterLoading,
  totalShown,
}: {
  filters: EventFilters
  onChange: (next: EventFilters) => void
  unit: DistanceUnit
  /** False until the reader shares a location; the distance filter needs one. */
  hasLocation: boolean
  /** Events the other controls allow that a given filter cannot judge. */
  counts: { noCost: number; noRoster: number; noDates: number }
  /** True while the roster index for the team filter is being fetched. */
  rosterLoading: boolean
  /** Events on screen, for the "N of M" line at the foot of the panel. */
  totalShown: number
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const ids = useId()
  const active = activeFilterCount(filters)

  // Close on an outside click or Escape, matching DateField.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function set<K extends keyof EventFilters>(key: K, value: EventFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  const cIndex = filters.maxCostUsd == null ? COST_STEPS.length : COST_STEPS.indexOf(filters.maxCostUsd as never)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
          active > 0 || open
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-border bg-surface text-muted hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
        {active > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-white">
            {active}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter events"
          className="absolute left-0 top-full z-[500] mt-1.5 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 rounded-lg border border-border-strong bg-surface-2 p-3.5 shadow-lg"
        >
          <Section
            label="Distance"
            hint={
              hasLocation
                ? 'How far you are willing to drive. Leave it blank for any distance.'
                : 'Turn on Near me first. Without your location nothing can be measured against a distance.'
            }
          >
            <div className="relative">
              <input
                id={`${ids}-distance`}
                type="number"
                min={1}
                max={20_000}
                inputMode="numeric"
                disabled={!hasLocation}
                aria-label={`Maximum distance in ${unit}`}
                value={filters.maxDistanceKm == null ? '' : fromKm(filters.maxDistanceKm, unit)}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  // A blank box, a zero or a negative all mean "no limit"
                  // rather than "within nothing", which would empty the map.
                  set('maxDistanceKm', Number.isFinite(n) && n > 0 ? toKm(n, unit) : null)
                }}
                placeholder="Any"
                className="input"
                style={{ paddingRight: '2.5rem' }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-2">
                {unit}
              </span>
            </div>
          </Section>

          <Section
            label="Cost per team"
            value={filters.maxCostUsd == null ? 'Any' : costFilterLabel(filters.maxCostUsd)}
            hint={
              filters.maxCostUsd != null && counts.noCost > 0
                ? `${counts.noCost} ${counts.noCost === 1 ? 'event does' : 'events do'} not list a price, so they are hidden while this is set.`
                : undefined
            }
          >
            <StepSlider
              id={`${ids}-cost`}
              label="Maximum cost per team"
              count={COST_STEPS.length}
              index={cIndex === -1 ? COST_STEPS.length : cIndex}
              onChange={(i) => set('maxCostUsd', i === COST_STEPS.length ? null : COST_STEPS[i])}
            />
          </Section>

          <Section
            label="Team number"
            hint={
              rosterLoading
                ? 'Loading team lists.'
                : filters.teamNumber != null && counts.noRoster > 0
                  ? `${counts.noRoster} ${counts.noRoster === 1 ? 'event has' : 'events have'} no published team list, so they are hidden while this is set.`
                  : 'Keeps events whose published team list includes this team.'
            }
          >
            <div className="relative">
              <input
                type="number"
                min={1}
                max={99_999}
                inputMode="numeric"
                value={filters.teamNumber ?? ''}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  set('teamNumber', Number.isFinite(n) && n > 0 ? n : null)
                }}
                placeholder="e.g. 4145"
                className="input"
              />
              {rosterLoading && (
                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-2" />
              )}
            </div>
          </Section>

          <Section
            label="Dates"
            hint={
              (filters.from || filters.to) && counts.noDates > 0
                ? `${counts.noDates} ${counts.noDates === 1 ? 'event has' : 'events have'} no dates yet, so they are hidden while this is set.`
                : undefined
            }
          >
            <div className="flex items-center gap-2">
              <DateField
                value={filters.from}
                onChange={(iso) => set('from', iso)}
                placeholder="From"
                className="min-w-0 flex-1"
              />
              <DateField
                value={filters.to}
                onChange={(iso) => set('to', iso)}
                placeholder="To"
                className="min-w-0 flex-1"
              />
            </div>
          </Section>

          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
            <span className="text-xs text-muted-2">
              {totalShown} {totalShown === 1 ? 'event' : 'events'} shown
            </span>
            <button
              type="button"
              onClick={() => onChange(NO_FILTERS)}
              disabled={active === 0}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The active filters, as chips that remove themselves.
 *
 * The panel is closed most of the time, so without these a reader who set a
 * $200 cap five minutes ago has no way to see that an empty map is their own
 * doing. Each chip names its filter in the same words the panel used.
 */
export function ActiveFilterChips({
  filters,
  onChange,
  unit,
}: {
  filters: EventFilters
  onChange: (next: EventFilters) => void
  unit: DistanceUnit
}) {
  const chips: { key: string; label: string; clear: Partial<EventFilters> }[] = []

  if (filters.maxDistanceKm != null) {
    chips.push({
      key: 'distance',
      label: distanceFilterLabel(filters.maxDistanceKm, unit),
      clear: { maxDistanceKm: null },
    })
  }
  if (filters.maxCostUsd != null) {
    chips.push({ key: 'cost', label: costFilterLabel(filters.maxCostUsd), clear: { maxCostUsd: null } })
  }
  if (filters.teamNumber != null) {
    chips.push({ key: 'team', label: `Team ${filters.teamNumber}`, clear: { teamNumber: null } })
  }
  if (filters.from || filters.to) {
    chips.push({
      key: 'dates',
      label: dateFilterLabel(filters.from, filters.to),
      clear: { from: '', to: '' },
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange({ ...filters, ...chip.clear })}
          className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/25"
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden />
          <span className="sr-only">Remove this filter</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="px-1 text-[11px] font-medium text-muted-2 transition-colors hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
