import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { userTeams } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'
import { getFavoritesForUser } from '@/lib/queries/favorites'
import { MeShell } from '@/components/me/me-shell'
import { SavedSection, type SavedItem } from '@/components/me/saved-section'
import { GettingStarted } from '@/components/me/getting-started'
import { GrantMatchesStrip } from '@/components/me/grant-matches-strip'
import { TeamsSummary } from '@/components/me/teams-summary'
import { FIELDS_ORIGIN, GRANTS_ORIGIN, PHOTOS_ORIGIN } from '@/components/me/vertical-links'

export const metadata: Metadata = {
  title: 'Bookmarks',
  // Nothing here is public and every render is different, so keep it out of
  // search results entirely.
  robots: { index: false, follow: false },
}

// Per-user content. cookies() already opts this route out of the full route
// cache, but say so explicitly so nobody later adds a revalidate by accident.
export const dynamic = 'force-dynamic'

export default async function MePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const db = getDb()
  const [favorites, teams] = await Promise.all([
    getFavoritesForUser(user.id),
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
  ])

  // One pass, four buckets. Albums and events share a section: from the
  // visitor's point of view they are both "photos from an event", and splitting
  // them would leave two thin sections instead of one useful one.
  const items: SavedItem[] = favorites
  const tools = items.filter((f) => f.entityType === 'tool')
  const photos = items.filter((f) => f.entityType === 'album' || f.entityType === 'event')
  const fields = items.filter((f) => f.entityType === 'field')
  const grants = items.filter((f) => f.entityType === 'grant')

  const firstName = user.displayName?.trim().split(/\s+/)[0]

  return (
    <MeShell
      title={firstName ? `Welcome back, ${firstName}` : 'Your bookmarks'}
      intro="Everything you have saved across the tools directory, event photos, the practice field map and grants, in one place."
      active="saved"
    >
      <div className="flex flex-col gap-14">
        <GrantMatchesStrip userId={user.id} />

        {items.length === 0 ? (
          <GettingStarted />
        ) : (
          <>
            <SavedSection
              title="Tools"
              description="Calculators, apps and resources you have kept."
              items={tools}
              browseHref="/"
              browseLabel="Browse tools"
            />
            <SavedSection
              title="Photo albums"
              description="Events and albums you are following."
              items={photos}
              browseHref={PHOTOS_ORIGIN}
              browseLabel="Browse event photos"
            />
            <SavedSection
              title="Practice fields"
              description="Fields other teams are willing to share."
              items={fields}
              browseHref={FIELDS_ORIGIN}
              browseLabel="Open the field map"
            />
            <SavedSection
              title="Grants"
              description="Funding you are keeping an eye on. Check the deadline on the funder's own page before you rely on it."
              items={grants}
              browseHref={GRANTS_ORIGIN}
              browseLabel="Browse grants"
            />
          </>
        )}

        <TeamsSummary teams={teams} />
      </div>
    </MeShell>
  )
}
