/**
 * Application prefill.
 *
 * We cannot type into a form on someone else's website. What we CAN do is
 * build the funder's own URL with prefill parameters attached, which is a real
 * feature of Google Forms (`entry.<id>=value`) and of a handful of portals
 * that read plain query parameters. Everything else is honest copy-paste: we
 * put the team's own answer next to the question with a copy button.
 *
 * Three rules this module exists to keep:
 *
 *  1. Never send a blank. A prefilled empty answer looks like a deliberate
 *     empty answer to the funder, and on some forms it overwrites a default.
 *  2. Never hand over a half-filled form silently. A field the form wants and
 *     the team has not filled in comes back in `missingFields` so the UI can
 *     send them to the profile editor instead.
 *  3. No silent caps. If a value is dropped from the URL (broken map row,
 *     URL length), it comes back in `copyFields` with a reason, never
 *     vanishes.
 *
 * No DB client here, only types, so a client component can import the types
 * and the pure helpers without dragging postgres into the bundle.
 */
import type { Grant, GrantFormField, TeamProfile, GrantFieldFillKind } from '@the-tool-pit/db'

// #region result shapes

/** Why an answer ended up in the copy pack instead of in the URL. */
export type CopyReason =
  /** fillKind 'copy': the funder's form takes no parameter for this question. */
  | 'not_prefillable'
  /** fillKind wanted a parameter but the admin map has no paramName on the row. */
  | 'no_param_name'
  /** Adding it would have pushed the URL past what browsers and servers accept. */
  | 'too_long'
  /** The grant has no usable application URL, so there is nothing to prefill onto. */
  | 'no_form_url'

/** One answer the team has to paste in by hand. */
export interface PrefillCopyField {
  formFieldId: string
  /** The question as the funder asks it, falling back to the profile path. */
  label: string
  /** The team's answer, ready to copy. Never empty (empty goes to missingFields). */
  value: string
  /** Admin note on the map row, e.g. "attach as PDF, not text". */
  notes: string | null
  reason: CopyReason
}

/** A question the form wants that the team profile cannot answer yet. */
export interface PrefillMissingField {
  formFieldId: string
  label: string
  /** Dotted path into the team profile, e.g. `boilerplate.mission`. */
  profilePath: string
  /** Human label for that path, so the UI can say "add your EIN", not "add ein". */
  pathLabel: string
  /** True when this one would have gone into the URL had it been filled in. */
  wouldPrefill: boolean
}

/** One answer that made it into the URL, listed so the UI can be specific. */
export interface PrefillFilledField {
  formFieldId: string
  label: string
  paramName: string
}

export interface PrefillResult {
  /**
   * The link the "Start application" button opens. Null only when the grant
   * has neither an application URL nor an info URL, or the stored URL does not
   * parse. Never null just because nothing could be prefilled: opening the
   * plain form is still the right action.
   */
  url: string | null
  /** Answers carried into the URL. Length 0 means the button is a plain link. */
  filledFields: PrefillFilledField[]
  copyFields: PrefillCopyField[]
  missingFields: PrefillMissingField[]
  /** True when the grant has form-field rows but none of them are prefillable. */
  copyOnly: boolean
}

/** The slice of a team profile prefill reads. A full TeamProfile satisfies it. */
export type PrefillProfile = Pick<
  TeamProfile,
  | 'program'
  | 'teamNumber'
  | 'teamName'
  | 'orgType'
  | 'ein'
  | 'fiscalSponsorName'
  | 'schoolType'
  | 'schoolName'
  | 'titleOne'
  | 'country'
  | 'region'
  | 'city'
  | 'postalCode'
  | 'mailingAddress'
  | 'rookieYear'
  | 'studentCount'
  | 'mentorCount'
  | 'annualBudget'
  | 'demographics'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'website'
  | 'missionStatement'
  | 'boilerplate'
>

/** The slice of a grant prefill reads, so callers need not load the whole row. */
export type PrefillGrant = Pick<Grant, 'applicationUrl' | 'infoUrl'>

/** The slice of a form-field map row prefill reads. */
export type PrefillFormField = Pick<
  GrantFormField,
  'id' | 'fillKind' | 'paramName' | 'profilePath' | 'label' | 'notes' | 'sortOrder'
>

// #endregion

// #region profile paths

/**
 * The dotted paths an admin can point a form field at, with the label a human
 * recognises. Used for the admin editor's picker and to name a missing field
 * in the apply panel. `boilerplate.<key>` and `demographics.<key>` are open
 * ended, so they are described here rather than enumerated.
 */
export interface ProfilePathOption {
  path: string
  label: string
  group: 'Team' | 'Legal entity' | 'Place' | 'Size' | 'Contact' | 'Prose'
}

