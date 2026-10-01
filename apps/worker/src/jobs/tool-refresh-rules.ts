/**
 * The rules behind the monthly homepage refresh (jobs/tool-refresh.ts), kept
 * pure and free of the database and Redis so every one of them is tested.
 *
 * WHAT THE REFRESH IS FOR. freshness.ts, popularity.ts and link-checker.ts
 * keep a listing with a GitHub repo current. A listing with only a homepage
 * had nothing: its name and description were whatever the crawler read on the
 * day it arrived, and a site that died stayed listed. The refresh re-reads that
 * homepage once a month and applies what the site now says about itself.
 *
 * WHAT IT COMPARES AGAINST. Not the row. The row's summary is usually the
 * classifier's sentence, not the page's meta description, so comparing the
 * page against the row would "change" nearly every listing on the first run
 * and replace a written summary with raw marketing copy. The refresh compares
 * the page against what the SAME extractor read off the same page last month.
 * A difference there is the site changing, which is the only thing this job is
 * entitled to act on. The first run therefore records a baseline and changes
 * nothing.
 */
import { createHash } from 'node:crypto'
import { isHumanEdited } from '@the-tool-pit/db'

// #region months

/** 'YYYY-MM' in UTC. The unit the strike rule counts in. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The month before a 'YYYY-MM' key. */
export function previousMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 2, 1))
  return monthKey(d)
}

// #endregion

// #region generic names

/**
 * Whole titles that name a page state or a framework default, never a product.
 * Matched against the full, trimmed, lower-cased title.
 */
const GENERIC_TITLES = new Set([
  'home', 'homepage', 'home page', 'index', 'index.html', 'login', 'log in', 'sign in', 'signin',
  'sign up', 'welcome', 'untitled', 'untitled document', 'untitled page', 'dashboard', 'app',
  'loading', 'loading...', 'error', 'page', 'document', 'default', 'main', 'start', 'new tab',
  'react app', 'vite app', 'vite + react', 'vite + react + ts', 'next.js', 'create next app',
  'svelte app', 'sveltekit app', 'vue app', 'angular', 'expo', 'flutter demo', 'web',
  'coming soon', 'under construction', 'maintenance', 'site maintenance', 'under maintenance',
  'chrome web store', 'google sites', 'google drive', 'google docs', 'notion', 'wix', 'squarespace',
  'redirecting', 'redirecting...', 'moved', 'moved permanently', 'not found', 'page not found',
  'forbidden', 'access denied', 'unauthorized', 'bad gateway', 'service unavailable',
  'just a moment', 'just a moment...', 'attention required', 'client challenge',
])

/**
 * Titles that open with an error or wall, whatever follows. A bare status code
 * only counts alone or followed by its reason, because "254 Scouting" is a team.
 */
const GENERIC_PREFIX_RE = /^(?:[45]\d\d\s*(?:$|[-:|]?\s*(?:not found|forbidden|error|unauthorized|gone|bad gateway|bad request|service unavailable|internal server error|gateway timeout)\b)|error\b|oops\b|page not found|not found\b|access denied|forbidden\b|just a moment|attention required|you are being redirected|index of \/)/i

/**
 * Would applying this name make the listing worse?
 *
 * True for an empty or near-empty title, a one-word title that names a page
 * rather than a product ("Home", "Login", "Index"), a framework placeholder
 * ("React App"), an error or wall title, and any hosting or parking page title.
 * A one-word title that is a real product name ("Choreo", "CADProps") passes.
 */
export function isGenericName(name: string | null | undefined): boolean {
  const t = (name ?? '').replace(/\s+/g, ' ').trim()
  if (t.length < 2) return true
  const lower = t.toLowerCase()
  if (GENERIC_TITLES.has(lower)) return true
  if (GENERIC_PREFIX_RE.test(t)) return true
  if (parkingTitleReason(t)) return true
  // A bare hostname is a fallback, not a name.
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(t) && !/\s/.test(t)) return true
  return false
}

// #endregion

// #region parking and hosting pages

