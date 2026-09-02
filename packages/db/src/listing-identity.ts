/**
 * Is this the same listing, or a different one that reads alike?
 *
 * Shared because the answer was given twice and differently. The ingest
 * pipeline auto-skipped a candidate whose name scored above 0.7 against any
 * existing tool, and the admin duplicate panel only showed a pair above 0.85.
 * Between those two numbers is a band where the crawler threw work away and
 * nothing on any screen said so.
 *
 * THE ARCHIVE IS SUPPOSED TO HOLD EVERY SEASON. "1511 2023 Robot Code" and
 * "1511 2026 Robot Code" are both wanted, separately, and they score 0.826
 * against each other. So do "3407 2023 Robot Code" and "3405 2023 Robot Code",
 * which are two different teams. Name similarity alone cannot tell any of these
 * apart, because the part that differs is four characters long and the part
 * they share is the rest of the string.
 *
 * Two rules, and the identity rule wins. A different team is a different
 * listing. A different season is a different listing. Neither is negotiable at
 * any similarity score, because the numbers are the whole content of the name.
 * Only when the team and the season agree, or are unknown, does the score get a
 * say.
 */

/** The one threshold. Above this, two names are close enough to be worth a look. */
export const DUPLICATE_NAME_SIMILARITY = 0.85

/** FRC seasons the archive can plausibly hold. Outside this it is a team number. */
const FIRST_SEASON = 2000
const LAST_SEASON = 2030

/**
 * The season a listing name refers to, or null when the name does not say.
 *
 * Null is a real answer and is common: most tools are not seasonal. It means
 * "no opinion", never "not this season", so a null on either side leaves the
 * decision to the similarity score.
 */
export function seasonYearFromName(name: string): number | null {
  const years = [...name.matchAll(/\b(\d{4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= FIRST_SEASON && n <= LAST_SEASON)
  if (years.length === 0) return null

  // "2023 2024 Robot Code" is team 2023's 2024 season, not the other way round.
  // The archive writes the team first and the season second, and a team number
  // that happens to fall in the season range is the only case where both
  // numbers qualify. Taking the last one gets that case right and changes
  // nothing for every other name, which has one.
  return years[years.length - 1]
}

/**
 * The team a listing name refers to, or null.
 *
 * An explicit "Team 254" or "frc254" wins over a bare leading number, because
 * the bare number is a guess and the label is a statement.
 */
export function teamNumberFromName(name: string): number | null {
  const labelled = name.match(/\b(?:team|frc|ftc)[\s-]*(\d{1,5})\b/i)
  if (labelled) return Number(labelled[1])

  const season = seasonYearFromName(name)
  const leading = name.match(/^\s*(\d{1,5})\b/)
  if (leading) {
    const n = Number(leading[1])
    // A name that is only a year ("2024 Robot Code") names a season, not a team.
    if (n !== season) return n
  }
  return null
}

/**
 * Two facts that make listings different whatever their names score.
 *
 * Takes what each side knows. The stored side passes its own columns, which the
 * classifier filled and a human may have corrected; the incoming side has only
 * a title, so it parses. Unknown on either side is not a disagreement.
 */
export interface ListingIdentity {
  teamNumber: number | null
  seasonYear: number | null
}

export function identityFromName(name: string): ListingIdentity {
  return { teamNumber: teamNumberFromName(name), seasonYear: seasonYearFromName(name) }
}

/**
 * True when these two cannot be the same listing, whatever the similarity.
 *
 * Deliberately conservative: it only ever answers "definitely different", and
 * says nothing when either side is unknown. A wrong "different" costs a
 * duplicate row a moderator can merge. A wrong "same" silently deletes a
 * season that nobody knows is missing.
 */
export function definitelyDifferentListings(a: ListingIdentity, b: ListingIdentity): boolean {
  if (a.teamNumber !== null && b.teamNumber !== null && a.teamNumber !== b.teamNumber) return true
  if (a.seasonYear !== null && b.seasonYear !== null && a.seasonYear !== b.seasonYear) return true
  return false
}
