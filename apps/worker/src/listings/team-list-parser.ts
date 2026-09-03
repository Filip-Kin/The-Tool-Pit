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
import { withRenderedPage, settleDynamicContent } from '../connectors/playwright-render.js'
import { anthropic, hasAnthropicCredentials } from '../anthropic.js'
import { sendApprovalNotice } from '@the-tool-pit/types'
import type { RosterTeam } from '@the-tool-pit/db'

// Writing a robust DOM parser for an unseen page is a hard reasoning task, so the
// GENERATOR runs on Opus. The parser it writes then runs on every refresh with no
// model call, so this cost is paid once per event, not per scrape.
const MODEL = 'claude-opus-4-8'
const MAX_HTML_CHARS = 40_000
const MAX_PARSER_TOKENS = 3500
const RUN_TIMEOUT_MS = 4_000
const MAX_ATTEMPTS = 10

/** How many reveal controls we will click on one page before giving up. */
const MAX_REVEAL_CLICKS = 4

/**
 * Labels of an on-page control that, when clicked, reveals a registered-team
 * list. Some off-season sites (CMRC and NMRC on ortop.my.site.com, a Salesforce
 * Experience-Cloud site) hide the team table behind a RADIO option or a tab: the
 * table is not in the DOM until you pick "Registered Teams". The parser reads the
 * DOM as first rendered, so it sees no teams until the control is clicked.
 *
 * The match is deliberately narrow: a control whose own label plainly names a
 * team list. "Team Sponsors", "Meet the Team" and "Team Store" do not match, so
 * we never click a control that leads somewhere other than the roster. Both word
 * orders ("Registered Teams" and "Teams Registered") are covered.
 */
const REVEAL_INTENT =
  /^teams?$|\bteam\s*list\b|\bteam\s*roster\b|\broster\b|\b(registered|participating|entered|attending|competing|confirmed)\s+teams?\b|\bteams?\s+(registered|attending|competing|list)\b|\bshow\s+teams?\b/i

/**
 * Does this control's label read as "click me to see the team list"?
 *
 * A pure decision over the label text, so it can be unit-tested without a
 * browser. The reveal step below asks it of every candidate control's accessible
 * label and clicks only the ones it says yes to.
 */
export function isTeamListRevealControl(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 60) return false
  return REVEAL_INTENT.test(text)
}

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
- MULTIPLE TEAMS IN ONE ROW OR CELL. A single row or cell can list several team numbers together (several teams sharing a row, often from one school), e.g. "1306 10553 10909 11258" or "2202 / 6223". Return EVERY number as its own entry { number, robot: null }, not just the first in the cell. This is different from a second robot of ONE team ("4611 B" → robot: "B"): separate whole numbers are separate teams, each robot: null.
- number is the real FRC team number. Many lists number their SLOTS ("1 - 48", "2 - 144", ...); the slot index is NOT a team number and must not appear. Only the number after the dash is the team.
- Skip an empty slot: "24 -" with nothing after it is not an entry.
- A TEAM WITH A NAME BUT NO NUMBER. Sometimes the list clearly names a team (a pre-rookie, a late entry) but shows no number beside it. Still include it: give it a placeholder number from the 9970-9999 range, choosing the lowest value in that range not already used by another entry in the array you return. Only do this for something that is unmistakably a team in the list, never for stray text.
- Return only real teams. Ignore navigation, headings, footers, dates, times and scores elsewhere on the page.
- DO NOT REQUIRE THE WORD "Team" BEFORE A NUMBER. Sections format differently: one block may write 'Team 1506 "Metal Muscle"' while another under a nearby heading writes a bare '2619 "The Charge"'. Inside a team section (under a registered / host / attending / competing heading, or a team table) read the numbers whether or not the word "Team" precedes them. A regex like /Team\\s+(\\d+)/ silently drops a whole block that omits the word — do not scope extraction to that pattern. Outside team sections, do not scrape stray numbers.
- BUT THE NUMBER MUST LOOK LIKE A TEAM NUMBER. Real FRC team numbers are NOT sequential: a run of small consecutive numbers (1, 2, 3, 4, 5 ...) is a slot or row index, a ranking, or a countdown, not teams. Team 1 is a real team, but "1, 2, 3, 4" in order down a column are indices — drop them and keep the genuine team numbers beside them. When you read bare numbers, ignore any that form a consecutive counter.
- A COUNT OR A DATE IS NOT A TEAM. A number that is a QUANTITY — immediately followed by a word like "teams", "team", "robots", "spots", "host", "registered", "attending" ("8 host teams", "30 teams registered") — is describing the list, not a member of it. A date, a time, a year, a price ("$400"), a phone number or a zip is not a team either. A real team ENTRY is the team's own number standing on its own in a row/cell/line, usually with the team's name right after it. Read those; skip numbers embedded in a sentence.
- WAITLIST. A team is waitlisted ONLY when it sits under an explicit waitlist HEADING that introduces an actual list of waitlisted teams. Prose that merely explains a waitlist policy ("the waitlist will be pulled in order of application", "as space becomes available") is NOT a waitlist section and marks nothing. Mark a real waitlisted entry { number, robot, waitlisted: true, waitlistPosition: 1 } with its 1-based position; leave waitlistPosition null if the page shows no order. A registered team is waitlisted: false (or the field omitted). Do not merge the two lists: a team is either in the event or on the waitlist, and the section it sits under is what says which. When in doubt, a team is REGISTERED and MUST be returned; never drop a team because the word "waitlist" appears somewhere on the page.

