'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { GRANT_EFFORT_LEVELS, GRANT_PROGRAMS } from '@the-tool-pit/db/grant-enums'
import type { GrantEffortLevel, GrantProgram } from '@the-tool-pit/db/grant-enums'
import type { GrantFilters, PublicGrant } from '@/lib/grants/grant-display'
import {
  AWARD_BANDS,
  DEADLINE_WINDOWS,
  EFFORT_SHORT_LABEL,
  PROGRAM_LABEL,
  countryLabel,
  matchesFilters,
  resolveNextCycle,
  sortByUrgency,
} from '@/lib/grants/grant-display'
import { GrantCard } from './grant-card'

/**
 * The grants listing: filters on the left, urgency-ordered cards on the right.
 *
 * Filtering and sorting call the SAME pure helpers the server used to build
 * this list (lib/grants/grant-display.ts), so a grant can never be visible in
 * one and hidden in the other.
 *
 * `now` comes from the server render. Everything dated here, the countdowns and
 * the open/closed split, is derived from that one instant, so the first client
 * render is byte-identical to the HTML and the page load cannot hydrate into a
 * different ordering than it painted.
 */
/**
 * Filters persist per browser. A Michigan team picking MI on every visit is
 * the kind of friction that makes a page feel unowned. Kept in localStorage
 * under a namespaced key (six verticals share this origin), restored AFTER
 * mount so the first client render still matches the server HTML, and the
 * search text is deliberately not kept: a stale query on arrival reads as a
 * broken page. An account-level copy can come later; the shape is the same.
 */
const FILTERS_KEY = 'frc.tools:grants:filters'
interface StoredFilters {
  filters: Omit<GrantFilters, 'q'>
  awardBand: string | null
  deadlineWindow: string | null
}
function readStoredFilters(): StoredFilters | null {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFilters>
    return { filters: parsed.filters ?? {}, awardBand: parsed.awardBand ?? null, deadlineWindow: parsed.deadlineWindow ?? null }
  } catch {
    return null
  }
}
function writeStoredFilters(value: StoredFilters): void {
  try {
    const { filters, awardBand, deadlineWindow } = value
    const empty = Object.values(filters).every((v) => v === undefined || (Array.isArray(v) && v.length === 0)) && !awardBand && !deadlineWindow
    if (empty) window.localStorage.removeItem(FILTERS_KEY)
    else window.localStorage.setItem(FILTERS_KEY, JSON.stringify(value))
  } catch {
    // Storage closed (private browsing, quota): the page still works, it just forgets.
  }
}

