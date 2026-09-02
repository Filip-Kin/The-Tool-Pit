/**
 * A parser for one event's team list page, written once by the model, then run
 * deterministically against the DOM forever.
 *
 * NO SHARED ALGORITHM, because every event's list is shaped differently and no
 * format covers them. RiverRage writes "88 TJ2": a team number, then the team
 * name. CORI and MARC write "6 - 4145": a SLOT index, a dash, the team number,
 * with blank slots for empty spots and "4145 B" for a second robot from the
 * same organisation. A regex tuned for one shape reads the other's slot indices
 * as team numbers, silently, because 1 through 32 are real team numbers too.
 *
 * So the model sees ONE page's DOM once and writes the few lines of parsing that
 * page needs. Every refresh after that runs the stored function with no model
 * call, which is what makes a daily schedule across every event cheap.
 *
 * THE DOM IS THE INPUT, not flattened text. The structure a browser keeps, the
 * heading over the list, the element that is the list, is exactly what tells a
 * slot from a team and a roster row from a date range elsewhere on the page.
 * htmlToText throws all of that away.
 *
 * SAFETY. The function is model-authored and runs on a schedule with nobody
 * reading it first, so it gets one capability and no more: the page's own DOM.
 * It runs in the browser realm through Playwright's page.evaluate, which is a
 * separate process from this worker, so it cannot see the filesystem, the
 * environment, the database or anything else of ours. The context is fresh and
 * cookieless and the page is public, so there is nothing to exfiltrate even if
 * it tried. On top of that a static check refuses to store a script that so
 * much as mentions fetch, eval, Function, XMLHttpRequest, WebSocket or import,
 * none of which a roster parser needs; a short timeout closes the context on a
 * runaway loop; and the output is validated, so a garbage return is dropped
 * rather than published. And a freshly generated parser is run against its own
 * page and required to produce a sane roster before it is ever stored: a
 * scheduled job never inherits a parser nobody watched work.
 */
import type { Page } from 'playwright'
import { withRenderedPage } from '../connectors/playwright-render.js'
import { anthropic, hasAnthropicCredentials } from '../anthropic.js'
import { sendApprovalNotice } from '@the-tool-pit/types'
import type { RosterTeam } from '@the-tool-pit/db'

const MODEL = 'claude-sonnet-5'
const MAX_HTML_CHARS = 40_000
const MAX_PARSER_TOKENS = 3500
const RUN_TIMEOUT_MS = 4_000
const MAX_ATTEMPTS = 10

/**
 * Words a DOM roster parser has no reason to use, forbidden on top of the
 * already-empty capabilities of a fresh public page. `document` and the string
 * and array intrinsics are all it needs.
 */
const FORBIDDEN =
  /\b(fetch|eval|Function|XMLHttpRequest|WebSocket|import|require|process|localStorage|sessionStorage|cookie)\b/

const SYSTEM_PROMPT = `You write one small JavaScript function that reads a FIRST Robotics event's registered-team list out of the page's DOM.

You are given the cleaned HTML of the page. Write a function that runs IN THE BROWSER on that page and returns the teams:

function extractTeams() {
  // read the DOM through the global \`document\`
  return [{ number: 254, robot: null }, { number: 4611, robot: null }, { number: 4611, robot: "B" }];
}

What it returns:
- One entry per team ROBOT, not per organisation. Some events let one team enter a second robot, shown as "4611 B" or similar; that is a second entry, { number: 4611, robot: "B" }. One robot means robot: null.
- number is the real FRC team number. Many lists number their SLOTS ("1 - 48", "2 - 144", ...); the slot index is NOT a team number and must not appear. Only the number after the dash is the team.
- Skip an empty slot: "24 -" with nothing after it is not an entry.
- Return only real teams. Ignore navigation, headings, footers, dates, times and scores elsewhere on the page.
- WAITLIST. Some events show the registered teams and then, separately, a waitlist, often in the order teams will be admitted. Mark a waitlisted entry { number, robot, waitlisted: true, waitlistPosition: 1 } with its 1-based position; leave waitlistPosition null if the page shows no order. A registered team is waitlisted: false (or the field omitted). Do not merge the two lists: a team is either in the event or on the waitlist, and the section it sits under is what says which.

How to write it:
- Use the DOM structure, not the flattened text: find the container that holds the list (often under a heading like "Teams Registered" or "Registered Teams" or "Team List"), then read its rows. querySelector, querySelectorAll, textContent, closest, and the like are all available.
- OFTEN A DATA TABLE. Many events show the list as a table whose columns are headed "Number" (or "Team", "Team #", "Team Number") next to "Team Name", "City", "State". Read the cells under the team-number column. Ignore the leading row-index column (1, 2, 3, ...) and never read a nearby list of past-season years as teams: real FRC team numbers are not consecutive.
- Match the pattern, not the exact page. It will be re-read on a schedule and can come back with a team added, removed, or reordered, or with extra whitespace. Do not hard-code a row count or a fixed position.
- It reads the DOM and returns an array. Nothing else. No network, no eval, no timers, no storage. Only \`document\` and ordinary JavaScript.
- Synchronous. No async, no await, no Promise.

Return ONLY the function declaration. No explanation, no markdown fence.`

