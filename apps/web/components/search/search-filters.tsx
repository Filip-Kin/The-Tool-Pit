'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
// The import-free subpaths, not the package barrel. This is a client
// component: reaching through '@the-tool-pit/db' pulls the postgres client into
// the browser bundle and the build refuses it, which is the same reason
// human-edited and the other enum modules are published this way.
import { AUDIENCE_PRIMARY_ROLES, AUDIENCE_FUNCTION_TERMS } from '@the-tool-pit/db/audience-enums'
import { TOOL_TYPES as SCHEMA_TOOL_TYPES, TOOL_TYPE_LABELS } from '@the-tool-pit/db/tool-enums'

interface SearchFiltersProps {
  program?: string
  toolType?: string
  isOfficial?: boolean
  isRookieFriendly?: boolean
  audienceRole?: string
  audienceFunction?: string
}

const PROGRAMS = [
  { value: 'frc', label: 'FRC', color: 'var(--color-frc)' },
  { value: 'ftc', label: 'FTC', color: 'var(--color-ftc)' },
  { value: 'fll', label: 'FLL', color: 'var(--color-fll)' },
]

/**
 * Types with no chip of their own, and why.
 *
 * The row is allowed to be shorter than the vocabulary. What it is not allowed
 * to be is short by accident: mobile_app, browser_extension and api were
 * missing along with these, and 29 published tools could not be filtered to at
 * all. Anything left out now has to be named here.
 */
const OMITTED_TOOL_TYPES: Record<string, string> = {
  other: 'a chip labelled Other filters to nothing anybody was looking for',
}

const TOOL_TYPES = SCHEMA_TOOL_TYPES.filter((t) => !(t in OMITTED_TOOL_TYPES)).map((t) => ({
  value: t,
  label: TOOL_TYPE_LABELS[t],
}))

// Read from the shared vocabulary, not typed out again.
//
// This row used to hold its own copy and it was four values short:
// event_ops, field_technical, inspection and judging were missing, so 46
// published tools carried a function no chip could select and 34 of them could
// not be reached by any "For:" chip at all. team_management also read "Team
// Mgmt" here and "Team Management" on every other screen.
const AUDIENCE_ROLES = AUDIENCE_PRIMARY_ROLES.map((t) => ({ value: t.slug, label: t.label }))
const AUDIENCE_FUNCTIONS = AUDIENCE_FUNCTION_TERMS.map((t) => ({ value: t.slug, label: t.label }))

export function SearchFilters({ program, toolType, isOfficial, isRookieFriendly, audienceRole, audienceFunction }: SearchFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete('page')
    router.push(`/search?${params.toString()}`)
  }

  function toggleBool(key: string, current: boolean) {
    updateFilter(key, current ? undefined : 'true')
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-x-visible">
      {/* Program filter */}
      {PROGRAMS.map((p) => (
        <FilterChip
          key={p.value}
          active={program === p.value}
          onClick={() => updateFilter('program', program === p.value ? undefined : p.value)}
          accentColor={p.color}
        >
          {p.label}
        </FilterChip>
      ))}

      <div className="h-4 w-px bg-border" />

      {/* Tool type filter */}
      {TOOL_TYPES.map((t) => (
        <FilterChip
          key={t.value}
          active={toolType === t.value}
          onClick={() => updateFilter('type', toolType === t.value ? undefined : t.value)}
        >
          {t.label}
        </FilterChip>
      ))}

      <div className="h-4 w-px bg-border" />

      <FilterChip active={!!isOfficial} onClick={() => toggleBool('official', !!isOfficial)}>
        FIRST Official
      </FilterChip>
      <FilterChip active={!!isRookieFriendly} onClick={() => toggleBool('rookie', !!isRookieFriendly)}>
        Rookie Friendly
      </FilterChip>

      <div className="h-4 w-px bg-border" />

      {/* Audience role filter */}
      <span className="text-xs text-muted-2">Role:</span>
      {AUDIENCE_ROLES.map((r) => (
        <FilterChip
          key={r.value}
          active={audienceRole === r.value}
          onClick={() => updateFilter('role', audienceRole === r.value ? undefined : r.value)}
        >
          {r.label}
        </FilterChip>
      ))}

      <div className="h-4 w-px bg-border" />

      {/* Audience function filter */}
      <span className="text-xs text-muted-2">For:</span>
      {AUDIENCE_FUNCTIONS.map((f) => (
        <FilterChip
          key={f.value}
          active={audienceFunction === f.value}
          onClick={() => updateFilter('fn', audienceFunction === f.value ? undefined : f.value)}
        >
          {f.label}
        </FilterChip>
      ))}

      <div className="h-4 w-px bg-border mx-1" />

      <Link
        href="/robot-code"
        className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-muted hover:border-border/80 hover:text-foreground transition-all"
      >
        Robot Code Archive ↗
      </Link>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
  accentColor,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accentColor?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border bg-surface text-muted hover:border-border/80 hover:text-foreground',
      )}
      style={accentColor ? ({ '--accent': accentColor } as React.CSSProperties) : undefined}
    >
      {children}
    </button>
  )
}
