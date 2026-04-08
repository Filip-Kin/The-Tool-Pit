'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SearchFiltersProps {
  program?: string
  toolType?: string
  isOfficial?: boolean
  isRookieFriendly?: boolean
}

const PROGRAMS = [
  { value: 'frc', label: 'FRC', color: 'var(--color-frc)' },
  { value: 'ftc', label: 'FTC', color: 'var(--color-ftc)' },
  { value: 'fll', label: 'FLL', color: 'var(--color-fll)' },
]

const TOOL_TYPES = [
  { value: 'web_app', label: 'Web App' },
  { value: 'calculator', label: 'Calculator' },
  { value: 'desktop_app', label: 'Desktop' },
  { value: 'github_project', label: 'GitHub Project' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'resource', label: 'Resource' },
]

export function SearchFilters({ program, toolType, isOfficial, isRookieFriendly }: SearchFiltersProps) {
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
    <div className="flex flex-wrap items-center gap-2">
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