const CLEAN_DOM_EXPR = `
  (() => {
    const doc = document.cloneNode(true);
    doc.querySelectorAll('script,style,svg,link,meta,noscript,iframe').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('style');
      // Wix and Squarespace hang data-* soup off everything; the tag, id and
      // class are what a selector keys off.
      for (const name of [...el.getAttributeNames()]) {
        if (name.startsWith('data-') || name.startsWith('aria-')) el.removeAttribute(name);
      }
    });
    return doc.body ? doc.body.innerHTML : '';
  })()
`

/**
 * The cleaned HTML of the frame most likely to hold the team list.
 *
 * Not always the page's own document: MARC's list is in a cross-origin iframe.
 * The richest frame is the one with the most short numbers in it, which is what
 * a roster is, so the model is shown that frame and writes a selector for it.
 * The parser is later run across every frame anyway, so this only has to be
 * good enough to write against, not exactly right.
 */
async function readRichestFrameHtml(page: Page): Promise<string> {
  let best = { score: -1, html: '' }
  for (const frame of page.frames()) {
    try {
      const html = (await frame.evaluate(CLEAN_DOM_EXPR)) as string
      const score = (html.match(/\b\d{2,5}\b/g) ?? []).length
      if (score > best.score) best = { score, html }
    } catch {
      // A frame that will not evaluate is not where the list is.
    }
  }
  return best.html.replace(/\s+/g, ' ').replace(/> </g, '>\n<').slice(0, MAX_HTML_CHARS)
}

export type ParserRunResult =
  | { ok: true; teams: RosterTeam[] }
  | { ok: false; error: string }

/**
 * Run a stored parser against a page's live DOM.
 *
 * The script reads `document` itself; the page's data is never interpolated in,
 * so the only thing it can see is the DOM of the page it was pointed at. Output
 * is validated field by field, and one bad entry is dropped rather than failing
 * the whole roster.
 */
export async function runTeamListParser(url: string, script: string): Promise<ParserRunResult> {
  const check = staticCheck(script)
  if (!check.ok) return { ok: false, error: check.error }

  const teams = await withRenderedPage(url, (page) => runAcrossFrames(page, script))
  if (teams === null) return { ok: false, error: 'no browser, or the page did not load' }
  if (teams.length === 0) return { ok: false, error: 'parser found no teams on any frame' }
  return { ok: true, teams }
}

/**
 * Run the parser in EVERY frame and take the frame that yields the most teams.
 *
 * A team list is often not on the page's own document. MARC's is a Wix table
 * widget served from wix-visual-data.appspot.com in a cross-origin iframe, which
 * in-page JavaScript cannot read across the origin boundary; Playwright can,
 * because it drives the browser at the protocol level and evaluates inside a
 * child frame directly. Running the parser in each frame and keeping the best
 * result needs no per-event knowledge of where the list lives: the frame that
 * holds it wins, and the parser returns nothing on the frames that do not.
 */
async function runAcrossFrames(page: import('playwright').Page, script: string): Promise<RosterTeam[]> {
  const wrapped = `(() => { ${script}\n return extractTeams(); })()`
  let best: RosterTeam[] = []
  for (const frame of page.frames()) {
    try {
      const raw = await Promise.race([
        frame.evaluate(wrapped),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), RUN_TIMEOUT_MS)),
      ])
      if (Array.isArray(raw)) {
        const teams = normaliseTeams(raw)
        if (teams.length > best.length) best = teams
      }
    } catch {
      // A frame that will not evaluate is not a team list; move on.
    }
  }
  return best
}

