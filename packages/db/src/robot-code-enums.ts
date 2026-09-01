/**
 * Robot Code / CAD submission enum-like value tuples. Kept in a
 * ZERO-DEPENDENCY module (no drizzle, no db client) so the submit form, which
 * is a client component, can import the value tuple without dragging postgres
 * (net/tls/fs) into the browser bundle. The schema in ./schema/submissions.ts
 * re-exports these.
 *
 * There is deliberately no program tuple here. The three FIRST programs are
 * already FIELD_PROGRAMS in ../field-enums, same slugs as the `programs` table,
 * and a fourth copy of ['frc', 'ftc', 'fll'] is a fourth thing to keep in step.
 */

/**
 * What the submitter is pointing us at. This is the axis the archive is indexed
 * on alongside team and season, and it is the one a classifier gets wrong most
 * often: a repo of Onshape exports and a repo of Java both look like "a team
 * repo" from the outside. So the submitter states it.
 *   code - the team's robot code
 *   cad  - the team's robot CAD
 */
export const ARTIFACT_KINDS = ['code', 'cad'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * Oldest season we accept. 1992 is the first FRC season, which is earlier than
 * anything a team could plausibly have on GitHub, so the floor only exists to
 * catch a typo like 202 or 20226.
 */
export const MIN_SEASON_YEAR = 1992

/**
 * The season a submission defaults to: the calendar year.
 *
 * A season is named for the year its game is played, so from kickoff in January
 * through to the end of the year the calendar year IS the current season, and
 * for the few days before kickoff it is the season just finished, which is
 * still the one most uploads belong to. Defaulting a year ahead would offer a
 * season whose game does not exist yet.
 */
export function currentSeasonYear(now: Date = new Date()): number {
  return now.getFullYear()
}

/** Upper bound: next season, for a team publishing before kickoff. */
export function maxSeasonYear(now: Date = new Date()): number {
  return currentSeasonYear(now) + 1
}
