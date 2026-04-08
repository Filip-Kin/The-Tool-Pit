'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils/cn'

const PROGRAMS = [
  { value: 'frc', label: 'FRC' },
  { value: 'ftc', label: 'FTC' },
  { value: 'fll', label: 'FLL' },
]

interface RobotCodeFiltersProps {
  program?: string
  seasonYear?: number
  teamNumber?: number
  availableYears: number[]
}

export function RobotCodeFilters({ program, seasonYear, teamNumber, availableYears }: RobotCodeFiltersProps) {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function buildUrl(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const current: Record<string, string | undefined> = {
      program,
      year: seasonYear ? String(seasonYear) : undefined,
      team: teamNumber ? String(teamNumber) : undefined,
      ...updates,
    }
    for (const [k, v] of Object.entries(current)) {
      if (v) params.set(k, v)
    }
    params.delete('page')
    return `/robot-code?${params.toString()}`
  }

  function toggleProgram(value: string) {
    router.push(buildUrl({ program: program === value ? undefined : value }))
  }

  function handleYearChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(buildUrl({ year: e.target.value || undefined }))
  }

  function handleTeamChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      router.push(buildUrl({ team: val || undefined }))
    }, 400)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PROGRAMS.map((p) => (
        <button
          key={p.value}
          onClick={() => toggleProgram(p.value)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all',
            program === p.value
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-surface text-muted hover:border-border/80 hover:text-foreground',
          )}
        >
          {p.label}
        </button>
      ))}

      <div className="h-4 w-px bg-border" />

      <select
        defaultValue={seasonYear ? String(seasonYear) : ''}
        onChange={handleYearChange}
        className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted focus:outline-none focus:border-primary"
      >
        <option value="">All Seasons</option>
        {availableYears.map((y) => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>

      <input
        type="number"
        min="1"
        max="99999"
        defaultValue={teamNumber ?? ''}
        placeholder="Team #"
        onChange={handleTeamChange}
        className="w-24 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted placeholder:text-muted-2 focus:outline-none focus:border-primary"
      />
    </div>
  )
}
