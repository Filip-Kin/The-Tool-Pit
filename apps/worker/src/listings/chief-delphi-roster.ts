/**
 * An off-season event's roster read out of a Chief Delphi thread.
 *
 * WHY NOT THE STORED DOM PARSER. Plenty of off-season organisers never build a
 * team-list page: they start a Chief Delphi thread and post the updated roster
 * as a NEW reply every time it changes. SCRIW XV (topic 523187) is the model
 * case: the topic author posts a "# | Team Name | Hometown" table in posts 1-6
 * and again in post 9, and post 9 is the current one. A parser written once
 * against the page DOM would keep reading post 1 forever, and the rendered
 * thread only holds the first ~20 posts anyway. So this path picks the newest
 * post that carries a roster, every run, and reads that one post.
 *
 * DISCOURSE JSON, NO BROWSER. /t/{id}.json is public and carries each post's
 * author, number and `cooked` HTML. It only includes the first ~20 posts; the
 * full id list is post_stream.stream, and the rest come from
 * /t/{id}/posts.json?post_ids[]=... in batches.
 *
 * DETERMINISTIC FIRST. Organisers post a markdown table or a list, both of which
 * read without a model: find the team-number column (or the leading number on a
 * list line), read the name beside it, and honour a "WAITING LIST" label row or
 * heading. Only a post that clearly holds a roster in a shape we cannot read
 * falls back to one model call over that post's HTML. Numbers in prose are never
 * read as a roster: post 9 says "4083 was very kind to step aside and let us
 * move 11167 and 281 into the field", which names three teams and is not a list.
 */
import { parse, HTMLElement } from 'node-html-parser'
import type { RosterTeam } from '@the-tool-pit/db'
import { delay, politeFetch } from '../connectors/base.js'
import { anthropic, hasAnthropicCredentials } from '../anthropic.js'
import { normaliseTeams, slotIndicesLeaked } from './team-list-parser.js'

// #region url

const CD_HOST = /^(?:www\.)?chiefdelphi\.com$/i
const CD_BASE = 'https://www.chiefdelphi.com'

/**
 * The topic id of a Chief Delphi thread URL, or null when it is not one.
 *
 * Accepts every shape a person pastes: /t/slug/523187, /t/slug/523187/9,
 * /t/523187, /t/523187/9, and the .json form.
 */
export function chiefDelphiTopicId(url: string | null | undefined): number | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (!CD_HOST.test(u.hostname)) return null
  const segs = u.pathname.split('/').filter(Boolean).map((s) => s.replace(/\.json$/i, ''))
  if (segs[0] !== 't' || segs.length < 2) return null
  // /t/523187[/9]: the first segment after /t is the id. /t/slug/523187[/9]: the second.
  const idSeg = /^\d+$/.test(segs[1]) ? segs[1] : segs[2]
  if (!idSeg || !/^\d+$/.test(idSeg)) return null
  const id = Number(idSeg)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function isChiefDelphiThread(url: string | null | undefined): boolean {
  return chiefDelphiTopicId(url) !== null
}

export function chiefDelphiPostUrl(topicId: number, postNumber: number): string {
  return `${CD_BASE}/t/${topicId}/${postNumber}`
}

// #endregion

// #region fetch

export interface ThreadPost {
  id: number
  post_number: number
  username: string
  created_at: string
  cooked: string
  hidden?: boolean
  deleted_at?: string | null
}

export interface ThreadData {
  topicId: number
  title: string
  /** The topic author, who is usually the organiser posting the roster. */
  author: string | null
  posts: ThreadPost[]
}

/** A Discourse topic JSON, only the fields read here. */
interface TopicJson {
  id?: number
  title?: string
  details?: { created_by?: { username?: string } }
  post_stream?: { stream?: number[]; posts?: ThreadPost[] }
}

// Chief Delphi serves JSON to a plain bot UA too, but a browser UA is what the
// rest of the site sees and what they rate-limit least.
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const BATCH = 20
/**
 * The newest roster wins, so on a very long thread only the tail matters. The
 * first page (post 1 onwards) always comes with the topic JSON; beyond that we
 * read at most this many of the newest posts.
 */
const MAX_TAIL_POSTS = 200

