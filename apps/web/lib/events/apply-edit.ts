import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, eventEditProposals } from '@the-tool-pit/db'
import type { EventEditProposalData } from '@the-tool-pit/db'
import { addHumanEdits, changedKeys, HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db/human-edited'

/** The proposed fields that carry a value, as a patch for the listing. */
function patchFromProposal(p: EventEditProposalData): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const keys: (keyof EventEditProposalData)[] = [
    'name', 'program', 'hostTeamNumber', 'latitude', 'longitude', 'venueName', 'address', 'city',
    'region', 'country', 'startDate', 'endDate', 'days', 'parallelDivisions', 'capacity', 'costUsd',
    'costNote', 'registrationStatus', 'registrationOpensAt', 'registrationClosesAt', 'volunteerStatus', 'eventStatus',
    'website', 'registrationUrl', 'volunteerUrl', 'chiefDelphiUrl', 'contactEmail', 'notes',
  ]
  for (const k of keys) if (p[k] !== undefined) patch[k] = p[k]
  return patch
}

/**
 * Apply a suggested edit to its event, then mark it applied.
 *
 * One body for the admin Apply button and for an admin's own suggestion.
 *
 * The applied fields are CLAIMED on the listing, the same as an admin typing
 * them into the edit form: an accepted suggestion is a human's decision, so a
 * later automated pass, a roster or TBA refresh, must not put the old value
 * back. That is the whole reason event_listings carries human_edited_fields.
 *
 * event_edit_proposals has no reviewer column, so who applied it is not
 * recorded on the row; the listing's updatedAt moves and that is all.
 */
export async function applyEventEditProposal(proposalId: string): Promise<{ error?: string }> {
  const db = getDb()
  const [proposal] = await db
    .select()
    .from(eventEditProposals)
    .where(eq(eventEditProposals.id, proposalId))
    .limit(1)
  if (!proposal) return { error: 'Proposal not found.' }
  if (proposal.status !== 'pending') return { error: 'This proposal was already handled.' }

  const p = proposal.proposed as EventEditProposalData
  if (!p.name || !p.name.trim()) return { error: 'The proposed name is empty.' }

  const patch = patchFromProposal(p)

  const [before] = await db
    .select()
    .from(eventListings)
    .where(eq(eventListings.id, proposal.eventListingId))
    .limit(1)
  if (!before) return { error: 'The event this edit belongs to is gone.' }

  const claimed = changedKeys(patch, before as unknown as Record<string, unknown>, HUMAN_EDITABLE_EVENT_KEYS)
  const humanEditedFields = addHumanEdits(before.humanEditedFields, claimed)

  await db
    .update(eventListings)
    .set({ ...patch, ...(humanEditedFields ? { humanEditedFields } : {}), updatedAt: new Date() })
    .where(eq(eventListings.id, proposal.eventListingId))

  await db
    .update(eventEditProposals)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(eq(eventEditProposals.id, proposalId))

  return {}
}
