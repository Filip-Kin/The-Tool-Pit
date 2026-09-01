import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { TeamProfileForm } from '@/components/me/team-profile-form'
import { ProfileMatchCost } from '@/components/me/profile-match-cost'
import { ProfileStarter } from '@/components/me/profile-starter'
import { programLabel } from '@/components/me/team-labels'
import { getMatchCostSummary, listClaimableTeams, listProfilesForUser } from './queries'
import { createTeamProfile, saveTeamProfile } from './actions'

export const metadata: Metadata = {
  title: 'Team profile',
  // Private by definition: an EIN, a mailing address and a named contact.
  robots: { index: false, follow: false },
}

// Per-user content, and it changes on every save. cookies() already opts this
// route out of the full route cache; saying so explicitly stops anyone adding a
// revalidate later and serving one team's EIN to another.
export const dynamic = 'force-dynamic'

export default async function TeamProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const params = await searchParams
  const profiles = await listProfilesForUser(user.id)

  if (profiles.length === 0) {
    const claimable = await listClaimableTeams(user.id)
    return (
      <MeShell
        title="Team profile"
        intro="The answers your team gives once and reuses on every application."
        active="profile"
      >
        <ProfileStarter teams={claimable} createAction={createTeamProfile} />
      </MeShell>
    )
  }

  // An unknown or missing ?p falls back to the first profile rather than
  // 404ing. The id is only ever a convenience for people on more than one team,
  // and access is already proved by the membership join in listProfilesForUser.
  const selected = profiles.find((p) => p.profile.id === params.p) ?? profiles[0]
  const cost = await getMatchCostSummary(selected.profile.id)

  // Flattened for the form, which marks the field the chip belongs to. The
  // matcher writes team_profiles column names into missingFields, which is the
  // same key the form uses, so no translation is needed here.
  const costByField: Record<string, number> = {}
  for (const c of cost.costs) costByField[c.field] = c.grantCount

  return (
    <MeShell
      title="Team profile"
      intro="The answers your team gives once and reuses on every application. It decides which grants you match, and it pre-fills the forms that accept it."
      active="profile"
    >
      <div className="flex flex-col gap-8">
        {profiles.length > 1 && (
          <nav className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Editing</span>
            {profiles.map((p) => {
              const active = p.profile.id === selected.profile.id
              return (
                <Link
                  key={p.profile.id}
                  href={`/me/team/profile?p=${p.profile.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-sm font-medium text-primary'
                      : 'rounded-full border border-border-subtle px-3 py-1 text-sm text-muted transition-colors hover:text-foreground'
                  }
                >
                  {programLabel(p.profile.program)} {p.profile.teamNumber}
                </Link>
              )
            })}
          </nav>
        )}

        <ProfileMatchCost
          costs={cost.costs}
          missingInfoCount={cost.missingInfoCount}
          actionableCount={cost.actionableCount}
          neverMatched={cost.neverMatched}
        />

        <TeamProfileForm
          profile={selected.profile}
          canEdit={selected.canEdit}
          costByField={costByField}
          saveAction={saveTeamProfile}
        />

        {/*
          Said plainly rather than buried in a tooltip. Somebody is about to
          type their team's tax number into a website.
        */}
        <p className="max-w-2xl text-sm text-muted-2">
          Your EIN, mailing address and contact details are readable only by the people with access to
          this profile. They never appear on a public page, in search, or in any listing. They are used to
          pre-fill an application only when you open that application yourself.
        </p>
      </div>
    </MeShell>
  )
}