export const PROFILE_PATHS: ProfilePathOption[] = [
  { path: 'teamNumber', label: 'Team number', group: 'Team' },
  { path: 'teamName', label: 'Team name', group: 'Team' },
  { path: 'program', label: 'Programme (FRC/FTC/FLL)', group: 'Team' },
  { path: 'rookieYear', label: 'Rookie year', group: 'Team' },

  { path: 'orgType', label: 'Organisation type', group: 'Legal entity' },
  { path: 'ein', label: 'EIN', group: 'Legal entity' },
  { path: 'fiscalSponsorName', label: 'Fiscal sponsor name', group: 'Legal entity' },
  { path: 'schoolType', label: 'School type', group: 'Legal entity' },
  { path: 'schoolName', label: 'School name', group: 'Legal entity' },
  { path: 'titleOne', label: 'Title I school (yes/no)', group: 'Legal entity' },

  { path: 'mailingAddress', label: 'Mailing address', group: 'Place' },
  { path: 'city', label: 'City', group: 'Place' },
  { path: 'region', label: 'State / province', group: 'Place' },
  { path: 'postalCode', label: 'Postal code', group: 'Place' },
  { path: 'country', label: 'Country', group: 'Place' },

  { path: 'studentCount', label: 'Number of students', group: 'Size' },
  { path: 'mentorCount', label: 'Number of mentors', group: 'Size' },
  { path: 'annualBudget', label: 'Annual budget', group: 'Size' },
  { path: 'demographics.femalePct', label: 'Demographics: female %', group: 'Size' },
  { path: 'demographics.frplPct', label: 'Demographics: free/reduced lunch %', group: 'Size' },

  { path: 'contactName', label: 'Contact name', group: 'Contact' },
  { path: 'contactEmail', label: 'Contact email', group: 'Contact' },
  { path: 'contactPhone', label: 'Contact phone', group: 'Contact' },
  { path: 'website', label: 'Team website', group: 'Contact' },

  { path: 'missionStatement', label: 'Mission statement', group: 'Prose' },
  { path: 'boilerplate.mission', label: 'Boilerplate: mission', group: 'Prose' },
  { path: 'boilerplate.outreach', label: 'Boilerplate: outreach', group: 'Prose' },
  { path: 'boilerplate.impact', label: 'Boilerplate: impact', group: 'Prose' },
  { path: 'boilerplate.budget', label: 'Boilerplate: budget narrative', group: 'Prose' },
  { path: 'boilerplate.useOfFunds', label: 'Boilerplate: use of funds', group: 'Prose' },
]

const PATH_LABELS = new Map(PROFILE_PATHS.map((p) => [p.path, p.label]))

/**
 * Aliases the schema comment advertises (`contact.email`) that are not the
 * real column name (`contactEmail`). Accepting both means a map row typed from
 * the schema docs still resolves, rather than silently coming back empty.
 */
const PATH_ALIASES: Record<string, string> = {
  'contact.name': 'contactName',
  'contact.email': 'contactEmail',
  'contact.phone': 'contactPhone',
  'team.number': 'teamNumber',
  'team.name': 'teamName',
  'school.name': 'schoolName',
  'school.type': 'schoolType',
  'address.city': 'city',
  'address.region': 'region',
  'address.postalCode': 'postalCode',
  'address.country': 'country',
  mission: 'missionStatement',
}

/** Human label for a dotted path, falling back to something readable. */
export function profilePathLabel(path: string): string {
  const canonical = PATH_ALIASES[path] ?? path
  const known = PATH_LABELS.get(canonical)
  if (known) return known
  if (canonical.startsWith('boilerplate.')) {
    return `Boilerplate: ${canonical.slice('boilerplate.'.length)}`
  }
  if (canonical.startsWith('demographics.')) {
    return `Demographics: ${canonical.slice('demographics.'.length)}`
  }
  return canonical
}

/** True when the path names something we know how to resolve. */
export function isKnownProfilePath(path: string): boolean {
  const canonical = PATH_ALIASES[path] ?? path
  return (
    PATH_LABELS.has(canonical) ||
    canonical.startsWith('boilerplate.') ||
    canonical.startsWith('demographics.')
  )
}

/**
 * Resolve a dotted path into the profile and format it as form text.
 *
 * Returns null for "the team has not answered this", which is NOT the same as
 * false: `titleOne === false` is a real answer of "No" and must be sent, while
 * `titleOne === null` means nobody has said. Getting that backwards would
 * either drop a real answer or invent one.
 */
export function resolveProfilePath(profile: PrefillProfile, path: string): string | null {
  const canonical = PATH_ALIASES[path] ?? path
  const parts = canonical.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let current: unknown = profile
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return formatProfileValue(current)
}

/** Turn a resolved profile value into the string a form wants, or null if unanswered. */
export function formatProfileValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (Array.isArray(value)) {
    const joined = value.map((v) => formatProfileValue(v)).filter((v): v is string => !!v).join(', ')
    return joined || null
  }
  if (typeof value === 'object') return null // a whole JSON blob is not an answer
  const text = String(value).trim()
  return text || null
}

