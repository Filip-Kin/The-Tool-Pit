import type { ListingEntityType } from '@the-tool-pit/db'
import { EVENT_PROGRAMS, EVENT_STATUSES, REGISTRATION_STATUSES, VOLUNTEER_STATUSES } from '@the-tool-pit/db/event-enums'
import { FIELD_AVAILABILITY } from '@the-tool-pit/db/field-enums'
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  VOLUNTEER_STATUS_LABEL,
} from '@/lib/events/event-display'
import { AVAILABILITY_LABEL } from '@/lib/fields/field-display'

/**
 * What an owner may edit on their own listing, per vertical, as data.
 *
 * ONE declaration, read by two consumers that must never disagree:
 *
 *   - listing-edit-form.tsx renders an input per entry, with maxLength and the
 *     select options taken from here.
 *   - app/me/listings/actions.ts parses and validates the posted FormData by
 *     walking the same entries.
 *
 * That is the whole reason this file exists. The rules that decide whether a
 * value is acceptable (length, integer range, allowed enum member, URL shape)
 * live here once. A second copy in the form would be the copy that drifts, and
 * the drift is invisible until someone's edit is silently truncated.
 *
 * The server still validates everything. Nothing here is a security boundary:
 * a maxLength attribute is a courtesy to whoever is typing, not a check.
 *
 * VALUE imports are restricted to the zero-dependency enum subpaths and the two
 * display modules, which only type-import from the db package. The
 * @the-tool-pit/db barrel re-exports the postgres client, so a value import of
 * it from a file the browser bundle reaches kills `next build` with
 * "Module not found: net". TOOL_TYPES lives in that barrel, which is why the
 * tool type options arrive as a prop instead (see `options: null` below).
 */

// #region shape

export type ListingFieldKind =
  | 'text'
  | 'textarea'
  | 'url'
  | 'email'
  | 'int'
  | 'date'
  | 'select'
  | 'checkbox'

export interface ListingFieldSpec {
  /** FormData key, and the column it writes (link_* fields are the exception). */
  key: string
  label: string
  kind: ListingFieldKind
  /** Which group heading it renders under. */
  group: string
  /**
   * Refused when empty. Only ever set on the one column a listing cannot lose,
   * because everything else being blank is a legitimate "we do not know yet".
   */
  required?: boolean
  /** text | textarea | url | email: hard cap. The server truncates to it. */
  maxLength?: number
  /** int: inclusive bounds. Out of range is refused, not clamped. */
  min?: number
  max?: number
  /** select: allowed values. null means the page supplies them as a prop. */
  options?: readonly string[] | null
  optionLabels?: Record<string, string>
  /** textarea height. */
  rows?: number
  /** Why the field is worth filling in, or what shape the value takes. */
  hint?: string
  /** Spans both columns of the grid. */
  wide?: boolean
}

export interface ListingGroup {
  key: string
  title: string
  blurb?: string
}

export interface ListingFormSpec {
  groups: readonly ListingGroup[]
  fields: readonly ListingFieldSpec[]
}

// #endregion

// #region tools

/**
 * The link types an owner controls, and the form key each one posts under.
 * `link_github` matches the naming the admin tool editor already uses, so the
 * two forms read the same on the wire.
 */
export const OWNER_LINK_TYPES = [
  'homepage',
  'github',
  'docs',
  'issues',
  'changelog',
  'forum',
  'source',
] as const
export type OwnerLinkType = (typeof OWNER_LINK_TYPES)[number]

export function linkFieldKey(type: OwnerLinkType): string {
  return `link_${type}`
}

const LINK_LABEL: Record<OwnerLinkType, string> = {
  homepage: 'Homepage',
  github: 'GitHub repository',
  docs: 'Documentation',
  issues: 'Issue tracker',
  changelog: 'Changelog',
  forum: 'Chief Delphi thread',
  source: 'Source',
}

const LINK_GROUP: Record<OwnerLinkType, 'links' | 'crawled_links'> = {
  // The three the crawler also writes. See the group blurb, and the note in
  // app/me/listings/actions.ts, for what that means for an edit here.
  homepage: 'crawled_links',
  github: 'crawled_links',
  forum: 'crawled_links',
  docs: 'links',
  issues: 'links',
  changelog: 'links',
  source: 'links',
}

const LINK_FIELDS: ListingFieldSpec[] = OWNER_LINK_TYPES.map((type) => ({
  key: linkFieldKey(type),
  label: LINK_LABEL[type],
  kind: 'url' as const,
  group: LINK_GROUP[type],
  maxLength: 1000,
  wide: true,
}))

