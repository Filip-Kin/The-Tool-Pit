/**
 * The field-by-field diff of an event edit proposal, shared by the admin review
 * dashboard and the moderator Discord/notification ping so both describe a
 * suggestion the same way: not just the submitter's note, but every field whose
 * proposed value differs from the listing as it stands.
 */
import type { EventListing, EventEditProposalData } from '@the-tool-pit/db'

export const EVENT_EDIT_KEY_LABELS: Record<keyof EventEditProposalData, string> = {
  name: 'Name',
  program: 'Program',
  hostTeamNumber: 'Host team',
  hostTeamNumbers: 'Host teams',
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

/** A human-readable cell value. Empty and unset both read as a dash. */
export function fmtEditValue(v: unknown): string {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  if (v === null || v === undefined || v === '') return '-'
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : '-'
  return String(v)
}

export interface EventFieldChange {
  key: keyof EventEditProposalData
  label: string
  from: string
  to: string
}

/**
 * Every field whose proposed value differs from the current listing. A key the
 * proposal did not carry (undefined) is not a change; a key it cleared is.
 */
export function eventEditChanges(
  listing: EventListing | Record<string, unknown>,
  proposed: EventEditProposalData,
): EventFieldChange[] {
  const current = listing as unknown as Record<string, unknown>
  const keys = Object.keys(EVENT_EDIT_KEY_LABELS) as (keyof EventEditProposalData)[]
  const out: EventFieldChange[] = []
  for (const key of keys) {
    if (proposed[key] === undefined) continue
    const from = fmtEditValue(current[key])
    const to = fmtEditValue(proposed[key])
    if (from !== to) out.push({ key, label: EVENT_EDIT_KEY_LABELS[key], from, to })
  }
  return out
}
