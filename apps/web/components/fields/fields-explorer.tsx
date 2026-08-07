'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Search, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PublicField } from '@/lib/fields/field-display'
import { COVERAGE_LABEL, ELEMENTS_LABEL, AVAILABILITY_LABEL } from '@/lib/fields/field-display'
import type { FieldCoverage, FieldElements, FieldAvailability, FieldProgram } from '@the-tool-pit/db'
import { FieldCard } from './field-card'
import { FieldLegend } from './field-legend'
import { FieldDialog } from './field-dialog'

// FRC first and foremost: it's the default program; FTC/FLL are secondary tabs.
const PROGRAMS: { key: FieldProgram; label: string }[] = [
  { key: 'frc', label: 'FRC' },
  { key: 'ftc', label: 'FTC' },
  { key: 'fll', label: 'FLL' },
]

// The map only runs in the browser (Leaflet touches window), so load it client-only.
const FieldMap = dynamic(() => import('./field-map').then((m) => m.FieldMap), {
  ssr: false,
  loading: () => <div className="h-[560px] rounded-lg border border-border bg-surface" />,
})

const COVERAGES: FieldCoverage[] = ['full', 'half']
const ELEMENTS: FieldElements[] = ['official', 'wood']
const AVAILABILITIES: FieldAvailability[] = ['year_round', 'in_season']

interface Filters {
  q: string
  coverage: Set<FieldCoverage>
  elements: Set<FieldElements>
  availability: Set<FieldAvailability>
  fmsOnly: boolean
}

const EMPTY: Filters = {
  q: '',
  coverage: new Set(),
  elements: new Set(),
  availability: new Set(),
  fmsOnly: false,
}

export function FieldsExplorer({ fields }: { fields: PublicField[] }) {
  const [program, setProgram] = useState<FieldProgram>('frc')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // Clicking a card or pin: highlight it and open its detail dialog.
  function open(id: string) {
    setSelectedId(id)
    setOpenId(id)
  }

  // Count fields per program so the tabs can show what's available.
  const programCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of fields) counts[f.program] = (counts[f.program] ?? 0) + 1
    return counts
  }, [fields])

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return fields.filter((f) => {
      if (f.program !== program) return false
      if (q) {
        const hay = [f.name, f.teamName, f.city, f.region, f.teamNumber?.toString()].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.coverage.size && !filters.coverage.has(f.coverage)) return false
      if (filters.elements.size && !filters.elements.has(f.elements)) return false
      if (filters.availability.size && !filters.availability.has(f.availability)) return false
      if (filters.fmsOnly && !f.hasFms) return false
      return true
    })
  }, [fields, filters, program])

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const activeCount =
    filters.coverage.size +
    filters.elements.size +
    filters.availability.size +
    (filters.fmsOnly ? 1 : 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:items-start">
      {/* Controls: program switcher, search, filters. DOM order puts the map
          above the list on mobile; grid placement restores the two-column
          layout (controls + list on the left, map on the right) on desktop. */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
        <div className="inline-flex max-w-full self-start overflow-x-auto rounded-lg border border-border bg-surface p-0.5">
          {PROGRAMS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setProgram(p.key); setSelectedId(null) }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                p.key === program ? 'bg-primary text-white' : 'text-muted hover:text-foreground',
              )}
            >
              {p.label}
              {programCounts[p.key] ? <span className={cn('ml-1.5 text-xs', p.key === program ? 'text-white/70' : 'text-muted-2')}>{programCounts[p.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-2" />
          <input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search team, field, or city"
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
            <FilterGroup label="Coverage">
              {COVERAGES.map((c) => (
                <Chip key={c} active={filters.coverage.has(c)} onClick={() => setFilters((f) => ({ ...f, coverage: toggle(f.coverage, c) }))}>
                  {COVERAGE_LABEL[c]}
                </Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Game elements">
              {ELEMENTS.map((e) => (
                <Chip key={e} active={filters.elements.has(e)} onClick={() => setFilters((f) => ({ ...f, elements: toggle(f.elements, e) }))}>
                  {ELEMENTS_LABEL[e]}
                </Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Availability">
              {AVAILABILITIES.map((a) => (
                <Chip key={a} active={filters.availability.has(a)} onClick={() => setFilters((f) => ({ ...f, availability: toggle(f.availability, a) }))}>
                  {AVAILABILITY_LABEL[a]}
                </Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Extras">
              <Chip active={filters.fmsOnly} onClick={() => setFilters((f) => ({ ...f, fmsOnly: !f.fmsOnly }))}>Has FMS</Chip>
            </FilterGroup>
            {activeCount > 0 && (
              <button type="button" onClick={() => setFilters((f) => ({ ...EMPTY, q: f.q }))} className="self-start text-xs text-muted-2 hover:text-foreground">
                Clear filters
              </button>
            )}
          </div>
        </details>
      </div>

      {/* Map + legend. On mobile it renders right after the controls (above the
          list); on desktop it sits in the right column, spanning both rows and
          sticking as the list scrolls. */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-20 lg:self-start">
        <FieldMap fields={filtered} selectedId={selectedId} onSelect={open} />
        <FieldLegend />
      </div>

      {/* Results list */}
      <div className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2 lg:max-h-[520px] lg:overflow-auto lg:pr-1">
        <p className="text-xs text-muted-2">
          {filtered.length} {filtered.length === 1 ? 'field' : 'fields'}
          {filtered.length !== (programCounts[program] ?? 0) && ` of ${programCounts[program] ?? 0}`}
        </p>
        {filtered.map((f) => (
          <FieldCard key={f.id} field={f} selected={f.id === selectedId} onSelect={open} />
        ))}
        {filtered.length === 0 && (
          <p className="rounded-lg border border-border-subtle bg-surface p-6 text-center text-sm text-muted-2">
            {(programCounts[program] ?? 0) === 0
              ? `No ${PROGRAMS.find((p) => p.key === program)?.label ?? ''} fields on the map yet.`
              : 'No fields match these filters yet.'}
          </p>
        )}
      </div>

      <FieldDialog field={fields.find((f) => f.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-2">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
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