/**
 * FRC's first season. A season year below it is a typo, not a vintage repo.
 * The upper bound is read once when the module loads; a season a year out is a
 * far better error than no bound at all.
 */
const FIRST_SEASON = 1992
const LATEST_SEASON = new Date().getUTCFullYear() + 1

const TOOL_FORM: ListingFormSpec = {
  groups: [
    { key: 'about', title: 'About' },
    {
      key: 'team',
      title: 'Team code and CAD',
      blurb:
        'Filled in, these put the repository in the Robot Code archive under your team and season. Left blank, it stays out of it.',
    },
    {
      key: 'crawled_links',
      title: 'Main links',
      blurb:
        'Our crawler fills these three in from the tool’s own pages, so a later pass can replace what you put here. The links below are yours alone.',
    },
    { key: 'links', title: 'Other links' },
  ],
  fields: [
    { key: 'name', label: 'Name', kind: 'text', group: 'about', required: true, maxLength: 200 },
    {
      key: 'toolType',
      label: 'Type',
      kind: 'select',
      group: 'about',
      // TOOL_TYPES cannot be value-imported here. The page passes it down.
      options: null,
    },
    {
      key: 'summary',
      label: 'Summary',
      kind: 'text',
      group: 'about',
      maxLength: 500,
      wide: true,
      hint: 'One or two sentences. This is the line under the name on every card.',
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'textarea',
      group: 'about',
      maxLength: 20_000,
      rows: 8,
      wide: true,
      hint: 'Markdown is fine.',
    },
    {
      key: 'vendorName',
      label: 'Vendor name',
      kind: 'text',
      group: 'about',
      maxLength: 200,
      hint: 'Leave blank unless a company publishes this.',
    },
    { key: 'isTeamCode', label: 'This is a team’s robot code', kind: 'checkbox', group: 'team' },
    { key: 'isTeamCad', label: 'This is a team’s robot CAD', kind: 'checkbox', group: 'team' },
    { key: 'teamNumber', label: 'Team number', kind: 'int', group: 'team', min: 1, max: 99_999 },
    {
      key: 'seasonYear',
      label: 'Season',
      kind: 'int',
      group: 'team',
      min: FIRST_SEASON,
      max: LATEST_SEASON,
      hint: 'The game year the code was written for.',
    },
    ...LINK_FIELDS,
  ],
}

// #endregion

// #region albums

const ALBUM_FORM: ListingFormSpec = {
  groups: [{ key: 'about', title: 'About this album' }],
  fields: [
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      group: 'about',
      maxLength: 300,
      hint: 'Blank falls back to the event name.',
    },
    { key: 'photographer', label: 'Photographer', kind: 'text', group: 'about', maxLength: 200 },
    {
      key: 'dateText',
      label: 'Date',
      kind: 'text',
      group: 'about',
      maxLength: 120,
      hint: 'However it should read on the card, for example Apr 12-14.',
    },
    {
      key: 'photoCount',
      label: 'Photo count',
      kind: 'int',
      group: 'about',
      min: 0,
      max: 1_000_000,
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'textarea',
      group: 'about',
      maxLength: 5_000,
      rows: 5,
      wide: true,
    },
  ],
}

// #endregion

// #region practice fields

const FIELD_FORM: ListingFormSpec = {
  groups: [
    { key: 'about', title: 'The field' },
    {
      key: 'access',
      title: 'Getting in',
      blurb: 'What a team needs to know before they drive to you.',
    },
  ],
  fields: [
    { key: 'name', label: 'Field name', kind: 'text', group: 'about', required: true, maxLength: 200 },
    {
      key: 'availability',
      label: 'Availability',
      kind: 'select',
      group: 'access',
      options: FIELD_AVAILABILITY,
      optionLabels: AVAILABILITY_LABEL,
    },
    {
      key: 'hours',
      label: 'Days and hours',
      kind: 'text',
      group: 'access',
      maxLength: 500,
      wide: true,
      hint: 'Free text, for example weekends by arrangement.',
    },
    {
      key: 'contactInfo',
      label: 'How to arrange access',
      kind: 'textarea',
      group: 'access',
      maxLength: 1_000,
      rows: 3,
      wide: true,
    },
    { key: 'contactUrl', label: 'Booking or contact link', kind: 'url', group: 'access', maxLength: 500 },
    { key: 'website', label: 'Website', kind: 'url', group: 'access', maxLength: 500 },
    {
      key: 'notes',
      label: 'Notes',
      kind: 'textarea',
      group: 'access',
      maxLength: 2_000,
      rows: 4,
      wide: true,
    },
  ],
}

