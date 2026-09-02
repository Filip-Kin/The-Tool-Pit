/**
 * Comparing a candidate's reading against the listing it might be attached to.
 *
 * Attach used to be silent: it linked the candidate to the listing as evidence
 * and touched nothing else, which is right when the listing is already
 * correct and the candidate adds nothing. It is the wrong default when the
 * candidate found something the listing does not have, or something newer:
 * Wolverine's listing says capacity 40 with a blank cost note, and its own
 * candidate read capacity 32 off the current thread. Silently keeping the
 * listing's 40 throws away a correction nobody would have seen; silently
 * taking the candidate's 32 overwrites a number an organiser may have typed in
 * on purpose. Neither default is safe, so a person is shown both and picks.
 */
import { HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db'
import type { ExtractedEventListingFields } from '@the-tool-pit/db'

export interface EventMergeField {
  key: string
  label: string
  existing: string | number | boolean | null
  detected: string | number | boolean | null
  /** False when the two agree, or the candidate has nothing to offer. */
  differs: boolean
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  venueName: 'Venue',
  address: 'Address',
  city: 'City',
  region: 'State',
  country: 'Country',
  startDate: 'First day',
  endDate: 'Last day',
  days: 'Competition days',
  capacity: 'Capacity',
  costUsd: 'Cost (USD)',
  costNote: 'Cost note',
  registrationStatus: 'Registration',
  volunteerStatus: 'Volunteers',
  website: 'Website',
  registrationUrl: 'Sign-up link',
  volunteerUrl: 'Volunteer link',
  teamListUrl: 'Team list page',
  contactEmail: 'Contact email',
  notes: 'Notes',
  tbaKey: 'TBA key',
  latitude: 'Latitude',
  longitude: 'Longitude',
}

/** The subset of HUMAN_EDITABLE_EVENT_KEYS a candidate can plausibly fill. */
const COMPARABLE_KEYS = Object.keys(FIELD_LABELS).filter((k) =>
  (HUMAN_EDITABLE_EVENT_KEYS as readonly string[]).includes(k),
)

function normalise(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return String(v).trim()
}

/**
 * Loose equality for the diff, not for storage. "USA" and "US", or a URL with
 * and without a trailing slash, are the same fact spelled two ways, and
 * flagging them as a disagreement would train a reviewer to stop reading the
 * list. The stored value is untouched either way; this only decides whether a
 * field needs a decision.
 */
function sameFact(a: string | number | boolean | null, b: string | number | boolean | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a === 'string' && typeof b === 'string') {
    const bare = (s: string) => s.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\//, '')
    if (bare(a) === bare(b)) return true
    if ((a === 'US' && b === 'USA') || (a === 'USA' && b === 'US')) return true
  }
  return false
}

export function diffEventFields(
  listing: Record<string, unknown>,
  extracted: ExtractedEventListingFields,
): EventMergeField[] {
  const rows: EventMergeField[] = []
  for (const key of COMPARABLE_KEYS) {
    const existing = normalise(listing[key])
    const detected = normalise((extracted as Record<string, unknown>)[key])
    if (detected === null) continue // nothing to offer for this field
    rows.push({ key, label: FIELD_LABELS[key], existing, detected, differs: !sameFact(existing, detected) })
  }
  // Disagreements and fill-ins first, since those are the only rows worth a
  // reviewer's attention; the rest is just confirmation.
  rows.sort((a, b) => Number(b.differs) - Number(a.differs))
  return rows
}
