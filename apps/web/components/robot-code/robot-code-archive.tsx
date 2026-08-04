'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils/cn'
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

  const filtered = useMemo(() => {
    const q = filter.trim()
    return q ? teams.filter((t) => String(t.teamNumber).includes(q)) : teams
  }, [teams, filter])

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

      {/* Program switch + team filter */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-surface p-0.5">
          {PROGRAMS.map((p) => (
            <button
              key={p.value}
              onClick={() => router.push(`/robot-code?program=${p.value}`)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                program === p.value ? 'bg-primary/15 text-primary' : 'text-muted hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          inputMode="numeric"
          placeholder="Filter team #"
          className="w-32 rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground placeholder:text-muted-2 focus:outline-none focus:border-primary"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="mb-1 text-sm font-medium text-foreground">No teams found</p>
          <p className="text-xs text-muted">
            {teams.length === 0
              ? `No ${program.toUpperCase()} code or CAD stored yet.`
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
                  <td className="px-4 py-2.5 align-top"><YearChips entries={t.code} /></td>
                  <td className="px-4 py-2.5 align-top"><YearChips entries={t.cad} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function YearChips({ entries }: { entries: RobotCodeEntry[] }) {
  if (entries.length === 0) return <span className="text-xs text-muted-2">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((e) => (
        <Link
          key={`${e.year ?? 'x'}-${e.slug}`}
          href={`/tools/${e.slug}`}
          className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs tabular-nums text-muted transition-colors hover:border-primary hover:text-primary"
        >
          {e.year ?? '?'}
        </Link>
      ))}
    </div>
  )
}
