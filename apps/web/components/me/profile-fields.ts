/**
 * Team profile field metadata: labels, grouping, completeness weights.
 *
 * Type-only imports from the db package, the same discipline as team-labels.ts
 * in this folder. The client form and the server action both import this, so a
 * VALUE import of the schema barrel would drag drizzle and postgres into the
 * browser bundle.
 *
 * One list on purpose. The form renders from it, the stored completeness
 * percentage is computed from it, and the matcher's `missingFields` are looked
 * up in it. Three separate lists would drift, and the failure mode is nagging a
 * team about a box the form does not offer.
 */
import type { TeamProfile } from '@the-tool-pit/db'
import { profilePathLabel } from '@/lib/grants/prefill'

// #region shapes

export type ProfileGroupKey = 'entity' | 'place' | 'size' | 'contact' | 'prose'

export const PROFILE_GROUPS: { key: ProfileGroupKey; title: string; blurb?: string }[] = [
  {
    key: 'entity',
    title: 'Legal entity',
    blurb: 'Who signs the application, and the most common thing a funder gates on.',
  },
  {
    key: 'place',
    title: 'Place',
    blurb: 'A lot of funding is scoped to one state or county.',
  },
  { key: 'size', title: 'Size and history' },
  {
    key: 'contact',
    title: 'Contact',
    blurb: 'Never shown publicly.',
  },
  {
    key: 'prose',
    title: 'Reusable answers',
    blurb: 'Written once, ready to paste or pre-fill.',
  },
]

/**
 * Every editable field, keyed by its team_profiles column. `boilerplate` is the
 * whole keyed JSON blob rather than one column, because a team that has written
 * any reusable answer has done the work the percentage is measuring.
 */
export type ProfileFieldKey =
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
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'website'
  | 'missionStatement'
  | 'boilerplate'

/** The slice of a profile the completeness maths reads. A full row satisfies it. */
export type ProfileFieldValues = Pick<TeamProfile, ProfileFieldKey>

export interface ProfileFieldSpec {
  key: ProfileFieldKey
  label: string
  group: ProfileGroupKey
  /** 3 = the matcher tests it, 2 = an application will ask for it, 1 = useful. */
  weight: 1 | 2 | 3
  /**
   * One line, only where the answer changes something a robotics mentor cannot
   * already see: a matching gate or a privacy fact. A label that repeats itself
   * in a sentence gets no `why`.
   */
  why?: string
  /** True when a grant_requirements row can be tested against this field. */
  matched: boolean
  /** Private to the team's own members. Never rendered on a public page. */
  private?: boolean
  /**
   * When present, the field only counts towards completeness if this returns
   * true. Without it the bar could never reach 100 for most teams: a school
   * club has no EIN, and a 501(c)(3) has no fiscal sponsor. A percentage a team
   * cannot finish is a percentage that lies.
   */
  appliesTo?: (profile: ProfileFieldValues) => boolean
}

// #endregion

// #region the field list

/** Org types where a school designation is a real question rather than noise. */
function isSchoolish(profile: ProfileFieldValues): boolean {
  return profile.orgType === 'school' || profile.orgType === 'school_club' || profile.orgType === 'unknown'
}