// #endregion

// #region off-season events

const PROGRAM_LABEL: Record<string, string> = { frc: 'FRC', ftc: 'FTC', fll: 'FLL' }

const EVENT_FORM: ListingFormSpec = {
  groups: [
    { key: 'about', title: 'The event' },
    { key: 'where', title: 'Where' },
    { key: 'when', title: 'When' },
    {
      key: 'entry',
      title: 'Getting in',
      blurb: 'Cost, slots and whether the door is open. This is what the map colours are keyed on.',
    },
    { key: 'links', title: 'Links and contact' },
    { key: 'more', title: 'Anything else' },
  ],
  fields: [
    { key: 'name', label: 'Event name', kind: 'text', group: 'about', required: true, maxLength: 200 },
    {
      key: 'program',
      label: 'Program',
      kind: 'select',
      group: 'about',
      options: EVENT_PROGRAMS,
      optionLabels: PROGRAM_LABEL,
    },
    {
      key: 'hostTeamNumber',
      label: 'Host team',
      kind: 'int',
      group: 'about',
      min: 1,
      max: 99_999,
      hint: 'Leave blank when no single team runs it.',
    },
    {
      key: 'eventStatus',
      label: 'Status',
      kind: 'select',
      group: 'about',
      options: EVENT_STATUSES,
      optionLabels: EVENT_STATUS_LABEL,
      hint: 'Cancelled and completed events stay on the map, greyed out.',
    },
    { key: 'venueName', label: 'Venue', kind: 'text', group: 'where', maxLength: 200 },
    { key: 'address', label: 'Street address', kind: 'text', group: 'where', maxLength: 300, wide: true },
    { key: 'city', label: 'City', kind: 'text', group: 'where', maxLength: 120 },
    { key: 'region', label: 'State or province', kind: 'text', group: 'where', maxLength: 120 },
    { key: 'country', label: 'Country', kind: 'text', group: 'where', maxLength: 120 },
    { key: 'startDate', label: 'First day', kind: 'date', group: 'when' },
    { key: 'endDate', label: 'Last day', kind: 'date', group: 'when' },
    {
      key: 'days',
      label: 'Competition days',
      kind: 'int',
      group: 'when',
      min: 1,
      max: 2,
      hint: 'Blank when it is not settled yet.',
    },
    {
      key: 'parallelDivisions',
      label: 'Two single-day events in parallel',
      kind: 'checkbox',
      group: 'when',
      hint: 'Two independent tournaments the same weekend, each with its own slots.',
    },
    { key: 'capacity', label: 'Team slots', kind: 'int', group: 'entry', min: 1, max: 999 },
    {
      key: 'costUsd',
      label: 'Cost per team',
      kind: 'int',
      group: 'entry',
      min: 0,
      max: 99_999,
      hint: 'Whole US dollars. Zero reads as Free.',
    },
    {
      key: 'costNote',
      label: 'Cost detail',
      kind: 'text',
      group: 'entry',
      maxLength: 300,
      wide: true,
      hint: 'For example $450 for both days, or $200 for a second robot.',
    },
    {
      key: 'registrationStatus',
      label: 'Registration',
      kind: 'select',
      group: 'entry',
      options: REGISTRATION_STATUSES,
      optionLabels: REGISTRATION_STATUS_LABEL,
    },
    {
      key: 'registrationOpensAt',
      label: 'Registration opens',
      kind: 'date',
      group: 'entry',
      hint: 'Only kept while registration is not open yet.',
    },
    {
      key: 'volunteerStatus',
      label: 'Volunteers',
      kind: 'select',
      group: 'entry',
      options: VOLUNTEER_STATUSES,
      optionLabels: VOLUNTEER_STATUS_LABEL,
    },
    { key: 'website', label: 'Event website', kind: 'url', group: 'links', maxLength: 500, wide: true },
    { key: 'registrationUrl', label: 'Registration link', kind: 'url', group: 'links', maxLength: 500, wide: true },
    { key: 'volunteerUrl', label: 'Volunteer sign-up link', kind: 'url', group: 'links', maxLength: 500, wide: true },
    { key: 'chiefDelphiUrl', label: 'Chief Delphi thread', kind: 'url', group: 'links', maxLength: 500, wide: true },
    {
      key: 'contactEmail',
      label: 'Organiser email',
      kind: 'email',
      group: 'links',
      maxLength: 200,
      wide: true,
      hint: 'Shown publicly, so use the address you want teams writing to.',
    },
    {
      key: 'notes',
      label: 'Notes',
      kind: 'textarea',
      group: 'more',
      maxLength: 2_000,
      rows: 4,
      wide: true,
    },
  ],
}

