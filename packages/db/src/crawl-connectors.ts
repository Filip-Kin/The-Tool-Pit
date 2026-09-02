/**
 * The tool-crawl connectors, by name. Zero imports, on purpose.
 *
 * This list existed in four places and no two agreed. The worker's registry had
 * eight. The admin's trigger allowlist had six. The admin Sources screen had
 * six, grouped under names that are not connector names. A doc comment in
 * schema/sources.ts had a fourth list naming `github`, `tba` and
 * `official_first`, none of which has ever been written to the column.
 *
 * The two missing everywhere but the worker were spectrum_cad and
 * github_team_code, which are the two LARGEST sources in the catalogue: 381 and
 * 290 rows against Chief Delphi's 271. Neither could be triggered from the
 * admin screen, and `triggerCrawl('github_team_code')` answered "Unknown
 * connector", while a comment in the worker said it is triggered by hand from
 * exactly that screen.
 *
 * The key IS the value stored in tool_sources.source_type. That is what made
 * the Sources dashboard wrong as well as short: it grouped by invented names
 * like `github`, so those cards read 0 forever and the screen accounted for 299
 * of 1229 rows.
 */
export interface CrawlConnector {
  /** Matches the worker's registry key AND tool_sources.source_type. */
  key: string
  label: string
  description: string
  /** False for a connector that is only ever run by hand. */
  scheduled: boolean
}

export const CRAWL_CONNECTORS: readonly CrawlConnector[] = [
  {
    key: 'fta_tools',
    label: 'FTA Tools',
    description: 'Scraped from fta.tools',
    scheduled: true,
  },
  {
    key: 'volunteer_systems',
    label: 'Volunteer Systems',
    description: 'Volunteer-facing tools from official channels',
    scheduled: true,
  },
  {
    key: 'github_topics',
    label: 'GitHub Topics',
    description: 'Repos tagged with frc, ftc or fll topics',
    scheduled: true,
  },
  {
    key: 'awesome_list',
    label: 'Awesome List',
    description: 'Entries from the community awesome-FRC lists',
    scheduled: true,
  },
  {
    key: 'chief_delphi',
    label: 'Chief Delphi',
    description: 'Tools announced in forum threads',
    scheduled: true,
  },
  {
    key: 'tba_teams',
    label: 'TBA Teams',
    description: 'Team GitHub orgs discovered through The Blue Alliance',
    scheduled: true,
  },
  {
    key: 'spectrum_cad',
    label: 'Spectrum CAD',
    description: "Team CAD releases from Spectrum 3847's directory",
    scheduled: true,
  },
  {
    key: 'github_team_code',
    label: 'GitHub Team Code',
    description: 'Team season repos found by GitHub search',
    // One sweep is a few hundred search requests and can return thousands of
    // candidates, so it is triggered by hand rather than firing on deploy.
    scheduled: false,
  },
] as const

/** Every connector key. */
export const CRAWL_CONNECTOR_KEYS: readonly string[] = CRAWL_CONNECTORS.map((c) => c.key)

/**
 * Source types that are not a connector: a row somebody entered themselves.
 * Stored in the same column, so the Sources screen has to account for them.
 */
export const NON_CONNECTOR_SOURCE_TYPES: readonly CrawlConnector[] = [
  {
    key: 'manual',
    label: 'Manual',
    description: 'Added by an admin by hand',
    scheduled: false,
  },
  {
    key: 'submission',
    label: 'User Submissions',
    description: 'Submitted through the public form',
    scheduled: false,
  },
] as const