/** Page titles a registrar, a parking service or a host puts on a site that is gone. */
const PARKING_TITLE_PATTERNS: Array<[RegExp, string]> = [
  [/\bdomain (?:name )?(?:is |may be )?for sale\b/i, 'domain for sale'],
  [/\bfor sale\b.*\bdomain\b|\bbuy (?:this|the) domain\b|^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s+(?:is |may be )?(?:for sale|available)\b/i, 'domain for sale'],
  [/\b(?:domain|website) (?:has )?expired\b|\bexpired domain\b/i, 'domain expired'],
  [/\bparked (?:domain|free|by)\b|\bdomain (?:is )?parked\b|\bthis domain is parked\b/i, 'parked domain'],
  [/\baccount (?:has been |is )?suspended\b|\bsuspended (?:account|page|site|website)\b|\bwebsite suspended\b/i, 'account suspended'],
  [/^site not found\b|\bsite not found ·|\bno such app\b|\bdeployment[_ ]not[_ ]found\b|\bthere isn['’]t a github pages site here\b/i, 'site not found'],
  [/\bthis site (?:was|has been) (?:deleted|removed|disabled)\b|\bsite (?:is )?(?:no longer|not) available\b/i, 'site removed'],
  [/\bwebsite (?:is )?(?:coming soon|under construction)\b.*\b(?:hosting|registered|domain)\b/i, 'placeholder page'],
  [/\b(?:hugedomains|sedo|afternic|dan\.com|bodis|parkingcrew|above\.com|domain ?parking)\b/i, 'parked domain'],
]

/** Body text markers that only count on a thin page; a real page can mention any of them once. */
const PARKING_BODY_PATTERNS: Array<[RegExp, string]> = [
  ...PARKING_TITLE_PATTERNS,
  [/\bthis domain (?:name )?(?:is|may be) (?:for sale|available)\b/i, 'domain for sale'],
  [/\binquire (?:about|for) (?:this|the) domain\b|\bmake an offer\b.*\bdomain\b/i, 'domain for sale'],
  [/\brelated (?:searches|links)\b.*\bsponsored\b|\bsponsored listings\b/i, 'parked domain'],
  [/\bthis account has been suspended\b|\bcontact (?:your|the) hosting provider\b/i, 'account suspended'],
  [/\bweb hosting\b.*\b(?:default|placeholder) page\b|\bdefault web page\b|\bcongratulations[!,]? your (?:website|domain|hosting)\b/i, 'placeholder page'],
]

/** Hosts a dead domain redirects to. Landing on one is the same verdict as a parking page. */
const PARKING_HOSTS = [
  'hugedomains.com', 'sedo.com', 'sedoparking.com', 'dan.com', 'afternic.com', 'bodis.com',
  'parkingcrew.net', 'above.com', 'domainmarket.com', 'buydomains.com', 'undeveloped.com',
  'squadhelp.com', 'atom.com', 'porkbun.com', 'namebright.com', 'parklogic.com',
]

/** Visible text under this many characters is a "thin" page. Same bar as relay-fetch.ts. */
const THIN_TEXT_CHARS = 1500

export function parkingTitleReason(title: string): string | null {
  for (const [re, reason] of PARKING_TITLE_PATTERNS) if (re.test(title)) return reason
  return null
}

function hostIs(url: string, hosts: readonly string[]): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return hosts.some((p) => h === p || h.endsWith(`.${p}`))
  } catch {
    return false
  }
}

/**
 * Why this page is a parking, for-sale, suspended or host-placeholder page,
 * or null when it looks like a real site.
 *
 * The title decides on its own. The body only counts when the page is thin,
 * so a real tool page that says "make an offer" somewhere in a long article
 * is not caught.
 */
export function parkingReason(input: { title?: string | null; text?: string | null; finalUrl?: string | null }): string | null {
  if (input.finalUrl && hostIs(input.finalUrl, PARKING_HOSTS)) return 'parked domain'
  const title = (input.title ?? '').trim()
  if (title) {
    const r = parkingTitleReason(title)
    if (r) return r
  }
  const text = (input.text ?? '').replace(/\s+/g, ' ').trim()
  if (text && text.length < THIN_TEXT_CHARS) {
    for (const [re, reason] of PARKING_BODY_PATTERNS) if (re.test(text)) return reason
  }
  return null
}

// #endregion

// #region dead site verdict

/** What one fetch of a homepage told us. */
export type FetchVerdict =
  /** A real page. Read it. */
  | { kind: 'ok' }
  /** Gone: 404, 410, DNS failure, or a parking page. One strike. */
  | { kind: 'dead'; reason: string }
  /** Refused even through the relay (401/403/429/503, a challenge). Alive, not ours to read. */
  | { kind: 'wall'; reason: string }
  /** Anything else (a 500, a timeout). No evidence either way. */
  | { kind: 'unknown'; reason: string }

/** Statuses that say the page is not there. */
const GONE_STATUS = new Set([404, 410])
/** Statuses that say the page is there and refused us. */
const WALL_STATUS = new Set([401, 403, 406, 429, 503])

/**
 * Classify one fetch. `dnsFailed` is set when the request threw and a lookup
 * of the host returned ENOTFOUND; any other thrown error is `unknown`, since a
 * timeout or a refused connection on one night is not a dead site.
 */
export function fetchVerdict(input: {
  status?: number | null
  dnsFailed?: boolean
  error?: string | null
  refusal?: string | null
  title?: string | null
  text?: string | null
  finalUrl?: string | null
}): FetchVerdict {
  if (input.dnsFailed) return { kind: 'dead', reason: 'DNS lookup failed' }
  if (input.status == null) return { kind: 'unknown', reason: input.error ?? 'no response' }
  if (GONE_STATUS.has(input.status)) return { kind: 'dead', reason: `HTTP ${input.status}` }
  if (WALL_STATUS.has(input.status)) return { kind: 'wall', reason: `HTTP ${input.status}` }
  if (input.status < 200 || input.status >= 300) return { kind: 'unknown', reason: `HTTP ${input.status}` }
  const parked = parkingReason(input)
  if (parked) return { kind: 'dead', reason: parked }
  if (input.refusal) return { kind: 'wall', reason: input.refusal }
  return { kind: 'ok' }
}