/** "4145" or "4145 B" or "4145B" into the object shape normalise expects. */
function parseTeamString(value: string): Record<string, unknown> | null {
  const m = value.trim().match(/^(\d{1,5})\s*([A-Za-z])?$/)
  if (!m) return null
  return { number: Number(m[1]), robot: m[2] ? m[2].toUpperCase() : null }
}

/** Coerce and validate the parser's output. Anything implausible is dropped. */
export function normaliseTeams(raw: unknown[]): RosterTeam[] {
  const teams: RosterTeam[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    // The model may return an object {number, robot, waitlisted} or, for the
    // common case, a bare string like "4145" or "4145 B". Both are read; a
    // string cannot carry a waitlist flag, which is fine, because a page with
    // a waitlist needs the structured form and the prompt asks for it there.
    const entry =
      typeof item === 'string'
        ? parseTeamString(item)
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null
    if (!entry) continue
    const number = entry.number
    const robot = entry.robot
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 20_000) continue
    const robotLabel = typeof robot === 'string' && /^[A-Z]$/.test(robot.trim()) ? robot.trim() : null
    const key = `${number}:${robotLabel ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    const rec = entry as Record<string, unknown>
    const waitlisted = rec.waitlisted === true
    const pos = rec.waitlistPosition
    const waitlistPosition =
      waitlisted && typeof pos === 'number' && Number.isInteger(pos) && pos > 0 && pos < 1000 ? pos : null
    teams.push({ number, robot: robotLabel, ...(waitlisted ? { waitlisted, waitlistPosition } : {}) })
  }
  return teams.sort(
    (a, b) =>
      Number(a.waitlisted ?? false) - Number(b.waitlisted ?? false) ||
      (a.waitlisted ? (a.waitlistPosition ?? 999) - (b.waitlistPosition ?? 999) : 0) ||
      a.number - b.number ||
      (a.robot ?? '').localeCompare(b.robot ?? ''),
  )
}

export interface GeneratedParser {
  script: string
  /** What it produced on the page it was written against, so the caller can store the count too. */
  teams: RosterTeam[]
}

/**
 * Write a parser for this page, and prove it works before returning it.
 *
 * TWO THINGS THE MODEL GETS TO DO THAT IT COULD NOT BEFORE. It writes a parser,
 * we run it across the page's frames, and if it found nothing or threw, we hand
 * the SAME model the error and its own script and let it try again, up to a few
 * times. A first attempt that misjudged a Wix widget's structure gets to see
 * that it returned zero teams and fix its selector. Only a parser that actually
 * produced a roster on this page is ever stored, so a scheduled job never
 * inherits a parser nobody watched work.
 */
export async function generateTeamListParser(input: {
  eventName: string
  url: string
  /** The listing's admin page, for the Discord ping when generation gives up. */
  reviewUrl?: string
}): Promise<GeneratedParser | null> {
  if (!hasAnthropicCredentials()) return null

  return withRenderedPage(input.url, async (page) => {
    const html = await readRichestFrameHtml(page)
    if (html.trim().length < 40) {
      console.warn(`[team-list-parser] ${input.eventName}: no readable content on any frame`)
      return null
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: `Event: ${input.eventName}\n\nCleaned page HTML:\n${html}` },
    ]

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let response
      try {
        response = await anthropic().messages.create({
          model: MODEL,
          max_tokens: MAX_PARSER_TOKENS,
          system: SYSTEM_PROMPT,
          messages,
        })
      } catch (err) {
        console.error('[team-list-parser] generation failed:', err)
        return null
      }

      const textBlock = response.content.find(
        (b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text',
      )
      const script = textBlock ? extractFunctionSource(textBlock.text) : null
      const check = script ? staticCheck(script) : { ok: false as const, error: 'no function in the response' }

      let problem: string
      if (!script) {
        problem = 'You did not return a function named extractTeams.'
      } else if (!check.ok) {
        problem = `The function was rejected: ${check.error}. Use only the DOM and ordinary JavaScript.`
      } else {
        // Run it across every frame, the same way the stored parser will run.
        const teams = await runAcrossFrames(page, script)
        const leaked = slotIndicesLeaked(teams)
        if (teams.length > 0 && !leaked) {
          console.log(`[team-list-parser] ${input.eventName}: found ${teams.length} teams on attempt ${attempt + 1}`)
          return { script, teams }
        }
        problem = leaked
          ? `Your result is the sequence ${leaked}, which is NOT a roster. Real FRC team numbers are never consecutive, so a run like that is one of two things you read by mistake: a row or SLOT index column (1, 2, 3, ...) beside the real teams, or a YEAR archive (2007, 2008, ...) listing the event's past seasons. The team list is usually a DATA TABLE whose columns are headed like "Number", "Team", "Team #" or "Team Number", next to "Team Name", "City" and "State". Find that table by its header row, read the cells under the team-number column, and ignore the leading index column and anything outside that table. Do not gate on a nearby prose heading: a Wix data grid has column headers, not a "Registered Teams" heading above it.`
          : 'That function ran without error but returned no teams. The list may be in a table or a nested widget; look again at where the team rows actually are, and try a broader selector.'
      }

      // Feed the failure back and let it fix its own script.
      if (textBlock) messages.push({ role: 'assistant', content: textBlock.text })
      messages.push({ role: 'user', content: `${problem}\nReturn only the corrected function.` })
    }

    console.warn(`[team-list-parser] ${input.eventName}: gave up after ${MAX_ATTEMPTS} attempts`)
    // A page that beat ten attempts is one a person has to look at: the widget
    // is unusually shaped, or moved, or gone. Better a Discord ping than a
    // team count that silently stops updating.
    sendApprovalNotice({
      vertical: 'event',
      title: `Could not read the team list for ${input.eventName}`,
      reviewUrl: input.reviewUrl ?? input.url,
      sourceUrl: input.url,
      description: `The team-list parser failed ${MAX_ATTEMPTS} times on this page. Its registered-team count will not update until someone checks the page or clears the team list URL.`,
    })
    return null
  })
}