How to write it:
- Use the DOM structure, not the flattened text: find the container that holds the list (often under a heading like "Teams Registered" or "Registered Teams" or "Team List"), then read its rows. querySelector, querySelectorAll, textContent, closest, and the like are all available.
- TEAMS ARE OFTEN SPLIT ACROSS SEVERAL BLOCKS. The same event may list its teams in more than one place under different headings, for example "Host Teams" beside "Registered Teams", or two side-by-side columns, or several tables. Find EVERY such list and UNION all of them; do not stop at the first or the largest block. A team under any registered / host / attending / competing heading belongs in the result. Missing a whole section is the most common failure here.
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

/**
 * Click any on-page control that reveals a hidden team list, then let the page
 * settle so the table is in the DOM before the parser reads it.
 *
 * WHY A CLICK AT ALL. Most event pages render their roster straight away. A few
 * off-season sites gate it behind a control: CMRC and NMRC on
 * ortop.my.site.com, a Salesforce Experience-Cloud site, keep the team table out
 * of the DOM until you pick the "Registered Teams" RADIO. Reading the DOM as
 * first rendered finds nothing there. So before the model writes its parser, and
 * before every scheduled run of a stored one, we click the controls that
 * plausibly reveal a team list and wait for the content to arrive.
 *
 * SAFE AND GENERIC. Not hard-coded to ortop: it clicks radios, tabs, switches
 * and buttons whose OWN accessible label reads as a team list
 * (isTeamListRevealControl), across every frame, capped at a few clicks. It
 * never touches an anchor or a submit control, so it cannot navigate away or
 * submit a form; an already-selected control is left alone. The click runs in
 * the page's own realm through evaluate, the same sandbox the parser uses.
 */
