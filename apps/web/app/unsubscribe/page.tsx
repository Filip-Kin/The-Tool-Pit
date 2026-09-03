import type { Metadata } from 'next'
import Link from 'next/link'
import { verifyUnsubscribe } from '@the-tool-pit/db'
import { confirmUnsubscribe } from './actions'

/**
 * The universal, no-login unsubscribe every email footer links to.
 *
 * Public and accountless: the recipient may be a scraped public contact with no
 * frc.tools account, so nothing here sits behind sign-in. The signed token in
 * the URL is the whole authorisation, checked on both the GET that renders this
 * page and the POST that suppresses. A GET never changes anything: it only ever
 * shows the confirm step, so a link preview or an over-eager corporate mail
 * scanner cannot unsubscribe somebody by fetching the URL. The suppress waits
 * for the button.
 */

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-16">
      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <div className="mb-4 text-lg font-bold tracking-tight">
          <span className="text-foreground">FRC</span>
          <span className="text-primary">.tools</span>
        </div>
        {children}
      </div>
    </main>
  )
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string; done?: string; error?: string }>
}) {
  const { email, token, done, error } = await searchParams

  // A bad or missing token lands here. One vague message on purpose: a guessed
  // link learns nothing.
  if (error || !email || !verifyUnsubscribe(email, token)) {
    return (
      <Card>
        <h1 className="text-base font-semibold text-foreground">This link is not valid</h1>
        <p className="mt-2 text-sm text-muted">
          The unsubscribe link is incomplete or does not match this address. Reply to the email we sent you and we
          will stop it by hand.
        </p>
      </Card>
    )
  }

  if (done) {
    return (
      <Card>
        <h1 className="text-base font-semibold text-foreground">Unsubscribed</h1>
        <p className="mt-2 text-sm text-muted">
          We will not send any more email to <span className="font-medium text-foreground">{email}</span>. If you
          have a frc.tools account and change your mind, you can turn emails back on from your{' '}
          <Link href="/me/notifications" className="text-primary hover:underline">
            notification settings
          </Link>
          .
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <h1 className="text-base font-semibold text-foreground">Unsubscribe from all email?</h1>
      <p className="mt-2 text-sm text-muted">
        This stops every email frc.tools sends to <span className="font-medium text-foreground">{email}</span>:
        listing updates, claims, invitations and grant alerts. You can undo it from your notification settings if
        you have an account.
      </p>
      <form action={confirmUnsubscribe} className="mt-5 flex flex-wrap items-center gap-3">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="rounded-md bg-frc px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Unsubscribe from everything
        </button>
        <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
          Keep my emails
        </Link>
      </form>
    </Card>
  )
}
