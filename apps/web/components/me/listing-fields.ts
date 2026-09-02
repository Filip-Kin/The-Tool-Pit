import type { ListingEntityType } from '@the-tool-pit/db'
import { EVENT_PROGRAMS, EVENT_STATUSES, REGISTRATION_STATUSES, VOLUNTEER_STATUSES } from '@the-tool-pit/db/event-enums'
import {
  FIELD_AVAILABILITY,
  FIELD_COVERAGE,
  FIELD_ELEMENTS,
  FIELD_PERIMETER,
  FIELD_PROGRAMS,
} from '@the-tool-pit/db/field-enums'
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  VOLUNTEER_STATUS_LABEL,
} from '@/lib/events/event-display'
import {
  AVAILABILITY_LABEL,
  COVERAGE_LABEL,
  ELEMENTS_LABEL,
  PERIMETER_LABEL,
} from '@/lib/fields/field-display'

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
  /** A decimal. Only latitude and longitude need one, and 'int' would round a pin into the next suburb. */
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  /**
   * A set of taxonomy slugs, posted as one FormData key repeated. Backed by a
   * join table rather than a column, so it is loaded and written on its own
   * path. See the tag fields on the tool form.
   */
  | 'tags'
  /**
   * A list of label and URL pairs the owner writes themselves, as many as they
   * like up to a cap. Backed by tool_links rows rather than a column, like the
   * fixed link boxes, so it is loaded and written on its own path.
   */
  | 'links'

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
  /** int and number: inclusive bounds. Out of range is refused, not clamped. */
  min?: number
  max?: number
  /** select and tags: allowed values. null means the page supplies them as a prop. */
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
 * Everything else an owner wants to link to.
 *
 * The seven types above keep their own boxes because each one MEANS something
 * to the rest of the site: github feeds the star count, forum feeds the Chief
 * Delphi likes, and both trigger a popularity re-read the moment they change.
 * A Discord server, a YouTube channel, a store page or a second repository mean
 * nothing to us and everything to the person looking at the listing, so they go
 * in a list the owner writes the labels for.
 *
 * ON THE WIRE, and this is the part that has to be exact: two keys repeated
 * once per row, in row order. The editor always renders BOTH inputs for a row,
 * even when one is empty, so the two arrays stay index-aligned by construction
 * and there is no row id to keep in step.
 *
 * IN THE DATABASE these are ordinary tool_links rows with link_type 'other' and
 * the owner's words in `label`, which is a column that has existed since the
 * table did and which nothing has ever written. No migration, no new column.
 * components/tools/tool-detail.tsx already prefers a row's own label over the
 * generic word for its type, so the display side needed nothing.
 */
export const EXTRA_LINKS_KEY = 'extraLinks'
export const EXTRA_LINK_LABEL_KEY = 'extraLinkLabel'
export const EXTRA_LINK_URL_KEY = 'extraLinkUrl'

/** The link_type every owner-written link is filed under. */
export const EXTRA_LINK_TYPE = 'other'

/**
 * The cap, and why there is one.
 *
 * "More links" is a row of chips under the description. Past a dozen it stops
 * being a set of links and becomes a link farm, on a page whose whole job is to
 * tell somebody in five seconds what a tool is. Twelve is more than any listing
 * on the site has ever needed and few enough that the row still reads. The
 * server refuses the thirteenth; the editor stops offering to add one.
 */
export const MAX_EXTRA_LINKS = 12

/** Long enough for "Getting started video", short enough to stay on one chip. */
export const EXTRA_LINK_LABEL_MAX = 80
/** The same cap the seven fixed link boxes carry. */
export const EXTRA_LINK_URL_MAX = 1000

export interface ExtraLink {
  /** The owner's words. Empty means the page falls back to plain "Link". */
  label: string
  url: string
}

const EXTRA_LINKS_FIELD: ListingFieldSpec = {
  key: EXTRA_LINKS_KEY,
  label: 'Anything else',
  kind: 'links',
  group: 'links',
  wide: true,
  hint: 'A Discord, a video, a store page, a second repository. Give each one a name people will recognise.',
}

/**
 * Pull the owner-written links out of a posted form.
 *
 * Separate from parseListingValues' switch because it reads repeated keys
 * rather than one, and because the admin tool editor calls it directly: that
 * form is a plain submit with its own field set and no listing spec behind it.
 * One parser, so the two editors cannot drift on what they accept.
 *
 * Every rule here is a rule about a HOSTILE post, not about the editor. The
 * editor caps the rows and marks the input type=url; neither of those survives
 * a hand-built request, so the cap and the scheme are checked again here.
 */
