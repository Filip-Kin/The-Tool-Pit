import Link from 'next/link'
import { notFound } from 'next/navigation'
import { assertAdmin } from '@/lib/admin/auth'
import type { SubmitVertical } from '@/lib/listings/passing-along'
import { SubmitForm } from '@/components/submit/submit-form'
import { RobotCodeSubmitForm } from '@/components/robot-code/robot-code-submit-form'
import { AlbumSubmitForm } from '@/components/albums/album-submit-form'
import { FieldSubmitForm } from '@/components/fields/field-submit-form'
import { EventSubmitForm } from '@/components/events/event-submit-form'
import { GrantSubmitForm } from '@/components/grants/grant-submit-form'

export const dynamic = 'force-dynamic'

/**
 * Add anything, from the admin side.
 *
 * The public forms are the front door and stay the front door. This is the
 * side one, for what arrives by email, by DM, or off a site the connectors do
 * not sweep. Before it existed a moderator had to open the public form, solve
 * a bot check and then find their own submission in the queue, which is three
 * steps to write a row they were always allowed to write.
 *
 * ONE PAGE FOR ALL SIX, keyed by the same SubmitVertical the API route and the
 * passing-along default are keyed by. Six near-identical pages scattered
 * across admin directories that are not one-per-vertical (robot code has no
 * directory of its own; tools and robot code share a queue) is how the
 * seventh one ends up somewhere nobody looks.
 *
 * Each vertical renders ITS OWN public form in admin mode rather than a
 * separate admin form, so a field added for teams shows up here too instead of
 * this page quietly falling a season behind.
 */

interface VerticalPage {
  title: string
  /** What this page is for, in the admin's terms. */
  blurb: string
  /** Where the thing goes once it is in, so the reader knows where to look next. */
  back: { href: string; label: string }
  form: React.ReactNode
}

const PAGES: Record<SubmitVertical, VerticalPage> = {
  event: {
    title: 'Add an event',
    blurb:
      'It is filed as an admin entry rather than a public submission, and it goes on the map as soon as it clears the publish bar: a pin, a start date, a venue, a program and a registration state.',
    back: { href: '/admin/event-listings', label: 'Off-season events' },
    form: <EventSubmitForm admin />,
  },
  field: {
    title: 'Add a practice field',
    blurb:
      'It is filed as an admin entry rather than a public submission, and it goes on the map as soon as it clears the publish bar: a pin, and at least one way to get in touch.',
    back: { href: '/admin/practice-fields', label: 'Practice fields' },
    form: <FieldSubmitForm admin />,
  },
  tool: {
    title: 'Add a tool',
    blurb:
      'The pipeline reads the page and fills in the rest, so this files it and the Candidates queue is where it turns into a listing. It cannot be published from here for that reason.',
    back: { href: '/admin/candidates', label: 'Tool candidates' },
    form: <SubmitForm admin />,
  },
  robot_code: {
    title: 'Add robot code or CAD',
    blurb:
      'Robot code shares the tools pipeline, which reads the repository before there is anything to publish, so this files it and the Candidates queue picks it up.',
    back: { href: '/admin/submissions', label: 'Submissions' },
    form: <RobotCodeSubmitForm admin />,
  },
  album: {
    title: 'Add an album',
    blurb:
      'The enrich job matches it to its event and fetches a cover first, so this files it and Album candidates is where it is matched and published.',
    back: { href: '/admin/album-candidates', label: 'Album candidates' },
    form: <AlbumSubmitForm admin />,
  },
  grant: {
    title: 'Add a grant',
    blurb:
      'It lands as a candidate, which is where the amount, the deadline and the eligibility get filled in and verified before it is published.',
    back: { href: '/admin/grants/candidates', label: 'Grant candidates' },
    form: <GrantSubmitForm admin />,
  },
}

export default async function AdminNewListingPage({
  params,
}: {
  params: Promise<{ vertical: string }>
}) {
  await assertAdmin()
  const { vertical } = await params
  const page = (PAGES as Record<string, VerticalPage | undefined>)[vertical]
  if (!page) notFound()

  return (
    <div className="p-4 md:p-6">
      <Link href={page.back.href} className="text-sm text-muted hover:text-foreground">
        ← {page.back.label}
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-foreground">{page.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">{page.blurb}</p>

      <div className="mt-5 max-w-3xl">{page.form}</div>
    </div>
  )
}
