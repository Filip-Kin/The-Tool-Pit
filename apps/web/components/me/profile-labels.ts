// Type-only imports of the db package, the same discipline as team-labels.ts
// and profile-fields.ts in this folder. Importing the schema barrel for its
// VALUE would pull drizzle and postgres into the client bundle, and this file
// is imported by the profile form, which is a client component. Keying the
// label records by the schema's own union types gives the same protection a
// value import would: add an org type to grant-enums.ts and these stop
// compiling until someone writes a label for it.
import type { TeamOrgType, SchoolType } from '@the-tool-pit/db'

/**
 * Organisation type, in the funder's language rather than ours.
 *
 * 'unknown' is the column default, so it is offered as a real option worded as
 * an admission. A team that genuinely does not know which entity it applies as
 * should be able to say so and get 'missing_info' matches, not guess and get
 * confidently wrong 'ineligible' ones.
 */
export const ORG_TYPE_LABEL: Record<TeamOrgType, string> = {
  '501c3': 'Our own 501(c)(3)',
  school: 'The school itself applies',
  school_club: 'A club inside a school',
  fiscal_sponsor: 'Through a fiscal sponsor',
  other_nonprofit: 'Another nonprofit (not 501(c)(3))',
  unincorporated: 'Unincorporated group',
  unknown: 'Not sure yet',
}

/** One line under each option, because these words are not obvious to a student. */
export const ORG_TYPE_HINT: Record<TeamOrgType, string> = {
  '501c3': 'The team holds its own IRS determination letter and EIN.',
  school: 'The district or school signs, and the cheque is made out to them.',
  school_club: 'You sit under the school, but the school is not the applicant.',
  fiscal_sponsor: 'Another 501(c)(3) receives the money and passes it to you.',
  other_nonprofit: 'An incorporated nonprofit without 501(c)(3) status.',
  unincorporated: 'No legal entity of your own. Common, and it does rule out some funders.',
  unknown: 'We will still match you, and tell you which grants are waiting on this answer.',
}

export const SCHOOL_TYPE_LABEL: Record<SchoolType, string> = {
  public: 'Public',
  private: 'Private',
  charter: 'Charter',
  homeschool: 'Homeschool',
  community: 'Community or club (no school)',
  other: 'Other',
  unknown: 'Not sure yet',
}

export const ORG_TYPE_OPTIONS = Object.keys(ORG_TYPE_LABEL) as TeamOrgType[]
export const SCHOOL_TYPE_OPTIONS = Object.keys(SCHOOL_TYPE_LABEL) as SchoolType[]

export function orgTypeLabel(value: string): string {
  return ORG_TYPE_LABEL[value as TeamOrgType] ?? value
}

export function schoolTypeLabel(value: string): string {
  return SCHOOL_TYPE_LABEL[value as SchoolType] ?? value
}

/**
 * The reusable answers we prompt for by name.
 *
 * These keys are NOT arbitrary. grant_form_fields.profilePath addresses them as
 * `boilerplate.<key>`, and lib/grants/prefill.ts already lists the same five in
 * PROFILE_PATHS. Renaming one here without renaming it there would leave the
 * autofill map pointing at an answer that no longer exists, which prefill
 * reports as a missing field rather than failing loudly. Keep the two lists in
 * step.
 *
 * A team can also have keys we never suggested (typed by an admin into a form
 * map, or carried over from an import). The form renders those too rather than
 * dropping them on save.
 */
export const BOILERPLATE_KEYS = [
  {
    key: 'mission',
    label: 'Who you are',
    prompt: 'A short paragraph on the team: how long you have run, how many students, what you build.',
  },
  {
    key: 'outreach',
    label: 'Outreach and community work',
    prompt: 'Demos, camps, mentoring other teams, work with your local schools. Funders ask for this constantly.',
  },
  {
    key: 'impact',
    label: 'Impact on students',
    prompt: 'What changes for the students on the team. Numbers help: alumni in STEM, first-generation students, retention.',
  },
  {
    key: 'budget',
    label: 'Budget narrative',
    prompt: 'What the season costs and where the rest of the money comes from.',
  },
  {
    key: 'useOfFunds',
    label: 'Use of funds',
    prompt: 'What this specific money would buy. Keep it generic here and edit per application.',
  },
] as const

export type BoilerplateKey = (typeof BOILERPLATE_KEYS)[number]['key']

const SUGGESTED_KEYS = new Set<string>(BOILERPLATE_KEYS.map((b) => b.key))

/** Keys a team has answers for that we never suggested. Rendered, never dropped. */
export function customBoilerplateKeys(boilerplate: Record<string, string> | null): string[] {
  if (!boilerplate) return []
  return Object.keys(boilerplate)
    .filter((k) => !SUGGESTED_KEYS.has(k))
    .sort()
}