async function revealTeamListControls(page: Page): Promise<void> {
  const clickExpr = `
    (() => {
      const RE = new RegExp(${JSON.stringify(REVEAL_INTENT.source)}, ${JSON.stringify(REVEAL_INTENT.flags)});
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const controls = document.querySelectorAll(
        'input[type=radio], [role=radio], [role=tab], [role=switch], button, [role=button]'
      );
      const clicked = [];
      for (const el of controls) {
        if (clicked.length >= ${MAX_REVEAL_CLICKS}) break;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        // Never submit a form or follow a link: only toggle-like controls.
        if (tag === 'button' && type === 'submit') continue;
        if (el.closest('a[href]')) continue;
        // The control's OWN label: aria-label, associated <label>s, its text, or
        // the <label> it sits inside (a radio often has no text of its own).
        let label = norm(el.getAttribute('aria-label'));
        if (!label && el.labels && el.labels.length) label = norm(Array.from(el.labels).map((l) => l.textContent).join(' '));
        if (!label) label = norm(el.textContent);
        if (!label) { const p = el.closest('label'); if (p) label = norm(p.textContent); }
        if (!label || label.length > 60) continue;
        if (!RE.test(label)) continue;
        // Leave an already-chosen option alone; clicking it can toggle it off.
        const selected = el.checked === true || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true';
        if (selected) continue;
        try { el.click(); clicked.push(label); } catch {}
      }
      return clicked;
    })()
  `

  const revealed: string[] = []
  for (const frame of page.frames()) {
    try {
      const clicked = (await frame.evaluate(clickExpr)) as string[]
      if (Array.isArray(clicked)) revealed.push(...clicked)
    } catch {
      // A frame that will not evaluate holds no control we can click.
    }
  }

  if (revealed.length > 0) {
    console.log(`[team-list-parser] revealed a gated team list by clicking: ${revealed.join(', ')}`)
    // The table arrives asynchronously after the click; wait for it to settle,
    // the same way withRenderedPage waits after the initial load.
    await settleDynamicContent(page)
  }
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

  const teams = await withRenderedPage(url, async (page) => {
    await revealTeamListControls(page)
    return runAcrossFrames(page, script)
  })
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
    // Reveal a gated list first, so the DOM the model is shown, and the DOM its
    // parser is proven against, already holds the team table.
    await revealTeamListControls(page)
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
          ? `Your result is the sequence ${leaked}, which is NOT a roster. Real FRC team numbers are never consecutive, so a run like that is one of two things you read by mistake: a row or SLOT index column (1, 2, 3, ...) beside the real teams, or a YEAR archive (2007, 2008, ...) listing the event's past seasons. Watch for a bracket or seeding layout where each row reads "SLOT - TEAM", e.g. "6 - 4145": the number LEFT of the dash is the slot, the number RIGHT of the dash is the team. Empty slots still print their slot number with nothing after the dash ("16 -", "17 -", ... "32 -") — take only the value AFTER the separator, and skip any row that has no team after it. Otherwise the team list is usually a DATA TABLE whose columns are headed like "Number", "Team", "Team #" or "Team Number", next to "Team Name", "City" and "State". Find that table by its header row, read the cells under the team-number column, and ignore the leading index column and anything outside that table. Do not gate on a nearby prose heading: a Wix data grid has column headers, not a "Registered Teams" heading above it.`
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
  if (sorted.length < 5) return null

  // Slot and row columns leak as an ARITHMETIC RUN, not always a step of one.
  // CORI's parser once returned 16, 18, 20, ... 32: the even slots, a step of
  // two, which a "consecutive integers" check walked straight past. A real
  // roster is never five or more team numbers in an even progression, whatever
  // the step, so the longest such run over a few small steps is the tell.
  for (const step of [1, 2]) {
    let bestStart = sorted[0]
    let bestLen = 1
    let runStart = sorted[0]
    let runLen = 1
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + step) runLen++
      else {
        runStart = sorted[i]
        runLen = 1
      }
      if (runLen > bestLen) {
        bestLen = runLen
        bestStart = runStart
      }
    }
    const bestEnd = bestStart + (bestLen - 1) * step
    // A run FROM 1, whatever the step, is a slot or row column; five is enough.
    // A long run is a slot column, a row index, or a year archive: a real
    // roster never lines up this way. Step 1 keeps the plain wording; a wider
    // step names itself so the repair hint can point the model at it.
    if (bestLen >= 5) return step === 1 ? `${bestStart} through ${bestEnd}` : `${bestStart} through ${bestEnd} (step ${step})`
  }
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
