import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { userTeams } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { TeamManager } from '@/components/me/team-manager'
import { addTeam, removeTeam } from './actions'

export const metadata: Metadata = {
  title: 'My teams',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function MyTeamsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const db = getDb()
  const teams = await db
    .select({
      id: userTeams.id,
      program: userTeams.program,
      teamNumber: userTeams.teamNumber,
      role: userTeams.role,
    })
    .from(userTeams)
    .where(eq(userTeams.userId, user.id))
    .orderBy(asc(userTeams.program), asc(userTeams.teamNumber))

  return (
    <MeShell
      title="My teams"
      intro="Tell us which teams you are on and the rest of the site can work out what is relevant to you: grants your team qualifies for, events it attended, practice fields near it."
      active="team"
    >
      <div className="flex flex-col gap-10">
        <TeamManager teams={teams} addAction={addTeam} removeAction={removeTeam} />

        {/*
          Said plainly rather than buried in a tooltip. Someone typing a team
          number wants to know whether they are claiming authority over it.
        */}
        <p className="max-w-2xl text-sm text-muted-2">
          Team membership is self-asserted. We do not check it against The Blue Alliance and it gives you
          no control over the team&apos;s listings, photos or fields. It only changes what you see on your
          own pages, so put down the teams you actually want to hear about.
        </p>
      </div>
    </MeShell>
  )
}
