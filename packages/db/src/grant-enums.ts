/**
 * Grant-vertical enum-like value tuples. Kept in a ZERO-DEPENDENCY module (no
 * drizzle, no db client) so client components can import the value tuples for
 * rendering without dragging the DB client / postgres into the browser bundle.
 * The schema in ./schema/grants.ts re-exports these. Same shape as
 * ./field-enums.ts.
 */

/** FIRST program a grant will fund. 'any' = open to any STEM/youth programme. */
export const GRANT_PROGRAMS = ['frc', 'ftc', 'fll', 'any'] as const
export type GrantProgram = (typeof GRANT_PROGRAMS)[number]

/** Who is handing out the money. Drives the funder badge and some ranking. */
export const FUNDER_TYPES = [
  'foundation',
  'corporate',
  'government',
  'nonprofit',
  'community',
  'university',
  'other',
] as const
export type FunderType = (typeof FUNDER_TYPES)[number]

/**
 * How wide the grant's catchment is. Anything narrower than 'national' MUST
 * carry regions/countries, or the matcher cannot rule a team in or out.
 */
export const GRANT_GEO_SCOPES = ['international', 'national', 'state', 'region', 'local'] as const
export type GrantGeoScope = (typeof GRANT_GEO_SCOPES)[number]

/**
 * The shape of the closing date, which is NOT always a date.
 * - fixed:         one deadline, one cycle (often a one-off).
 * - annual_window: opens and closes each year, so last year's dates predict this year's.
 * - rolling:       reviewed as they arrive, no deadline.
 * - unknown:       we have not been able to confirm one. Never guess.
 */
export const GRANT_DEADLINE_TYPES = ['fixed', 'annual_window', 'rolling', 'unknown'] as const
export type GrantDeadlineType = (typeof GRANT_DEADLINE_TYPES)[number]

/** Rough size of the application, so a team can pick what fits the time they have. */
export const GRANT_EFFORT_LEVELS = ['low', 'medium', 'high', 'unknown'] as const
export type GrantEffortLevel = (typeof GRANT_EFFORT_LEVELS)[number]

/**
 * Moderation state. Only 'published' grants appear publicly.
 * 'archived' = real, but the programme has ended for good (kept for history,
 * so a dead grant does not get rediscovered and re-listed every crawl).
 */
export const GRANT_STATUSES = ['pending', 'published', 'suppressed', 'archived'] as const
export type GrantStatus = (typeof GRANT_STATUSES)[number]

/** Where a listing came from. */
export const GRANT_SOURCE_KINDS = [
  'seed',
  'web_search',
  'chief_delphi',
  'team_sponsors',
  'aggregator',
  'submission',
  'admin',
] as const
export type GrantSourceKind = (typeof GRANT_SOURCE_KINDS)[number]

/** Per-cycle state. Derived from the dates on a schedule, not typed by hand. */
export const GRANT_CYCLE_STATUSES = ['upcoming', 'open', 'closed', 'unknown'] as const
export type GrantCycleStatus = (typeof GRANT_CYCLE_STATUSES)[number]

/**
 * Requirement kinds the matcher can actually TEST against a team profile.
 * Anything that cannot be tested goes in as 'other' and only ever renders as
 * prose - it never silently rules a team in or out.
 */
export const GRANT_REQUIREMENT_KINDS = [
  'org_type',
  'fiscal_sponsor_ok',
  'country',
  'region',
  'program',
  'team_age_years',
  'rookie_only',
  'title_i',
  'school_type',
  'student_count',
  'demographics',
  'matching_funds',
  'prior_grantee',
  'use_of_funds',
  'application_material',
  'other',
] as const
export type GrantRequirementKind = (typeof GRANT_REQUIREMENT_KINDS)[number]

/** Comparison used to test a requirement against the matching team profile field. */
export const GRANT_REQUIREMENT_OPERATORS = ['is', 'is_not', 'in', 'not_in', 'gte', 'lte', 'exists'] as const
export type GrantRequirementOperator = (typeof GRANT_REQUIREMENT_OPERATORS)[number]

/**
 * Matcher verdict. 'missing_info' is deliberately its own state rather than a
 * silent exclusion: it is the prompt that gets a team to finish its profile.
 */
export const GRANT_MATCH_VERDICTS = ['eligible', 'likely', 'missing_info', 'ineligible'] as const
export type GrantMatchVerdict = (typeof GRANT_MATCH_VERDICTS)[number]

/** How a team says its own application is going. Team-private. */
export const GRANT_APPLICATION_STATUSES = [
  'interested',
  'in_progress',
  'submitted',
  'awarded',
  'declined',
  'withdrawn',
] as const
export type GrantApplicationStatus = (typeof GRANT_APPLICATION_STATUSES)[number]

