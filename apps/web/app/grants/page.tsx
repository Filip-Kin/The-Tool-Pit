import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { listGrants } from '@/lib/queries/grants'
import { GrantsExplorer } from '@/components/grants/grants-explorer'

export const metadata: Metadata = {
  title: { absolute: 'Grants for FIRST teams' },
}

// Publishing a grant, or a human confirming a moved deadline, has to show up on
// the next hard refresh. A cached listing here would be a stale deadline.
export const dynamic = 'force-dynamic'

export default async function GrantsHomePage() {
  // One instant for the whole render, handed to the client explorer so its
  // first paint matches this HTML exactly. See GrantsExplorer.
  const now = new Date()
  const grants = await listGrants({}, now)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Grants for FIRST teams</h1>
        <p className="text-sm text-muted">
          Funding your team can apply for. Every deadline is checked against the funder&apos;s own page
          before it appears, and each listing shows when.{' '}
          <Link href="/grants/submit" className="text-primary hover:underline">
            Add one we are missing
          </Link>
        </p>
      </div>

      {grants.length === 0 ? <EmptyState /> : <GrantsExplorer grants={grants} now={now} />}
    </div>
  )
}

/**
 * The launch state, and it will be the state for a while.
 *
 * This page opens with nothing published on purpose: crawling found plenty of
 * pages, and none of them go live until a person has read the funder's own page
 * and confirmed the dates. That is worth saying out loud, because an empty
 * directory with no explanation reads as broken and costs the submissions that
 * fill it.
 */
function EmptyState() {
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-surface p-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Nothing published yet</h2>
        <p className="text-sm text-muted">
          Still filling up. Nothing appears until a person has confirmed it, because a wrong deadline
          costs a team an entire application cycle.
        </p>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-2" aria-hidden />
          <span>
            When listings do appear, each one shows its award range, who is eligible, every application window
            we know of including past ones, and the date a person last checked it. Dates carried over from a
            previous year are always marked as expected.
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/grants/submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Submit a grant you know of
        </Link>
        <span className="text-sm text-muted-2">
          No account needed. Tell us the page and we will do the checking.
        </span>
      </div>
    </div>
  )
}