/**
 * The tell-tale of a column of consecutive numbers read as if it were a roster.
 *
 * Real FRC team numbers are never a contiguous block. So a long run of
 * consecutive integers is not a roster, it is one of two things the parser
 * caught by mistake:
 *
 *  - A row or SLOT index column: 1, 2, 3, ... 16. Modern FRC has almost no
 *    teams below twenty and never a block of them, so a run from 1 gives it
 *    away at five.
 *  - A YEAR archive: 2007, 2008, ... 2017, an event's list of its past
 *    seasons, which reads as team numbers just as easily. MARC's page carries
 *    exactly this beside the real table, and it is the run that slipped through
 *    when this only looked for a column starting at 1.
 *
 * Returns a short description of the run for the repair prompt, or null when the
 * numbers look like real teams.
 */
export function slotIndicesLeaked(teams: RosterTeam[]): string | null {
  const sorted = [...new Set(teams.map((t) => t.number))].sort((a, b) => a - b)
  if (sorted.length === 0) return null

  // The longest run of consecutive integers among the distinct numbers.
  let bestStart = sorted[0]
  let bestLen = 1
  let runStart = sorted[0]
  let runLen = 1
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) runLen++
    else {
      runStart = sorted[i]
      runLen = 1
    }
    if (runLen > bestLen) {
      bestLen = runLen
      bestStart = runStart
    }
  }
  const bestEnd = bestStart + bestLen - 1

  // A run FROM 1 is a slot or row column; five is enough to be sure.
  if (bestStart === 1 && bestLen >= 5) return `1 through ${bestEnd}`
  // A long consecutive run anywhere else is a year archive or an index column
  // that does not start at one. A real roster is never six numbers in a row.
  if (bestLen >= 6) return `${bestStart} through ${bestEnd}`
  return null
}

function extractFunctionSource(text: string): string | null {
  const at = text.indexOf('function extractTeams')
  if (at === -1) return null

  // From the function keyword to its OWN closing brace, so the prose the model
  // adds after it (a "How it works", an example fence) never rides along. That
  // trailing text is what broke the wrapper on one page and tripped the
  // forbidden-word check on another: the words were in the explanation, never
  // in the code.
  const open = text.indexOf('{', at)
  if (open === -1) return null
  let depth = 0
  let inString: string | null = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1]
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(at, i + 1).trim()
    }
  }
  return null // never closed: a truncated reply
}

function staticCheck(script: string): { ok: true } | { ok: false; error: string } {
  if (script.length > 20_000) return { ok: false, error: 'too long' }
  if (!/^function\s+extractTeams\s*\(\s*\)/.test(script)) return { ok: false, error: 'not a zero-arg function named extractTeams' }
  if (FORBIDDEN.test(script)) return { ok: false, error: 'names a capability a roster parser must not use' }
  return { ok: true }
}