// #endregion

// #region two-strike rule

export interface Strike {
  /** 'YYYY-MM' of the run that recorded it. */
  month: string
  reason: string
}

/**
 * A dead result this month: record a strike, or suppress.
 *
 * Suppress only when last month's run ALSO found the site dead. A strike from
 * two months ago does not count (the site was fine or unreadable in between),
 * and a strike from this same month does not count either, so re-running the
 * job by hand cannot turn one bad night into a removal.
 */
export function strikeDecision(prev: Strike | null, month: string, reason: string): { action: 'strike' | 'suppress'; strike: Strike } {
  if (prev && prev.month === previousMonthKey(month)) {
    return { action: 'suppress', strike: { month, reason } }
  }
  if (prev && prev.month === month) return { action: 'strike', strike: prev }
  return { action: 'strike', strike: { month, reason } }
}

// #endregion

// #region applying changes

/** What the extractor read off the homepage. Stored monthly as the baseline. */
export interface PageSnapshot {
  name: string
  description: string
}

export interface ToolRow {
  name: string
  summary: string | null
  description: string | null
  humanEditedFields: readonly string[] | null
}

export interface FieldChange {
  field: 'name' | 'summary' | 'description'
  from: string
  to: string
}

/** Same split publish.ts makes on intake: summary up to 300 chars, description the full text when longer. */
const SUMMARY_MAX = 300

/**
 * What to write to the row, given last month's read of the page and this one.
 *
 * Rules, each tested:
 * - No baseline (first run for this tool): nothing. The read becomes the baseline.
 * - Only a field that CHANGED ON THE PAGE since last month is touched.
 * - A field a person claimed is never written.
 * - Never cleared to empty: an empty read is ignored.
 * - A generic or parking-page name is never applied.
 * - The long description is cleared only when it was the crawler's copy of
 *   the old page text, now superseded by a shorter one in the summary.
 */
export function planToolUpdate(row: ToolRow, prev: PageSnapshot | null, fresh: PageSnapshot): {
  set: Partial<Pick<ToolRow, 'name' | 'summary' | 'description'>>
  changes: FieldChange[]
} {
  const set: Partial<Pick<ToolRow, 'name' | 'summary' | 'description'>> = {}
  const changes: FieldChange[] = []
  if (!prev) return { set, changes }
  const claimed = (k: string) => isHumanEdited(row.humanEditedFields, k)

  const name = fresh.name.replace(/\s+/g, ' ').trim()
  if (name && name !== prev.name.trim() && name !== row.name && !isGenericName(name) && !claimed('name')) {
    set.name = name
    changes.push({ field: 'name', from: row.name, to: name })
  }

  const desc = fresh.description.trim()
  if (desc && desc !== prev.description.trim()) {
    const summary = desc.slice(0, SUMMARY_MAX)
    if (!claimed('summary') && summary !== (row.summary ?? '')) {
      set.summary = summary
      changes.push({ field: 'summary', from: row.summary ?? '', to: summary })
    }
    if (!claimed('description')) {
      if (desc.length > SUMMARY_MAX) {
        if (desc !== (row.description ?? '')) {
          set.description = desc
          changes.push({ field: 'description', from: row.description ?? '', to: desc })
        }
      } else if (row.description && row.description.trim() === prev.description.trim()) {
        // The long text was the old page's description, copied in on intake.
        // The new page text is short and now lives in the summary.
        set.description = null
        changes.push({ field: 'description', from: row.description, to: '' })
      }
    }
  }

  return { set, changes }
}

/** Hash of what a month-to-month comparison cares about. Whitespace-insensitive. */
export function pageHash(parts: { title?: string | null; description?: string | null; text?: string | null }): string {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  return createHash('sha256')
    .update(`${norm(parts.title)}\n${norm(parts.description)}\n${norm(parts.text)}`)
    .digest('hex')
}

// #endregion

// #region discord facts

export interface ToolRunResult {
  name: string
  changes: FieldChange[]
  suppressed?: { reason: string }
}

/** Discord's caps: 25 fields an embed, 1024 characters a value. */
const MAX_FACTS = 24
const SIDE_MAX = 120

function clip(s: string, max = SIDE_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return '(empty)'
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const FIELD_TAG: Record<FieldChange['field'], string> = {
  name: 'Name',
  summary: 'Summary',
  description: 'Description',
}

/**
 * One row per change, labelled with the tool's name, for the one summary post
 * a run makes. Suppressions first: they are the ones a moderator may want to
 * reverse.
 */
export function runFacts(results: ToolRunResult[]): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  for (const r of results) if (r.suppressed) rows.push({ label: clip(r.name, 100), value: 'Suppressed: site gone' })
  for (const r of results) {
    for (const c of r.changes) {
      rows.push({ label: clip(r.name, 100), value: `${FIELD_TAG[c.field]}: ${clip(c.from)} → ${clip(c.to)}` })
    }
  }
  if (rows.length <= MAX_FACTS) return rows
  const kept = rows.slice(0, MAX_FACTS - 1)
  kept.push({ label: 'More', value: `+${rows.length - kept.length}` })
  return kept
}

// #endregion