// #endregion

// #region URL building

/**
 * Practical ceiling on the built URL. Browsers cope with far more, but IIS and
 * several funder portals answer 414 above roughly 8 KB, and Google Forms
 * quietly ignores a request that long. Boilerplate paragraphs are what push a
 * prefill link over, so anything that would cross this moves to the copy pack
 * with reason 'too_long' rather than being dropped or truncated.
 */
export const MAX_PREFILL_URL_LENGTH = 6000

/** Google's own prefilled links carry this. Some forms need it, none mind it. */
const GOOGLE_PREFILL_USP = 'pp_url'

function isGoogleForm(url: URL): boolean {
  return url.hostname.endsWith('google.com') && url.pathname.includes('/forms/')
}

/**
 * Normalise a stored parameter name for a Google Forms row. Admins paste
 * `entry.1234567890`, but a bare `1234567890` is a common typo and is
 * unambiguous, so accept it rather than producing a link that silently fills
 * nothing.
 */
function googleEntryParam(paramName: string): string | null {
  const trimmed = paramName.trim()
  if (/^entry\.\d+(_[a-z]+)?$/.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `entry.${trimmed}`
  return null
}

/**
 * Build the prefilled application link for one grant and one team profile.
 *
 * `formFields` is the admin-maintained map for the grant. Rows are applied in
 * sortOrder so the copy pack reads in the same order as the funder's form.
 * Nothing here touches the network or the DB, and the profile never leaves the
 * server unless the caller sends the result to the team's own browser.
 */
export function buildPrefillUrl(
  grant: PrefillGrant,
  formFields: PrefillFormField[],
  profile: PrefillProfile,
): PrefillResult {
  const filledFields: PrefillFilledField[] = []
  const copyFields: PrefillCopyField[] = []
  const missingFields: PrefillMissingField[] = []

  const base = (grant.applicationUrl ?? grant.infoUrl ?? '').trim()
  let url: URL | null = null
  try {
    url = base ? new URL(base) : null
  } catch {
    // A stored URL that does not parse is an admin data problem, not a reason
    // to hide the copy pack, so carry on with url null.
    url = null
  }

  const ordered = [...formFields].sort((a, b) => a.sortOrder - b.sortOrder)
  const google = url ? isGoogleForm(url) : false
  let sawGoogleEntry = false

  for (const field of ordered) {
    const value = resolveProfilePath(profile, field.profilePath)
    const label = field.label?.trim() || profilePathLabel(field.profilePath)
    const kind = field.fillKind as GrantFieldFillKind

    if (value === null) {
      // The form asks for it and the profile has no answer. Send them to the
      // profile editor rather than handing over a form with a hole in it.
      missingFields.push({
        formFieldId: field.id,
        label,
        profilePath: field.profilePath,
        pathLabel: profilePathLabel(field.profilePath),
        wouldPrefill: kind !== 'copy',
      })
      continue
    }

    if (kind === 'copy' || !url) {
      copyFields.push({
        formFieldId: field.id,
        label,
        value,
        notes: field.notes,
        reason: url ? 'not_prefillable' : 'no_form_url',
      })
      continue
    }

    const paramName =
      kind === 'google_form_entry'
        ? googleEntryParam(field.paramName ?? '')
        : (field.paramName ?? '').trim() || null

    if (!paramName) {
      // The map row claims to be prefillable but carries no usable parameter
      // name. Surfaced as a copy field so the answer still reaches the team,
      // and so the gap is visible instead of quietly shrinking the URL.
      copyFields.push({
        formFieldId: field.id,
        label,
        value,
        notes: field.notes,
        reason: 'no_param_name',
      })
      continue
    }

    // Length check against a trial URL, because encoding cost is not knowable
    // from the raw value: one long boilerplate paragraph can triple.
    const trial = new URL(url.toString())
    trial.searchParams.set(paramName, value)
    if (trial.toString().length > MAX_PREFILL_URL_LENGTH) {
      copyFields.push({
        formFieldId: field.id,
        label,
        value,
        notes: field.notes,
        reason: 'too_long',
      })
      continue
    }

    url = trial
    if (kind === 'google_form_entry') sawGoogleEntry = true
    filledFields.push({ formFieldId: field.id, label, paramName })
  }

  // Google's own "Get pre-filled link" output carries usp=pp_url, and a link
  // that arrived as usp=sf_link (the share link) must be corrected or the
  // entry values are ignored. Only touch it once we have actually added an
  // entry parameter, so a plain link stays exactly as the admin stored it.
  if (url && google && sawGoogleEntry) {
    url.searchParams.set('usp', GOOGLE_PREFILL_USP)
  }

  return {
    url: url ? url.toString() : base || null,
    filledFields,
    copyFields,
    missingFields,
    copyOnly: filledFields.length === 0 && (copyFields.length > 0 || missingFields.length > 0),
  }
}

// #endregion
