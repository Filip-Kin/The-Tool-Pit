import Link from 'next/link'
import { Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { programLabel, roleLabel } from './team-labels'

export interface TeamRow {
  id: string
  program: string
  teamNumber: number
  role: string
}

/**
 * The user's teams, read-only. Editing lives on /me/team so this page stays a
 * dashboard. Renders a one-line prompt instead of an empty card when there are
 * no teams, because the teams are what make grant matching work.
 */
export function TeamsSummary({ teams }: { teams: TeamRow[] }) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Your teams</h2>
          <p className="text-sm text-muted">
            Used to pick out the grants and events that are actually relevant to you.
          </p>
        </div>
        <Link href="/me/team" className="shrink-0 text-sm text-primary transition-colors hover:text-primary-hover">
          {teams.length === 0 ? 'Add a team' : 'Manage teams'}
        </Link>
      </div>

      {teams.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-2" />
          <p className="text-sm text-muted">
            No teams yet.{' '}
            <Link href="/me/team" className="text-primary hover:underline">
              Add your team number
            </Link>{' '}
            and we can point out grants your team qualifies for and events it attended.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4"
            >
              <span className="text-lg font-semibold tabular-nums text-foreground">{t.teamNumber}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="program">{programLabel(t.program)}</Badge>
                <Badge variant="muted">{roleLabel(t.role)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