export type JsonFetcher = (url: string) => Promise<unknown>

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await politeFetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/**
 * Every post of a thread (first page plus the newest MAX_TAIL_POSTS), oldest
 * first. The fetcher is injectable so the batching is testable offline.
 */
export async function fetchThreadPosts(topicId: number, fetchJson: JsonFetcher = defaultFetchJson): Promise<ThreadData> {
  const topic = (await fetchJson(`${CD_BASE}/t/${topicId}.json`)) as TopicJson
  const loaded = topic.post_stream?.posts ?? []
  const stream = topic.post_stream?.stream ?? []
  const byId = new Map<number, ThreadPost>(loaded.map((p) => [p.id, p]))

  const missing = stream.filter((id) => !byId.has(id)).slice(-MAX_TAIL_POSTS)
  for (let i = 0; i < missing.length; i += BATCH) {
    const ids = missing.slice(i, i + BATCH)
    const qs = ids.map((id) => `post_ids[]=${id}`).join('&')
    const page = (await fetchJson(`${CD_BASE}/t/${topicId}/posts.json?${qs}`)) as TopicJson
    for (const p of page.post_stream?.posts ?? []) byId.set(p.id, p)
    if (i + BATCH < missing.length) await delay(300)
  }

  const author = topic.details?.created_by?.username ?? loaded.find((p) => p.post_number === 1)?.username ?? null
  return {
    topicId,
    title: topic.title ?? '',
    author,
    posts: [...byId.values()].sort((a, b) => a.post_number - b.post_number),
  }
}

// #endregion

// #region reading one post