export const PROFILE_FIELDS: ProfileFieldSpec[] = [
  {
    key: 'teamName',
    label: 'Team name',
    group: 'entity',
    weight: 2,
    matched: false,
  },
  {
    key: 'orgType',
    label: 'Organisation type',
    group: 'entity',
    weight: 3,
    why: 'The most common eligibility gate.',
    matched: true,
  },
  {
    key: 'ein',
    label: 'EIN',
    group: 'entity',
    weight: 1,
    matched: false,
    private: true,
    appliesTo: (p) => p.orgType === '501c3' || p.orgType === 'other_nonprofit',
  },
  {
    key: 'fiscalSponsorName',
    label: 'Fiscal sponsor',
    group: 'entity',
    weight: 1,
    why: 'Funders that only pay a 501(c)(3) will accept a named sponsor.',
    matched: true,
    appliesTo: (p) => p.orgType === 'fiscal_sponsor',
  },
  {
    key: 'schoolType',
    label: 'School type',
    group: 'entity',
    weight: 3,
    matched: true,
    appliesTo: isSchoolish,
  },
  {
    key: 'schoolName',
    label: 'School name',
    group: 'entity',
    weight: 1,
    matched: false,
    appliesTo: isSchoolish,
  },
  {
    key: 'titleOne',
    label: 'Title I school',
    group: 'entity',
    weight: 3,
    why: 'A hard gate on several equity-focused grants.',
    matched: true,
    appliesTo: isSchoolish,
  },

  {
    key: 'country',
    label: 'Country',
    group: 'place',
    weight: 3,
    matched: true,
  },
  {
    key: 'region',
    label: 'State or province',
    group: 'place',
    weight: 3,
    why: 'State and county funding cannot be matched without it.',
    matched: true,
  },
  { key: 'city', label: 'City', group: 'place', weight: 2, why: 'Local and community foundation grants scope to it.', matched: false },
  { key: 'postalCode', label: 'Postal code', group: 'place', weight: 1, matched: false },
  {
    key: 'mailingAddress',
    label: 'Mailing address',
    group: 'place',
    weight: 2,
    matched: false,
    private: true,
  },

  {
    key: 'rookieYear',
    label: 'Rookie year',
    group: 'size',
    weight: 3,
    why: 'Rookie-only and early-years grants are tested against it.',
    matched: true,
  },
  {
    key: 'studentCount',
    label: 'Students on the team',
    group: 'size',
    weight: 3,
    why: 'Some grants set a minimum roster, some fund per student.',
    matched: true,
  },
  { key: 'mentorCount', label: 'Mentors', group: 'size', weight: 1, matched: false },
  {
    key: 'annualBudget',
    label: 'Annual budget',
    group: 'size',
    weight: 1,
    why: 'Funders weigh their award against it.',
    matched: false,
  },

  { key: 'contactName', label: 'Contact name', group: 'contact', weight: 2, why: 'Who the funder writes back to.', matched: false, private: true },
  { key: 'contactEmail', label: 'Contact email', group: 'contact', weight: 2, matched: false, private: true },
  { key: 'contactPhone', label: 'Contact phone', group: 'contact', weight: 1, why: 'Some forms will not submit without one.', matched: false, private: true },
  { key: 'website', label: 'Team website', group: 'contact', weight: 1, why: 'Funders look you up before they decide.', matched: false },

  {
    key: 'missionStatement',
    label: 'Mission statement',
    group: 'prose',
    weight: 2,
    matched: false,
  },
  {
    key: 'boilerplate',
    label: 'Reusable answers',
    group: 'prose',
    weight: 2,
    matched: false,
  },
]

const FIELD_BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key as string, f]))

/**
 * Human label for a field name. The matcher's `missingFields` are team_profiles
 * column names, and it can name `program`, which is not editable here, so fall
 * back to the shared prefill path labels rather than showing a raw column name.
 */
export function profileFieldLabel(key: string): string {
  return FIELD_BY_KEY.get(key)?.label ?? profilePathLabel(key)
}

export function profileFieldSpec(key: string): ProfileFieldSpec | undefined {
  return FIELD_BY_KEY.get(key)
}

// #endregion

// #region completeness

/**
 * Is this field answered?
 *
 * The traps, all of which have a wrong answer that looks reasonable:
 *  - orgType and schoolType are NOT NULL with an 'unknown' default, so the
 *    default is the absence of an answer, not an answer.
 *  - titleOne is a nullable boolean. `false` is a real answer of "no" and must
 *    count as filled; only null means nobody has said.
 *  - country is NOT NULL defaulting to 'US'. That default is a guess we made,
 *    not something the team told us, but the matcher does use it, so it counts
 *    as filled and the form marks it as assumed instead.
 */
export function isProfileFieldFilled(profile: ProfileFieldValues, key: ProfileFieldKey): boolean {
  switch (key) {
    case 'orgType':
      return profile.orgType !== 'unknown' && profile.orgType.trim() !== ''
    case 'schoolType':
      return profile.schoolType !== 'unknown' && profile.schoolType.trim() !== ''
    case 'titleOne':
      return profile.titleOne !== null && profile.titleOne !== undefined
    case 'boilerplate':
      return Object.values(profile.boilerplate ?? {}).some((v) => typeof v === 'string' && v.trim() !== '')
    default: {
      const value = profile[key]
      if (value === null || value === undefined) return false
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'string') return value.trim() !== ''
      return true
    }
  }
}

/** The fields that apply to this team and are still empty, most valuable first. */
export function unfilledProfileFields(profile: ProfileFieldValues): ProfileFieldSpec[] {
  return PROFILE_FIELDS.filter(
    (spec) => (!spec.appliesTo || spec.appliesTo(profile)) && !isProfileFieldFilled(profile, spec.key),
  ).sort((a, b) => b.weight - a.weight)
}

/**
 * Completeness as a percentage, weighted so that finishing the fields the
 * matcher actually tests moves the number more than filling in a phone number.
 * Stored on the row so the nag can be rendered without recomputing it, and so
 * a future digest can find thin profiles in SQL.
 */
export function computeCompleteness(profile: ProfileFieldValues): number {
  let total = 0
  let earned = 0
  for (const spec of PROFILE_FIELDS) {
    if (spec.appliesTo && !spec.appliesTo(profile)) continue
    total += spec.weight
    if (isProfileFieldFilled(profile, spec.key)) earned += spec.weight
  }
  if (total === 0) return 0
  return Math.round((earned / total) * 100)
}

// #endregion
