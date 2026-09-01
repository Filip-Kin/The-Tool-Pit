import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { userTeams } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { TeamManager, type TeamCard } from '@/components/me/team-manager'
import { TeamProfileForm } from '@/components/me/team-profile-form'
import { ProfileMatchCost } from '@/components/me/profile-match-cost'
import { addTeam, removeTeam } from './actions'
import { createTeamProfile, saveTeamProfile } from './profile/actions'
import { getMatchCostSummary, listClaimableTeams, listProfilesForUser } from './profile/queries'

export const metadata: Metadata = {
  title: 'Teams',
  // The expanded profile carries an EIN, a mailing address and a named
  // contact, so this route is private by definition.
  robots: { index: false, follow: false },
}

// Per-user, and it changes on every autosave. cookies() already opts this route
// out of the full route cache; saying so explicitly stops anyone adding a
// revalidate later and serving one team's EIN to another.
export const dynamic = 'force-dynamic'

/** program and number identify a team; the number alone collides across programmes. */
function teamKey(program: string, teamNumber: number): string {
  return `${program}:${teamNumber}`
}

/**
 * Teams and their grant profiles, on one screen.
 *
 * There used to be two tabs for one idea. The split existed because the DATA is
 * split, and it still is: accounts.userTeams is a self-asserted claim, and
 * team_profile_members is real membership. That distinction survives here
 * untouched, it is just no longer a navigation problem for the user.
 *
 * The two lists are read from their own sources and only JOINED FOR DISPLAY, on
 * (program, teamNumber), to decide which claim and which membership are the
 * same card. Every profile object on this page comes out of
 * listProfilesForUser, which is gated on a team_profile_members row. A claim
 * never resolves to a profile and never gains its data: matching a claim to a
 * profile id and then reading it is exactly the bug that would show one team
 * another team's private answers. The only thing a claim alone learns about a
 * profile is `takenByOthers`, a boolean about a team the user already named.
 */
export default async function MyTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const params = await searchParams
  const db = getDb()

  const [claims, profiles, claimable] = await Promise.all([
    db
      .select({
        id: userTeams.id,
        program: userTeams.program,
        teamNumber: userTeams.teamNumber,
        role: userTeams.role,
      })
      .from(userTeams)
      .where(eq(userTeams.userId, user.id))
      .orderBy(asc(userTeams.program), asc(userTeams.teamNumber)),
    listProfilesForUser(user.id),
    listClaimableTeams(user.id),
  ])

  const profileByKey = new Map(profiles.map((p) => [teamKey(p.profile.program, p.profile.teamNumber), p]))
  const takenByOthers = new Set(
    claimable.filter((c) => c.takenByOthers).map((c) => teamKey(c.program, c.teamNumber)),
  )

  const cards: TeamCard[] = claims.map((claim) => {
    const key = teamKey(claim.program, claim.teamNumber)
    const mine = profileByKey.get(key)
    return {
      key,
      program: claim.program,
      teamNumber: claim.teamNumber,
      claimId: claim.id,
      role: claim.role,
      profileId: mine?.profile.id ?? null,
      canEdit: mine?.canEdit ?? false,
      takenByOthers: takenByOthers.has(key),
    }
  })

  // A membership with no claim behind it. Removing a claim does not remove you
  // from a profile, so the row has to keep appearing or the profile would be
  // unreachable. Membership is the real permission, so it wins.
  const claimedKeys = new Set(cards.map((c) => c.key))
  for (const p of profiles) {
    const key = teamKey(p.profile.program, p.profile.teamNumber)
    if (claimedKeys.has(key)) continue
    cards.push({
      key,
      program: p.profile.program,
      teamNumber: p.profile.teamNumber,
      claimId: null,
      role: null,
      profileId: p.profile.id,
      canEdit: p.canEdit,
      takenByOthers: false,
    })
  }
  cards.sort((a, b) => a.program.localeCompare(b.program) || a.teamNumber - b.teamNumber)

  // ?p picks the open profile. One profile opens by itself, because collapsing
  // a list of one is a click that buys nothing. With more than one, nothing
  // opens until asked, which is also what makes Close reachable.
  const asked = params.p && profiles.some((p) => p.profile.id === params.p) ? params.p : null
  const openId = asked ?? (profiles.length === 1 ? profiles[0]!.profile.id : null)
  const open = openId ? profiles.find((p) => p.profile.id === openId) : undefined

  let openNode: React.ReactNode = null
  if (open) {
    const cost = await getMatchCostSummary(open.profile.id)
    // Flattened for the form, which marks the field each chip belongs to. The
    // matcher writes team_profiles column names into missingFields, the same
    // key the form uses, so no translation is needed here.
    const costByField: Record<string, number> = {}
    for (const c of cost.costs) costByField[c.field] = c.grantCount

    openNode = (
      <div className="flex flex-col gap-6">
        <ProfileMatchCost
          costs={cost.costs}
          missingInfoCount={cost.missingInfoCount}
          actionableCount={cost.actionableCount}
          neverMatched={cost.neverMatched}
        />

        <TeamProfileForm
          profile={open.profile}
          canEdit={open.canEdit}
          costByField={costByField}
          saveAction={saveTeamProfile}
        />

        {/* Somebody is about to type their team's tax number into a website. */}
        <p className="max-w-2xl text-sm text-muted-2">
          EIN, mailing address and contact details are readable only by this profile&apos;s members. They
          never appear on a public page, in search or in a listing.
        </p>
      </div>
    )
  }

  return (
    <MeShell title="Teams" active="team">
      <TeamManager
        cards={cards}
        openProfileId={open ? open.profile.id : null}
        collapsible={profiles.length > 1}
        addAction={addTeam}
        removeAction={removeTeam}
        createProfileAction={createTeamProfile}
      >
        {openNode}
      </TeamManager>
    </MeShell>
  )
}