// #endregion

// #region lookup

export const LISTING_FORMS: Record<ListingEntityType, ListingFormSpec> = {
  tool: TOOL_FORM,
  album: ALBUM_FORM,
  field: FIELD_FORM,
  event: EVENT_FORM,
}

export function listingFormSpec(entityType: ListingEntityType): ListingFormSpec {
  return LISTING_FORMS[entityType]
}

// #endregion

// #region parsing

/**
 * Parse and validate a posted form against a vertical's spec.
 *
 * Lives beside the specs and not in the server action so there is exactly one
 * statement of each rule: the cap on a text box, the range on a number, the
 * members of a select. A parser in the action reading limits declared here
 * would be a second copy the day someone edited one and not the other.
 *
 * Pure, and therefore tested directly. It is still only ever CALLED from the
 * server: the form does not pre-validate, so there is nothing on the client to
 * disagree with. Every value is treated as hostile, because a posted form is.
 *
 * Returns:
 *   - a string for text kinds, or null when the box was cleared
 *   - a number for int kinds, or null
 *   - a boolean for checkboxes, never null
 *   - undefined for a select left blank, meaning "do not write this column",
 *     because every select here backs a NOT NULL column with a default
 */
export function parseListingValues(
  spec: ListingFormSpec,
  form: FormData,
  dynamicOptions: Record<string, readonly string[]> = {},
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {}

  for (const field of spec.fields) {
    if (field.kind === 'checkbox') {
      const raw = form.get(field.key)
      values[field.key] = raw === 'true' || raw === 'on' || raw === '1'
      continue
    }

    const raw = form.get(field.key)
    const text = typeof raw === 'string' ? raw.trim() : ''

    if (text === '') {
      if (field.required) return { error: `${field.label} cannot be empty.` }
      values[field.key] = field.kind === 'select' ? undefined : null
      continue
    }

    switch (field.kind) {
      case 'select': {
        const allowed = field.options ?? dynamicOptions[field.key] ?? []
        if (!allowed.includes(text)) return { error: `${field.label} is not one of the choices.` }
        values[field.key] = text
        break
      }
      case 'int': {
        if (!/^-?\d+$/.test(text)) return { error: `${field.label} has to be a whole number.` }
        const n = Number(text)
        const min = field.min ?? Number.MIN_SAFE_INTEGER
        const max = field.max ?? Number.MAX_SAFE_INTEGER
        if (n < min || n > max) return { error: `${field.label} has to be between ${min} and ${max}.` }
        values[field.key] = n
        break
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: `${field.label} has to be a date.` }
        values[field.key] = text
        break
      }
      case 'url': {
        if (!isHttpUrl(text)) return { error: `${field.label} has to start with http:// or https://.` }
        values[field.key] = text.slice(0, field.maxLength ?? 1000)
        break
      }
      case 'email': {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          return { error: `${field.label} does not look like an email address.` }
        }
        values[field.key] = text.slice(0, field.maxLength ?? 200)
        break
      }
      default:
        values[field.key] = text.slice(0, field.maxLength ?? 1000)
    }
  }

  return { values }
}

/**
 * http and https only.
 *
 * A javascript: or data: URL passes `new URL()` and every one of these values
 * ends up as the href of a link someone clicks, so the scheme is checked here
 * rather than trusted to whatever renders it.
 */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// #endregion

// #region copy

/**
 * What the vertical tells an owner about the parts they cannot change here.
 *
 * Everything named is a deliberate hold-back, not an oversight, so each line
 * says which route the change takes instead. An empty string means there is
 * nothing held back.
 */
export const LISTING_REVIEW_NOTE: Record<ListingEntityType, string> = {
  tool: 'Whether a tool is marked official, vendor-published or rookie friendly is set by a reviewer, along with the programs and roles it is filed under.',
  album: 'The album address and which event it belongs to are set by a reviewer, because they are what stops the same gallery being listed twice.',
  field:
    'Where the field is, and its size, perimeter, elements and ceiling, go through the suggest-an-edit review on the map, so a move gets a second look. Everything here you change directly.',
  event:
    'The map pin coordinates are set by a reviewer, because the map only carries events it can place. Ask us to move it if the venue changes.',
}

// #endregion
