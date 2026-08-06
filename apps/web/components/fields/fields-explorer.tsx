'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Search, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PublicField } from '@/lib/fields/field-display'
import { COVERAGE_LABEL, ELEMENTS_LABEL, AVAILABILITY_LABEL } from '@/lib/fields/field-display'
import type { FieldCoverage, FieldElements, FieldAvailability } from '@the-tool-pit/db'
import { FieldCard } from './field-card'
import { FieldLegend } from './field-legend'

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
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return fields.filter((f) => {
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
  }, [fields, filters])

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
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      {/* Left: search, filters, list */}
      <div className="flex flex-col gap-3">
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

        <p className="text-xs text-muted-2">
          {filtered.length} {filtered.length === 1 ? 'field' : 'fields'}
          {filtered.length !== fields.length && ` of ${fields.length}`}
        </p>

        <div className="flex flex-col gap-2 lg:max-h-[520px] lg:overflow-auto lg:pr-1">
          {filtered.map((f) => (
            <FieldCard key={f.id} field={f} selected={f.id === selectedId} onSelect={setSelectedId} />
          ))}
          {filtered.length === 0 && (
            <p className="rounded-lg border border-border-subtle bg-surface p-6 text-center text-sm text-muted-2">
              No fields match these filters yet.
            </p>
          )}
        </div>
      </div>

      {/* Right: map + legend (sticky on desktop) */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
        <FieldMap fields={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        <FieldLegend />
      </div>
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
