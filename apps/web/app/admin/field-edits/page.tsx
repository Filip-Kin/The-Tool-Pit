import { desc, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { practiceFields, fieldEditProposals } from '@the-tool-pit/db'
import type { PracticeField, FieldEditProposalData } from '@the-tool-pit/db'
import { EditProposalActions } from './edit-proposal-actions'

export const dynamic = 'force-dynamic'

const KEY_LABELS: Record<keyof FieldEditProposalData, string> = {
  name: 'Name',
  teamNumber: 'Team #',
  teamName: 'Team name',
  program: 'Program',
  latitude: 'Latitude',
  longitude: 'Longitude',
  address: 'Address',
  city: 'City',
  region: 'Region',
  country: 'Country',
  coverage: 'Coverage',
  perimeter: 'Perimeter',
  elements: 'Elements',
  hasFms: 'FMS',
  ceilingHeightFt: 'Ceiling (ft)',
  availability: 'Availability',
  hours: 'Days / hours',
  contactInfo: 'Access info',
  contactUrl: 'Sign-up link',
  website: 'Website',
  notes: 'Notes',
}

function fmt(v: unknown): string {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

/** Keys whose proposed value differs from the current field. */
function changedKeys(field: PracticeField, proposed: FieldEditProposalData): (keyof FieldEditProposalData)[] {
  const current = field as unknown as Record<string, unknown>
  return (Object.keys(KEY_LABELS) as (keyof FieldEditProposalData)[]).filter((k) => {
    if (proposed[k] === undefined) return false
    return fmt(current[k]) !== fmt(proposed[k])
  })
}

export default async function FieldEditsAdminPage() {
  await assertAdmin()
  const db = getDb()
  const rows = await db
    .select({ proposal: fieldEditProposals, field: practiceFields })
    .from(fieldEditProposals)
    .innerJoin(practiceFields, eq(fieldEditProposals.fieldId, practiceFields.id))
    .where(eq(fieldEditProposals.status, 'pending'))
    .orderBy(desc(fieldEditProposals.createdAt))

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground">Field Edit Proposals</h1>
      <p className="mt-1 text-sm text-muted">Community-suggested edits. Review the changes and apply or reject.</p>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted-2">No pending edits.</p>}
        {rows.map(({ proposal, field }) => {
          const proposed = proposal.proposed as FieldEditProposalData
          const changes = changedKeys(field, proposed)
          const current = field as unknown as Record<string, unknown>
          return (
            <div key={proposal.id} className="rounded-lg border border-border-subtle bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">{field.name}</div>
                  {proposal.note && <div className="mt-1 text-sm text-muted">“{proposal.note}”</div>}
                  {(proposal.submitterName || proposal.submitterContact) && (
                    <div className="mt-1 text-xs text-muted-2">
                      by {proposal.submitterName ?? 'anon'}
                      {proposal.submitterContact ? ` · ${proposal.submitterContact}` : ''}
                    </div>
                  )}
                </div>
                <EditProposalActions proposalId={proposal.id} />
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
    </div>
  )
}
