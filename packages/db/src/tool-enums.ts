/**
 * What a listing in the tools catalogue can be, and how each type is labelled
 * and weighted. Zero imports, on purpose: the search filter row is a client
 * component and must not drag the postgres client into the browser bundle.
 */
/**
 * What a listing in the tools catalogue can be.
 *
 * NO 'offseason_event'. An off-season competition is a row in event_listings,
 * with a date, a venue, a cost, a capacity and a registration state, and the
 * events vertical is built to show exactly that. A tool row is a page ABOUT an
 * event and carries none of it, so the two were the same competition described
 * twice, worse the second time.
 *
 * It also put things in front of readers that are not tools at all. BUNNYBOTS
 * led Rookie Friendly on the home page, and "Duel on the Delaware 2010" sat in
 * the catalogue as a listing. The classifier was being asked to sort event
 * pages out of the crawl and offered a bucket to put them in, in the same
 * prompt, so it used it.
 *
 * This list is the single vocabulary. The admin editor and the classifier both
 * import it, and tests/unit/tool-type-vocabulary.test.ts fails if a fourth copy
 * appears.
 */
export const TOOL_TYPES = [
  'web_app',
  'desktop_app',
  'mobile_app',
  'calculator',
  'spreadsheet',
  'github_project',
  'browser_extension',
  'api',
  'resource',
  'vendor_website',
  'other',
] as const
export type ToolType = (typeof TOOL_TYPES)[number]

/**
 * One label per tool type, for any screen that holds a slug and has to print it.
 *
 * Kept beside the tuple so a type added above cannot be rendered as a raw slug,
 * and so a filter row cannot quietly go short. The search filters carried their
 * own list of seven and 29 published tools were reachable by no chip at all.
 */
export const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  web_app: 'Web App',
  desktop_app: 'Desktop',
  mobile_app: 'Mobile App',
  calculator: 'Calculator',
  spreadsheet: 'Spreadsheet',
  github_project: 'GitHub Project',
  browser_extension: 'Browser Extension',
  api: 'API',
  resource: 'Resource',
  vendor_website: 'Vendor Site',
  other: 'Other',
}

/** Content-type ranking weight (0–1). */
export const TOOL_TYPE_WEIGHTS: Record<ToolType, number> = {
  web_app: 1.0,
  calculator: 1.0,
  desktop_app: 0.9,
  github_project: 0.85,
  browser_extension: 0.8,
  mobile_app: 0.8,
  api: 0.7,
  spreadsheet: 0.4,
  resource: 0.35,
  vendor_website: 0.5,
  other: 0.5,
}