export function parseExtraLinks(form: FormData): { links: ExtraLink[] } | { error: string } {
  const urls = form.getAll(EXTRA_LINK_URL_KEY)
  const labels = form.getAll(EXTRA_LINK_LABEL_KEY)
  const links: ExtraLink[] = []
  const seen = new Set<string>()

  for (let i = 0; i < urls.length; i++) {
    const rawUrl = urls[i]
    const rawLabel = labels[i]
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''

    // A row is a link once it has an address. Pressing Add puts an empty row on
    // screen and the form autosaves on the next blur, so an empty row MUST post
    // as nothing at all. A label typed with no URL yet is the same case: it
    // stays on screen where the owner can finish it, and stores nothing.
    if (url === '') continue

    if (!isHttpUrl(url)) {
      return {
        error: label
          ? `The link you named "${label}" has to start with http:// or https://.`
          : 'Every extra link has to start with http:// or https://.',
      }
    }

    // Two rows with the same name AND the same address are one link typed
    // twice. Storing both puts the same chip on the page twice, so the second
    // is dropped rather than refused: there is nothing for the owner to fix.
    const pair = `${label}\u0000${url}`
    if (seen.has(pair)) continue
    seen.add(pair)

    links.push({ label: label.slice(0, EXTRA_LINK_LABEL_MAX), url: url.slice(0, EXTRA_LINK_URL_MAX) })
  }

  if (links.length > MAX_EXTRA_LINKS) {
    return { error: `You can add up to ${MAX_EXTRA_LINKS} extra links. Take one off to add another.` }
  }

  return { links }
}

/**
 * The three taxonomies a tool owner sets, and the form key each posts under.
 *
 * These are the only fields on any of these forms that are NOT a column on the
 * listing's own table. Each one is a join table (tool_programs,
 * tool_audience_primary_roles, tool_audience_functions), so listingColumnFields
 * drops them and the save action writes them on its own path, the same way the
 * link fields work. The values are taxonomy SLUGS, which is what the picker
 * posts and what the writer resolves back to ids.
 *
 * The rows themselves are seed data and are read from the database, so the
 * options arrive as a prop rather than being restated here. A hardcoded list
 * would be the copy that drifts the day somebody adds a role.
 */
export const TOOL_TAG_KEYS = ['programs', 'audienceRoles', 'audienceFunctions'] as const
export type ToolTagKey = (typeof TOOL_TAG_KEYS)[number]

const TOOL_TAG_FIELDS: ListingFieldSpec[] = [
  {
    key: 'programs',
    label: 'Programs',
    kind: 'tags',
    group: 'tags',
    options: null,
    wide: true,
    hint: 'Which FIRST programs this is useful for. Leave it empty if it suits all of them equally.',
  },
  {
    key: 'audienceRoles',
    label: 'Who it is for',
    kind: 'tags',
    group: 'tags',
    options: null,
    wide: true,
    hint: 'The people who get the most out of it.',
  },
  {
    key: 'audienceFunctions',
    label: 'What it helps with',
    kind: 'tags',
    group: 'tags',
    options: null,
    wide: true,
    hint: 'The job it does on a team.',
  },
]

/**
 * FRC's first season. A season year below it is a typo, not a vintage repo.
 * The upper bound is read once when the module loads; a season a year out is a
 * far better error than no bound at all.
 */
const FIRST_SEASON = 1992
const LATEST_SEASON = new Date().getUTCFullYear() + 1

const TOOL_GROUPS: ListingGroup[] = [
  { key: 'about', title: 'About' },
  {
    key: 'tags',
    title: 'Tags',
    blurb:
      'How people find this in the directory. Pick the programs it works for and who it is for. Nothing here is required.',
  },
  {
    key: 'crawled_links',
    title: 'Main links',
    blurb:
      'Our crawler fills these three in from the tool’s own pages until you change one. A link you set, or clear, stays the way you left it.',
  },
  {
    key: 'links',
    title: 'Other links',
    blurb: 'The four we know how to label, then as many of your own as you need.',
  },
]

const TOOL_ABOUT_FIELDS: ListingFieldSpec[] = [
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
]

/**
 * The archive fields, and the two that are NOT here.
 *
 * teamNumber and seasonYear file a repository in the Robot Code or Robot CAD
 * archive under a team and a game year, and an owner correcting a wrong team
 * number is exactly the archive quality we want, so they are theirs.
 *
 * isTeamCode and isTeamCad are not. They decide which archive a listing belongs
 * in at all, which is a moderation call and not a box on every tool's form. On
 * an ordinary tool the whole group is absent, which is the point: the group
 * rendered on all 1200 tools and invited any owner to declare their calculator
 * was a team's robot code.
 */
const TOOL_ARCHIVE_GROUP: ListingGroup = {
  key: 'archive',
  title: 'Team and season',
  blurb:
    'This listing is in the robot archive. These two put it under the right team and game year. Ask us if it is in the wrong archive, or in one it should not be in.',
}

