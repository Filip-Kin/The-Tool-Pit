'use client'

import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { RobotCodeProgram, RobotCodeTeam, RobotCodeEntry } from '@/lib/queries/robot-code'

const PROGRAMS: { value: RobotCodeProgram; label: string }[] = [
  { value: 'frc', label: 'FRC' },
  { value: 'ftc', label: 'FTC' },
  { value: 'fll', label: 'FLL' },
]

interface Props {
  teams: RobotCodeTeam[]
  program: RobotCodeProgram
}

export function RobotCodeArchive({ teams, program }: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [year, setYear] = useState<number | null>(null)

  // Every season present in this program, newest first. Built from the rows we
  // already have rather than a second query, so the list can never offer a year
  // that filters to nothing.
  const years = useMemo(() => {
    const set = new Set<number>()
    for (const t of teams) {
      for (const e of [...t.code, ...t.cad]) if (e.year !== null) set.add(e.year)
    }
    return [...set].sort((a, b) => b - a)
  }, [teams])

  const filtered = useMemo(() => {
    const q = filter.trim()
    return teams.filter((t) => {
      if (q && !String(t.teamNumber).includes(q)) return false
      if (year !== null && ![...t.code, ...t.cad].some((e) => e.year === year)) return false
      return true
    })
  }, [teams, filter, year])

  const codeCount = useMemo(() => teams.reduce((n, t) => n + t.code.length, 0), [teams])
  const cadCount = useMemo(() => teams.reduce((n, t) => n + t.cad.length, 0), [teams])

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10">
      {/* Hero */}
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">Robot Code / CAD</h1>
        <p className="text-sm text-muted">
          {teams.length.toLocaleString()} {program.toUpperCase()} teams · {codeCount.toLocaleString()} code · {cadCount.toLocaleString()} CAD
        </p>
      </div>

      {/* One control row: program, team, season, then the call to action. Every
          box in it is 2.375rem tall (the `.input` height, which the segmented
          control matches), because the old row mixed pill buttons, a pill input
          and a third radius and read as three unrelated things. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Program"
          options={PROGRAMS}
          value={program}
          onChange={(value) => router.push(`/robot-code?program=${value}`)}
        />

        <div className="w-28">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            inputMode="numeric"
            placeholder="Team #"
            aria-label="Filter by team number"
            className="input"
          />
        </div>

        {/* A dropdown, not twenty chips: seasons only grow, and three wrapped
            rows of them drowned the two controls people actually reach for. */}
        {years.length > 0 && (
          <div className="w-32">
            <select
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Season"
              className="input"
            >
              <option value="">All seasons</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Submit lives on this page because someone looking for their team's
            code and not finding it is exactly the person who can add it. */}
        <ButtonLink href="/robot-code/submit" size="sm" className="ml-auto">
          Add your team&apos;s code or CAD
        </ButtonLink>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="mb-1 text-sm font-medium text-foreground">No teams found</p>
          <p className="text-xs text-muted">
            {teams.length === 0
              ? `No ${program.toUpperCase()} code or CAD stored yet.`
              : year !== null && filter.trim()
                ? `No team matching that number has anything from ${year}.`
                : year !== null
                  ? `No ${program.toUpperCase()} team has code or CAD from ${year}.`
                  : 'No team matches that number.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Team</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">CAD</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.teamNumber} className="border-b border-border-subtle last:border-0 hover:bg-surface/50">
                  <td className="px-4 py-2.5 align-top font-medium tabular-nums text-foreground">{t.teamNumber}</td>
                  <td className="px-4 py-2.5 align-top"><YearChips entries={t.code} highlight={year} /></td>
                  <td className="px-4 py-2.5 align-top"><YearChips entries={t.cad} highlight={year} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function YearChips({ entries, highlight }: { entries: RobotCodeEntry[]; highlight: number | null }) {
  if (entries.length === 0) return <span className="text-xs text-muted-2">none</span>
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((e) => {
        // With a season selected the row is still the whole team, so the chip
        // that matched is marked rather than the others being hidden.
        const isMatch = highlight !== null && e.year === highlight
        return (
          <Link
            key={`${e.year ?? 'x'}-${e.slug}`}
            href={`/tools/${e.slug}`}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-xs tabular-nums transition-colors hover:border-primary hover:text-primary',
              isMatch
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface text-muted',
            )}
          >
            {e.year ?? '?'}
          </Link>
        )
      })}
    </div>
  )
}
