/**
 * The audience vocabulary. Zero imports, on purpose.
 *
 * The search filter row is a client component, so anything it reads must be
 * reachable without dragging the postgres client into the browser bundle. That
 * is why field-enums, grant-enums and event-enums already exist as their own
 * subpaths, and this follows them.
 *
 * These were written out by hand in six places: this file's comments, the
 * seed, the classifier's validator, the classifier's prompt, the admin tool
 * editor and the public search filter row. They disagreed. The filter row was
 * missing event_ops, field_technical, inspection and judging entirely, so 46
 * published tools carried a function no chip could select and 34 of them were
 * reachable by no "For:" chip at all. team_management was also labelled "Team
 * Mgmt" there and "Team Management" everywhere else, which is the same drift
 * showing up as a typo.
 *
 * The label lives here beside the slug because every screen that shows a slug
 * needs a label, and a second table of labels is how "Team Mgmt" happened.
 */

export interface AudienceTerm {
  slug: string
  label: string
}

export const AUDIENCE_PRIMARY_ROLES: readonly AudienceTerm[] = [
  { slug: 'student', label: 'Student' },
  { slug: 'mentor', label: 'Mentor' },
  { slug: 'volunteer', label: 'Volunteer' },
  { slug: 'parent_newcomer', label: 'Parent / Newcomer' },
  { slug: 'organizer_staff', label: 'Organizer / Staff' },
] as const

export const AUDIENCE_FUNCTION_TERMS: readonly AudienceTerm[] = [
  { slug: 'programmer', label: 'Programmer' },
  { slug: 'scouter', label: 'Scouter' },
  { slug: 'strategist', label: 'Strategist' },
  { slug: 'cad', label: 'CAD' },
  { slug: 'mechanical', label: 'Mechanical' },
  { slug: 'electrical', label: 'Electrical' },
  { slug: 'drive_team', label: 'Drive Team' },
  { slug: 'awards', label: 'Awards' },
  { slug: 'outreach', label: 'Outreach' },
  { slug: 'team_management', label: 'Team Management' },
  { slug: 'event_ops', label: 'Event Ops' },
  { slug: 'field_technical', label: 'Field Technical' },
  { slug: 'inspection', label: 'Inspection' },
  { slug: 'judging', label: 'Judging' },
] as const

/** Slug to label, for a screen that holds a slug and has to print it. */
export const AUDIENCE_LABELS: Record<string, string> = Object.fromEntries(
  [...AUDIENCE_PRIMARY_ROLES, ...AUDIENCE_FUNCTION_TERMS].map((t) => [t.slug, t.label]),
)
