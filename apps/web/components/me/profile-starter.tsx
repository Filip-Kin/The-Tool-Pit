'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { programLabel } from './team-labels'

/**
 * Starting a team profile.
 *
 * Only teams the user has already claimed on /me/team are offered. Claiming is
 * self-asserted and free, but it is a deliberate act recorded against the
 * account, and it keeps this from being a box anyone can type any number into.
 *
 * A team whose profile someone else already created is shown and disabled
 * rather than hidden. Hiding it would look like a bug to the person who knows
 * their team is on here; saying "someone already set this up" tells them what
 * to do next, which is ask that person. There is no invite flow yet, so this is
 * an honest dead end rather than a silent one.
 */

export interface StarterTeam {
  program: string
  teamNumber: number
  takenByOthers: boolean
}

export function ProfileStarter({
  teams,
  createAction,
}: {
  teams: StarterTeam[]
  createAction: (formData: FormData) => Promise<{ error?: string; profileId?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onCreate(team: StarterTeam) {
    setError(null)
    const data = new FormData()
    data.set('program', team.program)
    data.set('teamNumber', String(team.teamNumber))
    start(async () => {
      const res = await createAction(data)
      if (res.error) {
        setError(res.error)
        return
      }
      // Land straight on the new profile rather than a list of one.
      router.replace(res.profileId ? `/me/team/profile?p=${res.profileId}` : '/me/team/profile')
      router.refresh()
    })
  }

  if (teams.length === 0) {
    return (
      <section className="rounded-lg border border-border-subtle bg-surface p-4 sm:p-5">
        <h2 className="font-semibold text-foreground">Add your team first</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A grant profile belongs to a team, not to an account. Tell us which team you are on and you can
          set its profile up here.
        </p>
        <Link
          href="/me/team"
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Add a team
        </Link>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4 sm:p-5">
      <h2 className="font-semibold text-foreground">Set up a team profile</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Fill this in once and it does two jobs: it decides which grants you are eligible for, and it
        pre-fills the application forms that accept it. Everything in it stays private to the people you
        give access to.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {teams.map((team) => (
          <li
            key={`${team.program}:${team.teamNumber}`}
            className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2"
          >
            <span className="w-16 text-lg font-semibold tabular-nums text-foreground">{team.teamNumber}</span>
            <Badge variant="program">{programLabel(team.program)}</Badge>
            {team.takenByOthers ? (
              <span className="ml-auto max-w-md text-right text-xs text-muted-2">
                Someone on this team has already set up its profile. Ask them to add you, since it holds
                details we will not hand out on a team number alone.
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onCreate(team)}
                disabled={pending}
                className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {pending ? 'Working…' : 'Start profile'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {error}
        </p>
      )}
    </section>
  )
}
