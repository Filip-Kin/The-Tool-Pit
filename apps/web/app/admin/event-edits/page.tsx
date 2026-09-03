import { desc, eq } from 'drizzle-orm'
import { UserRound } from 'lucide-react'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { eventListings, eventEditProposals, users } from '@the-tool-pit/db'
import type { EventListing, EventEditProposalData } from '@the-tool-pit/db'
import { EventEditActions } from './edit-proposal-actions'

export const dynamic = 'force-dynamic'

const KEY_LABELS: Record<keyof EventEditProposalData, string> = {
  name: 'Name',
  program: 'Program',
  hostTeamNumber: 'Host team',
  latitude: 'Latitude',
  longitude: 'Longitude',
  venueName: 'Venue',
  address: 'Address',
  city: 'City',
  region: 'State',
  country: 'Country',
  startDate: 'First day',
  endDate: 'Last day',
  days: 'Competition days',
  parallelDivisions: 'Two 1-day divisions',
  capacity: 'Capacity',
  costUsd: 'Cost (USD)',
  costNote: 'Cost note',
  registrationStatus: 'Registration',
  registrationOpensAt: 'Registration opens',
  registrationClosesAt: 'Registration closes',
  volunteerStatus: 'Volunteers',
  eventStatus: 'Event status',
  website: 'Website',
  registrationUrl: 'Sign-up link',
  volunteerUrl: 'Volunteer link',
  chiefDelphiUrl: 'Chief Delphi',
  contactEmail: 'Contact email',
  notes: 'Notes',
}

function fmt(v: unknown): string {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  if (v === null || v === undefined || v === '') return '-'
  return String(v)
}

/** Keys whose proposed value differs from the current listing. */
function changedKeys(listing: EventListing, proposed: EventEditProposalData): (keyof EventEditProposalData)[] {
  const current = listing as unknown as Record<string, unknown>
  return (Object.keys(KEY_LABELS) as (keyof EventEditProposalData)[]).filter((k) => {
    if (proposed[k] === undefined) return false
    return fmt(current[k]) !== fmt(proposed[k])
  })
}

export default async function EventEditsAdminPage() {
  await assertAdmin()
  const db = getDb()
  // The account is a LEFT join: suggesting an edit never requires signing in,
  // so most proposals have no user and must still be listed.
  const rows = await db
    .select({
      proposal: eventEditProposals,
      listing: eventListings,
      accountId: users.id,
      accountName: users.displayName,
      accountEmail: users.email,
    })
    .from(eventEditProposals)
    .innerJoin(eventListings, eq(eventEditProposals.eventListingId, eventListings.id))
    .leftJoin(users, eq(eventEditProposals.submittedByUserId, users.id))
    .where(eq(eventEditProposals.status, 'pending'))
    .orderBy(desc(eventEditProposals.createdAt))

  return (
    <div className="flex flex-col gap-4 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Suggested event edits</h1>
        <p className="mt-1 text-sm text-muted">
          {rows.length} waiting. Apply writes the change onto the live event and marks it yours, so a later refresh
          leaves it be. Reject leaves the event exactly as it reads now.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing waiting.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ proposal, listing, accountId, accountName, accountEmail }) => {
            const proposed = proposal.proposed as EventEditProposalData
            const changes = changedKeys(listing, proposed)
            const current = listing as unknown as Record<string, unknown>
            return (
              <div key={proposal.id} className="rounded-lg border border-border-subtle bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{listing.name}</div>
                    {proposal.note && <div className="mt-1 text-sm text-muted">“{proposal.note}”</div>}
                    {(proposal.submitterName || proposal.submitterContact) && (
                      <div className="mt-1 text-xs text-muted-2">
                        by {proposal.submitterName ?? 'anon'}
                        {proposal.submitterContact ? ` · ${proposal.submitterContact}` : ''}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-2">
                      <UserRound className="h-3 w-3" />
                      {accountId ? (
                        <span>
                          Account <span className="text-foreground">{accountName ?? accountEmail ?? accountId}</span>
                          {accountName && accountEmail ? ` · ${accountEmail}` : ''}
                        </span>
                      ) : (
                        <span>No account, anonymous edit</span>
                      )}
                    </div>
                  </div>
                  <EventEditActions proposalId={proposal.id} />
                </div>

                {changes.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-2">No actual changes from the current listing.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-2">
                          <th className="py-1 pr-4 font-medium">Field</th>
                          <th className="py-1 pr-4 font-medium">Current</th>
                          <th className="py-1 font-medium">Proposed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((k) => (
                          <tr key={k} className="border-t border-border-subtle align-top">
                            <td className="py-1.5 pr-4 text-muted-2">{KEY_LABELS[k]}</td>
                            <td className="py-1.5 pr-4 text-muted line-through decoration-muted-2/50">{fmt(current[k])}</td>
                            <td className="py-1.5 text-foreground">{fmt(proposed[k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
