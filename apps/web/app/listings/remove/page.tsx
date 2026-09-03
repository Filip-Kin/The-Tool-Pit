import type { Metadata } from 'next'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings } from '@the-tool-pit/db'
import { eventListingUrl } from '@the-tool-pit/types'
import { verifyOutreachRemove } from '@/lib/listings/outreach-token'
import { confirmOutreachRemoval } from './actions'

/**
 * The one-click "take this listing down" page an outreach email links to.
 *
 * Public and accountless: the recipient is a scraped event contact with no
 * frc.tools account, so nothing here sits behind sign-in. The signed token in
 * the URL is the whole authorisation, checked on both the GET that renders this
 * page and the POST that suppresses. A GET never changes anything: it only ever
 * shows the confirm step, so a link preview or an over-eager scanner cannot pull
 * a listing off the map. The suppress waits for the button.
 */

export const metadata: Metadata = {
  title: 'Remove listing',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-16">
      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <div className="mb-4 text-lg font-bold tracking-tight text-primary">frc.tools</div>
        {children}
      </div>
    </main>
  )
}

export default async function RemoveListingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string; token?: string; done?: string; error?: string }>
}) {
  const { type, id, token, done, error } = await searchParams

  // A bad or missing token, a non-event target, or an id that no longer exists
  // all land here. One vague message on purpose: a guessed link learns nothing
  // about what does or does not exist.
  if (error || type !== 'event' || !id || !verifyOutreachRemove('event', id, token)) {
    return (
      <Card>
        <h1 className="text-base font-semibold text-foreground">This link is not valid</h1>
        <p className="mt-2 text-sm text-muted">
          The remove link is expired or incomplete. Reply to the email we sent you and we will take the listing
          down by hand.
        </p>
      </Card>
    )
  }

  const db = getDb()
  const [row] = await db
    .select({ id: eventListings.id, name: eventListings.name, status: eventListings.status })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)

  if (!row) {
    return (
      <Card>
        <h1 className="text-base font-semibold text-foreground">This link is not valid</h1>
        <p className="mt-2 text-sm text-muted">
          That listing is no longer here. Nothing more to do.
        </p>
      </Card>
    )
  }

  // Already gone, either because they just confirmed or because it was taken
  // down earlier. Same reassuring end state either way.
  if (done || row.status === 'suppressed') {
    return (
      <Card>
        <h1 className="text-base font-semibold text-foreground">Removed</h1>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-foreground">{row.name}</span> is no longer listed on frc.tools. If this was a
          mistake, reply to the email we sent you and we will put it back.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <h1 className="text-base font-semibold text-foreground">Remove this listing?</h1>
      <p className="mt-2 text-sm text-muted">
        This takes <span className="font-medium text-foreground">{row.name}</span> off the frc.tools off-season events map
        and list. Teams will no longer find it here. You can ask us to put it back at any time by replying to the
        email.
      </p>
      <form action={confirmOutreachRemoval} className="mt-5 flex flex-wrap items-center gap-3">
        <input type="hidden" name="type" value="event" />
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="rounded-md bg-frc px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Remove this listing
        </button>
        <Link href={eventListingUrl(row.id)} className="text-sm font-medium text-muted hover:text-foreground">
          Keep it listed
        </Link>
      </form>
    </Card>
  )
}