const WAITLIST_RE = /\bwait(?:ing)?[\s-]*list(?:ed)?\b|\balternates?\b/i
/** A label that switches a table back to the field after a waitlist block. */
const FIELD_LABEL_RE = /^(?:registered|confirmed|accepted|competing|attending|field)(?:\s+teams?)?:?$/i
/** "99xx", "10xxx", "10###", "TBD", "TBA", "pending", "?" - a number not issued yet. */
const PLACEHOLDER_RE = /^(?:\d{0,4}[x#?]{1,4}|tbd|tba|pending|\?+)$/i
/** Header text of a team-number column. "#" is a team number on CD tables; a slot column is caught by slotIndicesLeaked. */
const NUMBER_HEADER_RE = /^(?:#|no\.?|num(?:ber)?|team\s*(?:#|no\.?|num(?:ber)?)|frc\s*(?:team\s*)?(?:#|no\.?|num(?:ber)?)?)$/i
const TEAM_HEADER_RE = /^teams?$/i
const NAME_HEADER_RE = /\bname\b|\bnickname\b/i

interface RawEntry {
  number: number | null
  robot: string | null
  name?: string
  waitlisted: boolean
}

const clean = (s: string): string =>
  s
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A cell or line that is a team entry: "254", "4611 B", "4611B", "4611 #2",
 * "Team 254", "254 - The Cheesy Poofs", "254 The Cheesy Poofs".
 *
 * A robot letter counts only when it stands alone (end of text, or a separator
 * after it), so "254 A Team Name" is team 254 named "A Team Name", not robot A.
 */
export function parseEntryText(text: string): { number: number; robot: string | null; name?: string } | null {
  const t = clean(text)
  // "99xx" or "10xxx" is a placeholder, not team 99; "254th" is not a team at all.
  if (PLACEHOLDER_RE.test(t.split(' ')[0]) || /^(?:team\s*)?\d{1,5}[A-Za-z#?]{2,}/i.test(t)) return null
  const m = t.match(/^(?:team\s*)?(\d{1,5})(?:\s*(?:#\s*(\d)|\(([A-Za-z]|\d)\)|([A-Za-z])(?=$|\s*[-–—:|,(])))?(?:\s*[-–—:|,]?\s*(.*))?$/i)
  if (!m) return null
  const number = Number(m[1])
  if (!Number.isInteger(number) || number < 1 || number > 20_000) return null
  const marker = m[2] ?? m[3] ?? m[4] ?? null
  const robot = marker ? coerceRobotMarker(marker) : null
  const rest = clean(m[5] ?? '')
  return { number, robot, ...(rest ? { name: rest } : {}) }
}

function coerceRobotMarker(raw: string): string | null {
  if (/^\d$/.test(raw)) {
    const n = Number(raw)
    return n <= 1 ? null : String.fromCharCode(64 + n)
  }
  const letter = raw.toUpperCase()
  return letter === 'A' ? null : letter
}

/**
 * The team behind a placeholder number, read from its name cell. "3506 B-Team"
 * is team 3506's second robot; "Iron Spiders (10290)" is team 10290. Anything
 * else stays a name-only team and gets a 9970-9999 number later.
 */
function resolvePlaceholderName(name: string): { number: number | null; robot: string | null; name?: string } {
  const bTeam = name.match(/^(\d{1,5})\s*(?:'s\s*)?[-\s]*([B-Z])[\s-]*(?:team|robot|bot)\b/i)
  if (bTeam) return { number: Number(bTeam[1]), robot: bTeam[2].toUpperCase(), name }
  const second = name.match(/^(\d{1,5})\s+(?:second|2nd)\s+(?:team|robot)\b/i)
  if (second) return { number: Number(second[1]), robot: 'B', name }
  const paren = name.match(/\((\d{3,5})\)/)
  if (paren) {
    const rest = clean(name.replace(paren[0], ''))
    return { number: Number(paren[1]), robot: null, ...(rest ? { name: rest } : {}) }
  }
  return { number: null, robot: null, name }
}

/** Is this short text a label that opens a waitlist ("WAITING LIST", "Waitlist:")? Prose is not. */
function isWaitlistLabel(text: string): boolean {
  const t = clean(text)
  return t.length > 0 && t.length <= 40 && WAITLIST_RE.test(t)
}

/** Nearest label before a block (a heading, or a short line); true when it opens a waitlist. */
function underWaitlistLabel(block: HTMLElement): boolean {
  let el: HTMLElement | null = block
  // A Discourse table sits inside <div class="md-table">; its siblings are the post's paragraphs.
  if (el.parentNode && (el.parentNode as HTMLElement).classList?.contains('md-table')) el = el.parentNode as HTMLElement
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    const tag = sib.tagName?.toLowerCase()
    if (tag === 'table' || tag === 'ul' || tag === 'ol' || sib.classList?.contains('md-table')) return false
    const text = clean(sib.text)
    if (!text) continue
    if (/^h[1-6]$/.test(tag) || text.length <= 60) return isWaitlistLabel(text)
    // A long paragraph is prose explaining something; it labels nothing. Keep looking.
  }
  return false
}

function cellsOf(row: HTMLElement): string[] {
  return row.querySelectorAll('th, td').map((c) => clean(c.text))
}

/** One table read by the column that holds team numbers. */
function readTable(table: HTMLElement): RawEntry[] {
  const rows = table.querySelectorAll('tr')
  if (rows.length === 0) return []

  let header: string[] | null = null
  let body = rows
  const first = rows[0]
  if (first.querySelector('th') || first.parentNode?.tagName?.toLowerCase() === 'thead') {
    header = cellsOf(first)
    body = rows.slice(1)
  }
  const grid = body.map(cellsOf)
  const width = Math.max(0, ...grid.map((r) => r.length), header?.length ?? 0)
  if (width === 0) return []

  // Columns to try as the number column, header-named first, then every other.
  const order: number[] = []
  if (header) {
    header.forEach((h, i) => NUMBER_HEADER_RE.test(h) && order.push(i))
    header.forEach((h, i) => TEAM_HEADER_RE.test(h) && !order.includes(i) && order.push(i))
  }
  for (let i = 0; i < width; i++) if (!order.includes(i)) order.push(i)

  const startWaitlisted = underWaitlistLabel(table)
  for (const col of order) {
    let nameCol = header ? header.findIndex((h, i) => i !== col && NAME_HEADER_RE.test(h)) : -1
    if (nameCol < 0 && col + 1 < width) nameCol = col + 1

    const entries: RawEntry[] = []
    let waitlisted = startWaitlisted
    for (const cells of grid) {
      const cell = cells[col] ?? ''
      const nameCell = nameCol >= 0 ? (cells[nameCol] ?? '') : ''
      const parsed = cell ? parseEntryText(cell) : null
      if (parsed) {
        const name = nameCell && !/^\d{1,5}$/.test(nameCell) ? nameCell : parsed.name
        entries.push({ number: parsed.number, robot: parsed.robot, ...(name ? { name } : {}), waitlisted })
        continue
      }
      if (cell && PLACEHOLDER_RE.test(cell)) {
        if (!nameCell) continue
        entries.push({ ...resolvePlaceholderName(nameCell), waitlisted })
        continue
      }
      // A row with no team: a blank spacer, or a label switching the section.
      const joined = clean(cells.join(' '))
      if (isWaitlistLabel(joined)) waitlisted = true
      else if (FIELD_LABEL_RE.test(joined)) waitlisted = false
    }
    const numbers = entries.filter((e) => e.number !== null) as Array<RawEntry & { number: number }>
    if (numbers.length < Math.max(3, grid.length / 3)) continue
    if (slotIndicesLeaked(numbers.map((e) => ({ number: e.number, robot: null })))) continue
    return entries
  }
  return []
}

/** A list's items, or a paragraph's <br> lines, read as "number name" lines. */
function readLines(lines: string[], startWaitlisted: boolean): RawEntry[] {
  const entries: RawEntry[] = []
  let waitlisted = startWaitlisted
  for (const raw of lines) {
    const line = clean(raw)
    if (!line) continue
    // A long line is a sentence, never a roster entry.
    if (line.length > 100) continue
    const parsed = parseEntryText(line)
    if (parsed) {
      entries.push({ number: parsed.number, robot: parsed.robot, ...(parsed.name ? { name: parsed.name } : {}), waitlisted })
      continue
    }
    // "10xxx - Rookie Squad": a team with no number yet, carried by its name.
    const ph = line.match(/^(\S+)\s*[-–—:|,]?\s*(.+)$/)
    if (ph && PLACEHOLDER_RE.test(ph[1])) {
      entries.push({ ...resolvePlaceholderName(clean(ph[2])), waitlisted })
      continue
    }
    if (isWaitlistLabel(line)) waitlisted = true
    else if (FIELD_LABEL_RE.test(line)) waitlisted = false
  }
  return entries
}

/** The text of an <li> without its nested lists. */
function ownText(li: HTMLElement): string {
  return li.childNodes
    .filter((n) => !(n instanceof HTMLElement && /^(ul|ol)$/i.test(n.tagName)))
    .map((n) => n.text)
    .join(' ')
}

/** The post's HTML with quotes of other posts and footnotes removed. */
function postRoot(cooked: string): HTMLElement {
  const root = parse(cooked)
  // A quote is someone else's (older) words; a footnote is an aside.
  for (const el of root.querySelectorAll('aside.quote, blockquote, .footnotes-list, .footnotes-sep')) el.remove()
  return root
}

/**
 * Every table, list and multi-line paragraph of the post, read into entries, in
 * document order. A block counts when it looks like a roster by itself (five or
 * more team numbers), so a stray two-item list does not join in. The one
 * exception is a short list under its own waitlist heading, which counts once
 * the post has a roster block: a waitlist of two is still a waitlist.
 */
function readBlocks(root: HTMLElement): RawEntry[] {
  const blocks: Array<{ entries: RawEntry[]; waitlistBlock: boolean }> = []
  for (const block of root.querySelectorAll('table, ul, ol, p')) {
    const tag = block.tagName.toLowerCase()
    let entries: RawEntry[] = []
    let waitlistBlock = false
    if (tag === 'table') {
      entries = readTable(block)
    } else if (tag === 'ul' || tag === 'ol') {
      if (hasAncestor(block, 'li, table')) continue
      const items = block.querySelectorAll('li').filter((li) => li.closest('ul, ol') === block)
      waitlistBlock = underWaitlistLabel(block)
      entries = readLines(items.map(ownText), waitlistBlock)
    } else {
      if (hasAncestor(block, 'li, table')) continue
      // Only a paragraph broken into lines can be a list; a plain paragraph is prose.
      if (!block.querySelector('br')) continue
      const lines = block.innerHTML.split(/<br\s*\/?>/i).map((h) => parse(h).text)
      waitlistBlock = underWaitlistLabel(block)
      entries = readLines(lines, waitlistBlock)
    }
    if (entries.length > 0) blocks.push({ entries, waitlistBlock })
  }
  const isRoster = (b: { entries: RawEntry[] }) =>
    new Set(b.entries.filter((e) => e.number !== null).map((e) => e.number)).size >= 5
  if (!blocks.some(isRoster)) return []
  return blocks.filter((b) => isRoster(b) || b.waitlistBlock).flatMap((b) => b.entries)
}

function hasAncestor(el: HTMLElement, selector: string): boolean {
  const parent = el.parentNode as HTMLElement | null
  return Boolean(parent && typeof parent.closest === 'function' && parent.closest(selector))
}

/**
 * Raw entries to RosterTeams: a repeated whole row is a second robot, a repeat
 * with a different name is a stray duplicate, and a name-only team gets the
 * lowest free 9970-9999 number.
 */
function finishEntries(entries: RawEntry[]): RosterTeam[] {
  const used = new Set<string>()
  const firstName = new Map<number, string | undefined>()
  const taken = new Set(entries.flatMap((e) => (e.number === null ? [] : [e.number])))
  let nextPlaceholder = 9970
  let waitPos = 0
  const out: Array<Record<string, unknown>> = []
  for (const e of entries) {
    let number = e.number
    let robot = e.robot
    if (number === null) {
      while (taken.has(nextPlaceholder)) nextPlaceholder++
      if (nextPlaceholder > 9999) continue
      number = nextPlaceholder
      taken.add(number)
    }
    let key = `${number}:${robot ?? ''}`
    if (used.has(key)) {
      // Same number again with no marker. The same name again is a B team; anything else is a double-read.
      if (robot !== null || firstName.get(number) !== e.name) continue
      let letter = 'B'
      while (used.has(`${number}:${letter}`)) letter = String.fromCharCode(letter.charCodeAt(0) + 1)
      robot = letter
      key = `${number}:${robot}`
    }
    used.add(key)
    if (!firstName.has(number)) firstName.set(number, e.name)
    // Positions follow the order the post lists the waitlist in.
    out.push({
      number,
      robot,
      ...(e.name ? { name: e.name } : {}),
      ...(e.waitlisted ? { waitlisted: true, waitlistPosition: ++waitPos } : {}),
    })
  }
  return normaliseTeams(out)
}

/**
 * The roster in one post's cooked HTML, read without a model: tables by their
 * team-number column, lists and line-broken paragraphs by the leading number.
 * An empty array means no readable roster.
 */
export function readRosterFromPost(cooked: string): RosterTeam[] {
  return finishEntries(readBlocks(postRoot(cooked)))
}

/**
 * Whether a post HOLDS a roster, readable or not: five or more rows (table rows,
 * list items, line-broken lines) that each carry a team-looking number, with
 * five or more distinct numbers above 20 among them so a slot column does not
 * count. A sentence naming three teams is one row and never qualifies.
 */
export function looksLikeRosterPost(cooked: string): boolean {
  const root = postRoot(cooked)
  if (readRosterFromPost(cooked).length >= 5) return true
  const rows: string[] = [
    ...root.querySelectorAll('tr').map((r) => clean(r.text)),
    ...root.querySelectorAll('li').map((li) => clean(ownText(li))),
    ...root
      .querySelectorAll('p')
      .filter((p) => p.querySelector('br'))
      .flatMap((p) => p.innerHTML.split(/<br\s*\/?>/i).map((h) => clean(parse(h).text))),
  ].filter((r) => r.length > 0 && r.length <= 120)
  const numbered = rows.filter((r) => /\b\d{2,5}\b/.test(r))
  if (numbered.length < 5) return false
  const distinct = new Set<number>()
  for (const r of numbered) for (const m of r.matchAll(/\b(\d{2,5})\b/g)) if (Number(m[1]) > 20) distinct.add(Number(m[1]))
  return distinct.size >= 5
}

// #endregion

// #region picking the post

/**
 * The post whose roster is current: the NEWEST post that holds a roster,
 * preferring the topic author's (the organiser). Only when the author never
 * posts a roster does anyone else's roster post count. Replies with no roster
 * ("Any update to the team list?") are skipped, as are hidden and deleted posts.
 */
export function pickRosterPost(posts: ThreadPost[], topicAuthor: string | null): ThreadPost | null {
  const live = posts
    .filter((p) => !p.hidden && !p.deleted_at && typeof p.cooked === 'string' && p.cooked.length > 0)
    .sort((a, b) => b.post_number - a.post_number)
  const author = topicAuthor?.toLowerCase() ?? null
  if (author) {
    const own = live.find((p) => p.username?.toLowerCase() === author && looksLikeRosterPost(p.cooked))
    if (own) return own
  }
  return live.find((p) => looksLikeRosterPost(p.cooked)) ?? null
}

// #endregion

// #region model fallback

// Reading one post's roster is a light task next to writing a DOM parser.
const FALLBACK_MODEL = 'claude-opus-4-8'

const FALLBACK_PROMPT = `You are given the HTML of ONE Chief Delphi forum post in which a FIRST Robotics off-season event organiser posts the event's current team list. Return the roster as JSON only: an array of { "number": <int>, "robot": <null | "B" | "C">, "name": <string, optional>, "waitlisted": <bool, optional>, "waitlistPosition": <int, optional> }.

- Read ONLY the list/table rows of the roster. Never read team numbers out of a prose sentence ("Welcome 254 and 1678!", "4083 stepped aside so 281 moved in"): those name teams, they are not the list.
- One entry per robot. "4611 B", "4611 #2", or "4611 B-Team" is { number: 4611, robot: "B" }.
- A placeholder number ("99xx", "10xxx", "TBD") is not a number: if its name says whose B team it is ("3506 B-Team"), use that team with robot "B"; otherwise give it a 9970-9999 number and carry its name.
- Slot indices (1, 2, 3 ... down a column), counts, dates and prices are not teams.
- WAITLIST: a team is waitlisted only when it sits under an explicit waitlist heading or label row ("Waitlist", "WAITING LIST") that introduces its own list. Mark it waitlisted: true with its 1-based position. Prose explaining a waitlist policy marks nothing. When in doubt, a team is registered.
Return ONLY the JSON array.`

async function readRosterWithModel(cooked: string, eventName: string): Promise<RosterTeam[]> {
  if (!hasAnthropicCredentials()) return []
  try {
    const response = await anthropic().messages.create({
      model: FALLBACK_MODEL,
      max_tokens: 4000,
      system: FALLBACK_PROMPT,
      messages: [{ role: 'user', content: `Event: ${eventName}\n\nPost HTML:\n${cooked.slice(0, 60_000)}` }],
    })
    const text = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text',
    )?.text
    if (!text) return []
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? normaliseTeams(parsed) : []
  } catch (err) {
    console.warn(`[cd-roster] ${eventName}: model read failed:`, err)
    return []
  }
}

// #endregion

export interface ChiefDelphiRoster {
  teams: RosterTeam[]
  topicId: number
  postNumber: number
  postUrl: string
  method: 'table' | 'model'
}

/**
 * The current roster of a Chief Delphi thread: fetch, pick the newest roster
 * post, read it. Null when the thread has no roster post or it cannot be read.
 */
export async function readChiefDelphiRoster(
  url: string,
  eventName: string,
  fetchJson: JsonFetcher = defaultFetchJson,
): Promise<ChiefDelphiRoster | null> {
  const topicId = chiefDelphiTopicId(url)
  if (topicId === null) return null
  const thread = await fetchThreadPosts(topicId, fetchJson)
  const post = pickRosterPost(thread.posts, thread.author)
  if (!post) {
    console.warn(`[cd-roster] ${eventName}: no roster post in topic ${topicId} (${thread.posts.length} posts read)`)
    return null
  }
  const postUrl = chiefDelphiPostUrl(topicId, post.post_number)
  let teams = readRosterFromPost(post.cooked)
  let method: ChiefDelphiRoster['method'] = 'table'
  if (teams.length < 5) {
    teams = await readRosterWithModel(post.cooked, eventName)
    method = 'model'
  }
  const field = teams.filter((t) => !t.waitlisted).length
  console.log(
    `[cd-roster] ${eventName}: topic ${topicId} post #${post.post_number} by ${post.username} ` +
      `(${post.created_at}) via ${method}: ${field} in the field, ${teams.length - field} waitlisted`,
  )
  if (teams.length === 0) return null
  return { teams, topicId, postNumber: post.post_number, postUrl, method }
}
