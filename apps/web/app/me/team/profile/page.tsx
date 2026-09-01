import { redirect } from 'next/navigation'

/**
 * The team profile used to be its own tab. It is now a card on /me/team.
 *
 * A redirect rather than a deletion because this path is linked from the grants
 * vertical and from anyone's bookmarks, and a 404 on a page that held their
 * EIN reads as "you lost my data". ?p is carried through so a link to one
 * specific profile still opens that profile.
 */
export const dynamic = 'force-dynamic'

export default async function TeamProfileRedirect({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  redirect(p ? `/me/team?p=${encodeURIComponent(p)}` : '/me/team')
}