/** What kind of legal entity the team applies as. Most grants gate on this first. */
export const TEAM_ORG_TYPES = [
  '501c3',
  'school',
  'school_club',
  'fiscal_sponsor',
  'other_nonprofit',
  'unincorporated',
  'unknown',
] as const
export type TeamOrgType = (typeof TEAM_ORG_TYPES)[number]

/** School flavour, because plenty of grants are public-school-only. */
export const SCHOOL_TYPES = ['public', 'private', 'charter', 'homeschool', 'community', 'other', 'unknown'] as const
export type SchoolType = (typeof SCHOOL_TYPES)[number]

/**
 * How an application field gets pre-filled.
 * - google_form_entry: Google Forms `entry.<id>` prefill parameter.
 * - query:             a plain querystring parameter the form reads.
 * - copy:              cannot be prefilled; we render it for one-click copy.
 */
export const GRANT_FIELD_FILL_KINDS = ['google_form_entry', 'query', 'copy'] as const
export type GrantFieldFillKind = (typeof GRANT_FIELD_FILL_KINDS)[number]

/** Where an alert goes. Push = the existing claude-terminal-style Web Push. */
export const ALERT_CHANNELS = ['email', 'push'] as const
export type AlertChannel = (typeof ALERT_CHANNELS)[number]

/** Why we are pinging someone. */
export const ALERT_KINDS = ['new_match', 'deadline', 'grant_change', 'watch_update', 'digest'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/**
 * Candidate moderation states.
 *
 * 'flagged' is a THIRD answer, not a softer suppression. Suppressing says the
 * page is not a grant and counts against the source that found it; flagging
 * says the page probably is a grant but what we read off it is too thin or too
 * doubtful to publish. A flagged row stays in the queue, keeps its extraction,
 * and is what a later crawl or a second reader picks up.
 */
export const GRANT_CANDIDATE_STATUSES = [
  'pending',
  'flagged',
  'matched',
  'published',
  'suppressed',
  'duplicate',
] as const
export type GrantCandidateStatus = (typeof GRANT_CANDIDATE_STATUSES)[number]

/**
 * Yes / no / unknown, for every eligibility question the extractor answers.
 *
 * A blank used to mean both "the funder's page says no" and "the page never
 * said", and a reader could not tell them apart. 'unknown' is the honest third
 * answer and it renders as "not stated on the funder's page", which is a
 * useful thing for a team to read. Never store null where one of these fits.
 */
export const GRANT_TRI_STATES = ['yes', 'no', 'unknown'] as const
export type GrantTriState = (typeof GRANT_TRI_STATES)[number]

/**
 * How an application is actually submitted. Plenty of real sponsors have no
 * form at all and want a posted letter or an email to a named person, so
 * 'online_form' is not a safe default and 'unknown' is.
 */
export const GRANT_APPLY_METHODS = ['online_form', 'email', 'letter', 'contact', 'unknown'] as const
export type GrantApplyMethod = (typeof GRANT_APPLY_METHODS)[number]

/**
 * Which text an extracted field's supporting quote was found in.
 *
 * - funder_page: text fetched from the funder's own page, or from a page it
 *                links to as the place to apply. Highest trust.
 * - aggregator:  the blurb a third party wrote about the grant (grantexec,
 *                instrumentl, a state association's round-up). Often a better
 *                summary of eligibility than the raw page, written by a person,
 *                but it is someone else's reading and it can be out of date.
 *
 * The distinction is rendered in the review deck because the two deserve
 * different amounts of trust, and a deadline off an aggregator is exactly the
 * kind of second-hand fact that costs a team a round.
 */
export const GRANT_EVIDENCE_SOURCES = ['funder_page', 'aggregator'] as const
export type GrantEvidenceSource = (typeof GRANT_EVIDENCE_SOURCES)[number]

/**
 * Why a moderator said no.
 *
 * A free-text reason cannot be fed back to anything: it is one person's
 * sentence about one page. These seven buckets are the failure modes the
 * grants queue actually produces, and they exist so that a suppression becomes
 * a labelled negative example the next classification run can read. The
 * moderator's own sentence is kept as well, because it is the part that
 * explains the call; the bucket is the part a machine can count and group.
 */
export const GRANT_REJECTION_KINDS = [
  'not_a_grant',
  'aggregator_list',
  'announcement',
  'legislative',
  'expired',
  'duplicate',
  'out_of_scope',
] as const
export type GrantRejectionKind = (typeof GRANT_REJECTION_KINDS)[number]

/** One line each, shown in the review deck and sent to the classifier as the label. */
export const GRANT_REJECTION_KIND_LABELS: Record<GrantRejectionKind, string> = {
  not_a_grant: 'Not a grant a team can apply for',
  aggregator_list: 'A list of several grants, not one grant',
  announcement: 'Press release, award news or a sponsor wall',
  legislative: 'A bill, a statute or a legislator announcing a programme',
  expired: 'Ended for good, not a recurring grant between cycles',
  duplicate: 'Already in the directory',
  out_of_scope: 'Real funding, but not for youth STEM teams',
}