const TOOL_ARCHIVE_FIELDS: ListingFieldSpec[] = [
  { key: 'teamNumber', label: 'Team number', kind: 'int', group: 'archive', min: 1, max: 99_999 },
  {
    key: 'seasonYear',
    label: 'Season',
    kind: 'int',
    group: 'archive',
    min: FIRST_SEASON,
    max: LATEST_SEASON,
    hint: 'The game year the code was written for.',
  },
]

const TOOL_FORM: ListingFormSpec = {
  groups: TOOL_GROUPS,
  fields: [...TOOL_ABOUT_FIELDS, ...TOOL_TAG_FIELDS, ...LINK_FIELDS, EXTRA_LINKS_FIELD],
}

/** The same form, plus the archive group, for a listing already in the archive. */
const TOOL_ARCHIVE_FORM: ListingFormSpec = {
  groups: [TOOL_GROUPS[0], TOOL_ARCHIVE_GROUP, ...TOOL_GROUPS.slice(1)],
  fields: [
    ...TOOL_ABOUT_FIELDS,
    ...TOOL_ARCHIVE_FIELDS,
    ...TOOL_TAG_FIELDS,
    ...LINK_FIELDS,
    EXTRA_LINKS_FIELD,
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

/** Shared by the practice field and off-season event forms. */
const PROGRAM_LABEL: Record<string, string> = { frc: 'FRC', ftc: 'FTC', fll: 'FLL' }

const FIELD_FORM: ListingFormSpec = {
  groups: [
    { key: 'about', title: 'The field' },
    {
      key: 'spec',
      title: 'What is on it',
      blurb: 'The three things every team asks before they book a drive: how much field, what the elements are made of, and whether there is an FMS.',
    },
    {
      key: 'where',
      title: 'Where it is',
      blurb:
        'The pin is what puts you on the map. Move it and the map moves with you, straight away.',
    },
    {
      key: 'access',
      title: 'Getting in',
      blurb: 'What a team needs to know before they drive to you.',
    },
  ],
  fields: [
    { key: 'name', label: 'Field name', kind: 'text', group: 'about', required: true, maxLength: 200 },
    {
      key: 'teamNumber',
      label: 'Team number',
      kind: 'int',
      group: 'about',
      min: 1,
      max: 99_999,
      hint: 'Leave blank when no single team runs it.',
    },
    { key: 'teamName', label: 'Team or organisation', kind: 'text', group: 'about', maxLength: 200 },
    {
      key: 'program',
      label: 'Program',
      kind: 'select',
      group: 'about',
      options: FIELD_PROGRAMS,
      optionLabels: PROGRAM_LABEL,
    },
    {
      key: 'coverage',
      label: 'How much field',
      kind: 'select',
      group: 'spec',
      options: FIELD_COVERAGE,
      optionLabels: COVERAGE_LABEL,
    },
    {
      key: 'elements',
      label: 'Field elements',
      kind: 'select',
      group: 'spec',
      options: FIELD_ELEMENTS,
      optionLabels: ELEMENTS_LABEL,
    },
    {
      key: 'perimeter',
      label: 'Perimeter',
      kind: 'select',
      group: 'spec',
      options: FIELD_PERIMETER,
      optionLabels: PERIMETER_LABEL,
    },
    { key: 'hasFms', label: 'There is a working FMS', kind: 'checkbox', group: 'spec' },
    {
      key: 'ceilingHeightFt',
      label: 'Ceiling height (ft)',
      kind: 'int',
      group: 'spec',
      min: 1,
      max: 199,
      hint: 'Teams with tall mechanisms check this first.',
    },
    { key: 'address', label: 'Street address', kind: 'text', group: 'where', maxLength: 300, wide: true },
    { key: 'city', label: 'City', kind: 'text', group: 'where', maxLength: 120 },
    { key: 'region', label: 'State or province', kind: 'text', group: 'where', maxLength: 120 },
    { key: 'country', label: 'Country', kind: 'text', group: 'where', maxLength: 120 },
    {
      key: 'latitude',
      label: 'Pin latitude',
      kind: 'number',
      group: 'where',
      min: -90,
      max: 90,
      hint: 'Decimal degrees. Right-click a spot in Google Maps to copy the pair.',
    },
    { key: 'longitude', label: 'Pin longitude', kind: 'number', group: 'where', min: -180, max: 180 },
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
    {
      key: 'latitude',
      label: 'Pin latitude',
      kind: 'number',
      group: 'where',
      min: -90,
      max: 90,
      hint: 'Decimal degrees. Right-click a spot in Google Maps to copy the pair.',
    },
    { key: 'longitude', label: 'Pin longitude', kind: 'number', group: 'where', min: -180, max: 180 },
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

// #region grants
//
// DELIBERATELY THE SMALLEST FORM HERE. A grant listing's name, funder,
// deadlines, amounts and eligibility are a moderator's VERIFIED reading of the
// funder's own page; grants.verifiedAt says a human checked them, and a wrong
// deadline costs a team an application. None of those can be an owner's to
// edit without that promise becoming untrue.
//
// What is left is real and worth having: the words about the programme, and
// where the application actually happens, which is the link that moves most
// often and which the funder notices first.

const GRANT_FORM: ListingFormSpec = {
  groups: [
    {
      key: 'about',
      title: 'About this grant',
      blurb:
        'The words teams read, and the two links they follow. Dates, amounts and who can apply are checked by a reviewer.',
    },
  ],
  fields: [
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
      hint: 'Markdown is fine. What it funds, and what a good application looks like.',
    },
    {
      key: 'infoUrl',
      label: 'Funder page',
      kind: 'url',
      group: 'about',
      required: true,
      maxLength: 1000,
      wide: true,
      // NOT NULL on the column, and the page a reviewer reads the dates off, so
      // it is required here rather than clearable. The owner gets it because a
      // funder who moves their own page is the person who knows, and a dead
      // link is what teams hit first. It is still a link, not a date or an
      // amount, so it does not cross the line the group blurb draws.
      hint: 'The page teams read about this on. We re-check this page for changes.',
    },
    {
      key: 'applicationUrl',
      label: 'Application link',
      kind: 'url',
      group: 'about',
      maxLength: 1000,
      wide: true,
      hint: 'Where the form actually is, when that is a different page from the write-up.',
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
  grant: GRANT_FORM,
}

/**
 * The facts about a listing that change which fields its owner gets.
 *
 * Only one so far, and it earns the parameter on its own: a tool in the robot
 * archive needs the team and season boxes and an ordinary tool must not have
 * them.
 *
 * IT HAS TO REACH THE PARSER, NOT JUST THE RENDER. Hiding a group at render
 * time and parsing the full spec anyway is the bug this shape exists to make
 * impossible: parseListingValues reads an absent checkbox as false, so a tool
 * owner pressing nothing would have cleared isTeamCode and dropped the listing
 * out of the archive. A field that is not in the spec is never parsed, never in
 * the column set and never written.
 */
export interface ListingFormContext {
  /** The tool is already filed in the Robot Code or Robot CAD archive. */
  inTeamArchive?: boolean
}

export function listingFormSpec(
  entityType: ListingEntityType,
  context: ListingFormContext = {},
): ListingFormSpec {
  if (entityType === 'tool' && context.inTeamArchive) return TOOL_ARCHIVE_FORM
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
 *   - an array of slugs for tags, possibly empty, never null
 *   - an array of label and URL pairs for links, possibly empty, never null
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

    if (field.kind === 'links') {
      // Repeated keys rather than one, so it cannot go through the switch
      // below. An error here is the owner's to fix, so it stops the whole save
      // the same way a bad number does, instead of silently dropping a row.
      const parsed = parseExtraLinks(form)
      if ('error' in parsed) return parsed
      values[field.key] = parsed.links
      continue
    }

    if (field.kind === 'tags') {
      // One key repeated, the convention the admin tool editor already posts
      // under. An unknown slug is dropped rather than refused: the picker was
      // built from the same rows this list is checked against, so anything else
      // was hand-posted and there is nothing useful to tell the user about it.
      // Deduped, and kept in the order the options were declared, so two saves
      // of the same set produce the same array and not a spurious diff.
      const allowed = field.options ?? dynamicOptions[field.key] ?? []
      const posted = new Set(form.getAll(field.key).map(String))
      values[field.key] = allowed.filter((slug) => posted.has(slug))
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
      case 'number': {
        // Rounding a coordinate to a whole degree moves a pin about 100 km, so
        // this is the one numeric kind that keeps its decimals.
        const n = Number(text)
        if (!Number.isFinite(n)) return { error: `${field.label} has to be a number.` }
        const min = field.min ?? -Number.MAX_VALUE
        const max = field.max ?? Number.MAX_VALUE
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
  tool: 'Whether a tool is marked official, vendor-published or rookie friendly is set by a reviewer, and so is which robot archive it belongs in. The tags are yours.',
  album:
    'Which event the album belongs to, and its address, are set by a reviewer: they are what stops the same gallery being listed twice.',
  field:
    'Everything here is yours and saves as you type. There is no review queue in front of your own field. The suggest-an-edit form on the map is for somebody else proposing a change to it.',
  event:
    'Everything here is yours and saves as you type, including the map pin. There is no review queue in front of your own event.',
  grant:
    'The deadlines, the amounts and who can apply are checked against the funder page by a reviewer before they go live, and stay with them. A wrong deadline costs a team an application. Tell us and we will re-check it.',
}

// #endregion
