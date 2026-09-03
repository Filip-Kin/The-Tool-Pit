'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, eventEditProposals } from '@the-tool-pit/db'
import type { EventEditProposalData } from '@the-tool-pit/db'
import { addHumanEdits, changedKeys, HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db/human-edited'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/event-edits')
  revalidatePath('/events')
}

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
 * The applied fields are CLAIMED on the listing, the same as an admin typing
 * them into the edit form: an accepted suggestion is a human's decision, so a
 * later automated pass, a roster or TBA refresh, must not put the old value
 * back. That is the whole reason event_listings carries human_edited_fields.
 */
export async function applyEventEdit(proposalId: string): Promise<{ error?: string }> {
  await assertAdmin()
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

  revalidateAll()
  return {}
}

/**
 * Do not apply a suggested edit.
 *
 * Never a takedown: the event stays live exactly as it reads now. The reason is
 * required and is the record of why, the same as everywhere else.
 */
export async function rejectEventEdit(proposalId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const db = getDb()
  await db
    .update(eventEditProposals)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventEditProposals.id, proposalId))
  revalidatePath('/admin/event-edits')
  return {}
}