export function GrantsExplorer({ grants, now }: { grants: PublicGrant[]; now: Date }) {
  const [filters, setFilters] = useState<GrantFilters>({})
  const [awardBand, setAwardBand] = useState<string | null>(null)
  const [deadlineWindow, setDeadlineWindow] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  // Restore what this browser used last time, once, after mount.
  useEffect(() => {
    const stored = readStoredFilters()
    if (stored) {
      setFilters((f) => ({ ...stored.filters, q: f.q }))
      setAwardBand(stored.awardBand)
      setDeadlineWindow(stored.deadlineWindow)
    }
    setRestored(true)
  }, [])

  // Remember every change after that. Not before: writing the empty initial
  // state on mount would wipe the stored one before it was read.
  useEffect(() => {
    if (!restored) return
    const { q: _q, ...rest } = filters
    writeStoredFilters({ filters: rest, awardBand, deadlineWindow })
  }, [restored, filters, awardBand, deadlineWindow])

  // Facets come from the grants actually in the list, not from a fixed list of
  // every country and state. A filter for a place with no grants in it is a
  // dead end, and it hides how thin the coverage still is.
  const facets = useMemo(() => {
    const countries = new Set<string>()
    const regions = new Set<string>()
    const programs = new Set<GrantProgram>()
    const efforts = new Set<GrantEffortLevel>()
    for (const g of grants) {
      for (const c of g.countries) countries.add(c.toUpperCase())
      for (const r of g.regions) regions.add(r.toUpperCase())
      for (const p of g.programs) programs.add(p)
      efforts.add(g.effortLevel)
    }
    return {
      countries: [...countries].sort(),
      regions: [...regions].sort(),
      programs: GRANT_PROGRAMS.filter((p) => programs.has(p)),
      efforts: GRANT_EFFORT_LEVELS.filter((e) => efforts.has(e)),
    }
  }, [grants])

  const visible = useMemo(
    () => sortByUrgency(grants.filter((g) => matchesFilters(g, filters, now)), now),
    [grants, filters, now],
  )

  // Counted separately so the list can say how many closed grants it is still
  // showing, and so the "hide closed" toggle is honest about what it removes.
  const closedCount = useMemo(
    () => visible.filter((g) => resolveNextCycle(g, now).state === 'closed').length,
    [visible, now],
  )

  function toggleIn<T extends string>(list: T[] | undefined, value: T): T[] | undefined {
    const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value]
    return next.length > 0 ? next : undefined
  }

  // The bands are exclusive: picking one replaces the last, picking the active
  // one clears it. A multi-select here would let someone build "up to $1k and
  // $25k and up", which as a min/max pair is just the whole range.
  function pickAwardBand(key: string) {
    const band = AWARD_BANDS.find((b) => b.key === key)
    if (!band) return
    const clearing = awardBand === key
    setAwardBand(clearing ? null : key)
    setFilters((f) => ({
      ...f,
      awardMin: clearing ? undefined : band.min,
      awardMax: clearing ? undefined : (band.max ?? undefined),
    }))
  }

  function pickDeadlineWindow(key: string) {
    const win = DEADLINE_WINDOWS.find((w) => w.key === key)
    if (!win) return
    const clearing = deadlineWindow === key
    setDeadlineWindow(clearing ? null : key)
    setFilters((f) => ({ ...f, withinDays: clearing ? undefined : win.days }))
  }

  function clearAll() {
    setAwardBand(null)
    setDeadlineWindow(null)
    setFilters((f) => ({ q: f.q }))
  }

  const activeCount =
    (filters.programs?.length ?? 0) +
    (filters.countries?.length ?? 0) +
    (filters.regions?.length ?? 0) +
    (filters.effortLevels?.length ?? 0) +
    (awardBand ? 1 : 0) +
    (deadlineWindow ? 1 : 0) +
    (filters.rollingOnly ? 1 : 0) +
    (filters.hideClosed ? 1 : 0)

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-2" />
          <input
            value={filters.q ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search grant or funder"
            className="input"
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>

        <details className="rounded-lg border border-border-subtle bg-surface" open>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-foreground">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{activeCount}</span>
            )}
          </summary>
          <div className="flex flex-col gap-3 border-t border-border-subtle p-3">
            {facets.programs.length > 1 && (
              <FilterGroup label="Programme">
                {facets.programs.map((p) => (
                  <Chip
                    key={p}
                    active={!!filters.programs?.includes(p)}
                    onClick={() => setFilters((f) => ({ ...f, programs: toggleIn(f.programs, p) }))}
                  >
                    {PROGRAM_LABEL[p]}
                  </Chip>
                ))}
              </FilterGroup>
            )}

            {facets.countries.length > 1 && (
              <FilterGroup label="Country">
                {facets.countries.map((c) => (
                  <Chip
                    key={c}
                    active={!!filters.countries?.includes(c)}
                    onClick={() => setFilters((f) => ({ ...f, countries: toggleIn(f.countries, c) }))}
                  >
                    {countryLabel(c)}
                  </Chip>
                ))}
              </FilterGroup>
            )}

            {facets.regions.length > 0 && (
              <FilterGroup
                label="State or region"
                hint="National grants stay in the list: they have no region to match on."
              >
                {facets.regions.map((r) => (
                  <Chip
                    key={r}
                    active={!!filters.regions?.includes(r)}
                    onClick={() => setFilters((f) => ({ ...f, regions: toggleIn(f.regions, r) }))}
                  >
                    {r}
                  </Chip>
                ))}
              </FilterGroup>
            )}

            <FilterGroup label="Award size" hint="Matched on the top of each grant's range.">
              {AWARD_BANDS.map((b) => (
                <Chip key={b.key} active={awardBand === b.key} onClick={() => pickAwardBand(b.key)}>
                  {b.label}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Deadline">
              {DEADLINE_WINDOWS.map((w) => (
                <Chip key={w.key} active={deadlineWindow === w.key} onClick={() => pickDeadlineWindow(w.key)}>
                  {w.label}
                </Chip>
              ))}
              <Chip
                active={!!filters.rollingOnly}
                onClick={() => setFilters((f) => ({ ...f, rollingOnly: f.rollingOnly ? undefined : true }))}
              >
                Rolling only
              </Chip>
              <Chip
                active={!!filters.hideClosed}
                onClick={() => setFilters((f) => ({ ...f, hideClosed: f.hideClosed ? undefined : true }))}
              >
                Hide closed
              </Chip>
            </FilterGroup>

            {facets.efforts.length > 1 && (
              <FilterGroup label="Effort" hint="Roughly how big the application is.">
                {facets.efforts.map((e) => (
                  <Chip
                    key={e}
                    active={!!filters.effortLevels?.includes(e)}
                    onClick={() => setFilters((f) => ({ ...f, effortLevels: toggleIn(f.effortLevels, e) }))}
                  >
                    {EFFORT_SHORT_LABEL[e]}
                  </Chip>
                ))}
              </FilterGroup>
            )}

            {activeCount > 0 && (
              <button type="button" onClick={clearAll} className="self-start text-xs text-muted-2 hover:text-foreground">
                Clear filters
              </button>
            )}
          </div>
        </details>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs text-muted-2">
          {visible.length} {visible.length === 1 ? 'grant' : 'grants'}
          {visible.length !== grants.length && ` of ${grants.length}`}
          {' · soonest deadline first'}
          {closedCount > 0 && ` · ${closedCount} closed, kept so you can see when they reopen`}
        </p>

        {visible.map((g) => (
          <GrantCard key={g.id} grant={g} now={now} />
        ))}

        {visible.length === 0 && (
          <p className="rounded-lg border border-border-subtle bg-surface p-6 text-center text-sm text-muted-2">
            No grants match these filters. Clearing the deadline window is usually the one that hides the most.
          </p>
        )}
      </div>
    </div>
  )
}

function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-2">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
      {hint && <span className="text-[11px] text-muted-2">{hint}</span>}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-surface-2 text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
