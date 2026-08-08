import { desc, eq, asc, inArray } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { practiceFields, fieldEditProposals, fieldPhotos, fieldEditProposalPhotos } from '@the-tool-pit/db'
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

  // Existing photos for the involved fields (to show which are being removed),
  // and the pending photos each proposal wants to add.
  const fieldIds = [...new Set(rows.map((r) => r.field.id))]
  const proposalIds = rows.map((r) => r.proposal.id)
  const existingPhotos = fieldIds.length
    ? await db
        .select({ id: fieldPhotos.id, fieldId: fieldPhotos.fieldId })
        .from(fieldPhotos)
        .where(inArray(fieldPhotos.fieldId, fieldIds))
        .orderBy(asc(fieldPhotos.sortOrder), asc(fieldPhotos.createdAt))
    : []
  const pendingPhotos = proposalIds.length
    ? await db
        .select({ id: fieldEditProposalPhotos.id, proposalId: fieldEditProposalPhotos.proposalId })
        .from(fieldEditProposalPhotos)
        .where(inArray(fieldEditProposalPhotos.proposalId, proposalIds))
        .orderBy(asc(fieldEditProposalPhotos.createdAt))
    : []
  const existingByField = new Map<string, string[]>()
  for (const p of existingPhotos) existingByField.set(p.fieldId, [...(existingByField.get(p.fieldId) ?? []), p.id])
  const pendingByProposal = new Map<string, string[]>()
  for (const p of pendingPhotos) pendingByProposal.set(p.proposalId, [...(pendingByProposal.get(p.proposalId) ?? []), p.id])

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-semibold text-foreground">Field Edit Proposals</h1>
      <p className="mt-1 text-sm text-muted">Community-suggested edits. Review the changes and apply or reject.</p>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted-2">No pending edits.</p>}
        {rows.map(({ proposal, field }) => {
          const proposed = proposal.proposed as FieldEditProposalData
          const changes = changedKeys(field, proposed)
          const current = field as unknown as Record<string, unknown>
          const removeIds = (proposal.removePhotoIds ?? []) as string[]
          const existingIds = existingByField.get(field.id) ?? []
          const addIds = pendingByProposal.get(proposal.id) ?? []
          const hasPhotoChanges = removeIds.length > 0 || addIds.length > 0
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

              {changes.length === 0 && !hasPhotoChanges ? (
                <p className="mt-3 text-xs text-muted-2">No actual changes from the current listing.</p>
              ) : (
                changes.length > 0 && (
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
                )
              )}

              {hasPhotoChanges && (
                <div className="mt-3 flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-2">Photos</span>
                  <div className="flex flex-wrap gap-2">
                    {existingIds
                      .filter((id) => removeIds.includes(id))
                      .map((id) => (
                        <div key={id} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/fields/photo/${id}`} alt="" className="h-20 w-24 rounded-md border border-border object-cover opacity-40 grayscale" />
                          <span className="absolute inset-x-1 bottom-1 rounded bg-frc/80 py-0.5 text-center text-[10px] font-medium text-white">Removing</span>
                        </div>
                      ))}
                    {addIds.map((id) => (
                      <div key={id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/fields/proposal-photo/${id}`} alt="" className="h-20 w-24 rounded-md border border-rookie/60 object-cover" />
                        <span className="absolute inset-x-1 bottom-1 rounded bg-rookie/80 py-0.5 text-center text-[10px] font-medium text-white">Adding</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
