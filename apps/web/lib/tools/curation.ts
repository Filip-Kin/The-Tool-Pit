/**
 * First-party detection and the Discover exclusion set.
 *
 * Both are derived at query and render time. Neither needs a column: a tool is
 * ours when its homepage points at frc.tools, and a giant is a giant by name.
 * Keeping them here, in plain lists a person can edit, is the whole point.
 */

/** Tools whose homepage lives here are built and hosted on frc.tools. */
export const FIRST_PARTY_HOST = 'frc.tools'

/**
 * True when a URL's host is frc.tools or a subdomain of it.
 *
 * Parses the host rather than substring-matching the string, so
 * `frc.tools.phishing.io` and `notfrc.tools` do not read as first-party.
 */
export function isFirstPartyUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === FIRST_PARTY_HOST || host.endsWith(`.${FIRST_PARTY_HOST}`)
}

/**
 * The eternal giants Discover leaves out.
 *
 * WPILib, PathPlanner, ReCalc, The Blue Alliance and their peers outscore every
 * newer tool forever, because everyone uses them and there is no alternative.
 * Leading the front page with them is the link-farm feel the tools vertical got
 * burned by: a veteran already has all of these bookmarked. Discover drops them
 * so the row surfaces rising work instead.
 *
 * They are NOT downranked anywhere else. Popular, search, Browse by Program and
 * their own detail pages still list them in full. This is one row's guest list,
 * not a global demotion. Add or remove a slug here and only Discover changes.
 */
export const DISCOVER_EXCLUDED_SLUGS: readonly string[] = [
  'wpilib',
  'robotpy-wpilib',
  'pathplanner',
  'choreo',
  'choreo-2026',
  'photonvision',
  'limelight',
  'advantagescope',
  'advantagekit',
  'recalc',
  'the-blue-alliance',
  'first-inspires-dashboard',
]
