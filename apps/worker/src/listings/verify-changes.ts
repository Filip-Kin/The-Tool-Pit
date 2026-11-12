/**
 * A second reading of every automatic change before it is written.
 *
 * THE GAP. The weekly refresh writes a change when its quote is on a page.
 * That proves the words exist, not that they were read right: on 2026-11-11 an
 * audit of all 99 automatic event changes found 26 wrong, every one with a
 * real quote behind it. Last year's page read for this year's event, a future
 * deadline read as closed, shekels stored as dollars, a link label read as
 * "registration open", a load-in day counted as the start, a name cut to
 * initials. Each got a rule after the fact; the next week found a new shape.
 * What caught all of them was a second reader asked "is this right for THIS
 * listing", with the page and the listing in front of it. This is that reader.
 *
 * Only a change judged "right" is written. "wrong" and "unsure" are held and
 * logged, and the next weekly read tries again. Failing to reach the model
 * writes nothing: an unchecked change is not a checked one.
 */
import { anthropic } from '../anthropic.js'
import { parseJsonObject } from '../model/evidence.js'

export const VERIFY_MODEL = 'claude-opus-5-5'

export interface ChangeToVerify {
  key: string
  label: string
  from: string
  to: string
  quote: string | null
  source: string | null
}

export interface ChangeVerdict {
  key: string
  verdict: 'right' | 'wrong' | 'unsure'
  reason: string
}

const REPLY = `Reply with JSON only: {"verdicts":[{"key":"<key>","verdict":"right|wrong|unsure","reason":"<one line, naming the words that decided it>"}]} with one entry per change, same keys.`

const EVENT_SYSTEM = `You check automatic edits to a public directory of FIRST robotics off-season events before they are published. A reader model read the event's pages and proposed changes; each comes with the quote it relied on. The quote is genuinely on the page. Your job is whether the CHANGE IS RIGHT FOR THIS LISTING, not whether the words exist.

A wrong edit misleads teams deciding where to compete, so be strict. Judge each change "right", "wrong" or "unsure". Answer "right" only when the page, read in full, clearly supports the new value for this listing's edition. Otherwise "wrong" (the page shows it is not so) or "unsure" (it may be so, but the page does not settle it).

The owner's rules, each from a real wrong edit:
- EDITION. The listing is one year's edition, with the dates given. A page about a past edition (dates already gone, "2026" on a 2027 listing, a form titled for last year) says nothing about this edition's fee, form, deadline, registration state or venue.
- DATES ARE COMPETITION DAYS ONLY. Start is the first day with qualification or playoff matches; a load-in, setup, pit-hours, inspection or practice-only day before it is not the start. End is the last competition day. days is the number of competition days, 1 or 2.
- REGISTRATION. "closed" needs the page to say sign-ups ended or the field is full; a deadline still in the future is not closed, and neither is a deadline from a past edition. "open" needs words that sign-ups are open now; a button or link labelled "Register" or "Team application" is not. "waitlist" needs the field to be full now; a rule like "teams beyond 36 go on a waitlist" is not.
- MONEY. The amount and currency must be the TEAM entry fee for this event, in the currency the page charges in. Spectator admission is not the fee. A second-robot, B-team or late price is not the base fee when a base fee is given.
- SAME PAGE, OTHER THING. A page listing several events, divisions, programmes (FRC vs FTC) or years: the value must belong to this event and programme.
- TEXT. A new name or note must not lose information the old one had (a full name cut to initials, a month dropped from a date, CAD dropped from a price). A rewording that adds nothing is "wrong".
- CONTACTS AND LINKS. A volunteer coordinator is not the event contact. A link must be this edition's own page or form, not a different year's or event's, and not a home page offered as a sign-up form.
- CLEARING. Removing a link is right only when the change says the link is gone.

${REPLY}`


const GRANT_SYSTEM = `You check automatic edits to a public directory of grants that FIRST robotics teams can apply for, before they are published. A monitor re-read the funder's page and proposed changes to a listing; each comes with the quote it relied on. The quote is genuinely on the page. Your job is whether the CHANGE IS RIGHT FOR THIS GRANT, not whether the words exist.

A wrong edit sends teams after money they cannot get or past a deadline that is wrong, so be strict. Judge each change "right", "wrong" or "unsure". Answer "right" only when the page, read in full, clearly supports the new value for this grant and this cycle.

The owner's rules, each from a real wrong edit:
- SAME PAGE, OTHER PROGRAMME. A funder page often lists several programmes (a new-team grant beside a team-support grant, a second fund in a list). The value must belong to THIS grant.
- CYCLE YEAR. A date for a cycle year must be stated for that year on the page. A month with no year ("October 31", "accepted in December") is not a dated deadline for a given year, and a date that is the OPENING of a round is not its deadline.
- CLEAN LISTING TEXT. A note field (deadline note, award notes, eligibility) must read as a clean label or sentence for the listing, not a page fragment (navigation, half a phone number, "Click here", "Before you apply Have your team number").
- NO LOSS. A new value that is narrower than the old one and drops a fact the old one had (a state list, a second deadline, an amount range) is "wrong".
- AMOUNTS. An award range must be for this grant's awards, not the funder's total budget or another programme's range. A per-building stipend is not the team award.
- STATUS. "closed" needs the page to say applications ended or the deadline has passed by today's date; "open" needs words that applications are being taken now.
- LINKS. An application link must be this grant's own form or portal, not the info page, a login page for something else, or a third-party list.

${REPLY}`

const FIELD_SYSTEM = `You check automatic edits to a public map of practice fields that FIRST robotics teams can book, before they are published. A reader model re-read the field's pages and proposed changes; each comes with the quote it relied on. The quote is genuinely on the page. Your job is whether the CHANGE IS RIGHT FOR THIS FIELD, not whether the words exist.

Judge each change "right", "wrong" or "unsure". Answer "right" only when the page, read in full, clearly supports the new value and the new value is a better listing value than the old one.

The owner's rules, each from a real wrong edit:
- CONTACT. contactInfo is how a team reaches the host: an email, a phone number, a person's name, or a short label around one ("email contact@x.org"). A sentence about the booking process ("Your slot is not booked until a mentor emails you back", "Send us a message to request a time") is not contact info, and replacing an email or phone with one is "wrong".
- NO LOSS. A new value that drops a fact the old one had (an email, a phone number, a unit number, a day of the week, an hour) is "wrong".
- REWORDING. A new value that says the same thing in other words adds nothing: "wrong".
- LINKS. A sign-up link must be the field's own booking form or page, not a home page or a page for something else. A website must be the host's own.
- HOURS AND AVAILABILITY. Must be the hours of this field, now; not a past season's, not a different facility's, not the host team's meeting times.
- STATUS. Closing a field needs the page to say it is closed or no longer offered.
- SAME PAGE, OTHER THING. A page about several spaces or programmes: the value must belong to this field.

${REPLY}`

function contextBlock(ctx: Record<string, unknown>): string {
  return Object.entries(ctx)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('\n')
}

/** Pure: the prompt for one listing's changes. */
export function verifyPrompt(input: {
  today: string
  listing: Record<string, unknown>
  changes: ChangeToVerify[]
  pages: Array<{ url: string; text: string }>
}): string {
  const used = new Set(input.changes.map((c) => c.source).filter(Boolean))
  // The pages the quotes came from first and longest; the rest for context.
  const pages = [...input.pages].sort((a, b) => Number(used.has(b.url)) - Number(used.has(a.url)))
  let budget = 60_000
  const pageText: string[] = []
  for (const p of pages) {
    if (budget <= 0) break
    const take = used.has(p.url) ? Math.min(p.text.length, 25_000) : Math.min(p.text.length, 6_000)
    pageText.push(`=== PAGE ${p.url} ===\n${p.text.slice(0, Math.min(take, budget))}`)
    budget -= take
  }
  return [
    `Today is ${input.today}.`,
    '',
    'THE LISTING AS IT STANDS',
    contextBlock(input.listing),
    '',
    'PROPOSED CHANGES',
    ...input.changes.map(
      (c) => `- key: ${c.key} (${c.label})\n  from: ${c.from}\n  to: ${c.to}\n  quote: ${c.quote ?? '(none)'}\n  quote from: ${c.source ?? '(unknown)'}`,
    ),
    '',
    'WHAT WAS READ',
    ...pageText,
  ].join('\n')
}

/** Pure: verdicts out of the answer; a change the answer misses is "unsure". */
export function parseVerdicts(text: string, changes: ChangeToVerify[]): ChangeVerdict[] {
  const raw = parseJsonObject(text) as { verdicts?: Array<{ key?: unknown; verdict?: unknown; reason?: unknown }> } | null
  const byKey = new Map<string, ChangeVerdict>()
  for (const v of raw?.verdicts ?? []) {
    if (typeof v.key !== 'string') continue
    const verdict = v.verdict === 'right' || v.verdict === 'wrong' ? v.verdict : 'unsure'
    byKey.set(v.key, { key: v.key, verdict, reason: typeof v.reason === 'string' ? v.reason.slice(0, 300) : '' })
  }
  return changes.map((c) => byKey.get(c.key) ?? { key: c.key, verdict: 'unsure', reason: 'no verdict given' })
}

/** Ask. Null when the model could not be reached, which the caller treats as "write nothing". */
export async function verifyChanges(
  input: Parameters<typeof verifyPrompt>[0] & { vertical?: 'event' | 'grant' | 'field' },
): Promise<ChangeVerdict[] | null> {
  if (input.changes.length === 0) return []
  try {
    const res = await anthropic().messages.create({
      model: VERIFY_MODEL,
      max_tokens: 2000,
      system: input.vertical === 'grant' ? GRANT_SYSTEM : input.vertical === 'field' ? FIELD_SYSTEM : EVENT_SYSTEM,
      messages: [{ role: 'user', content: verifyPrompt(input) }],
    })
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return parseVerdicts(text, input.changes)
  } catch (err) {
    console.error('[verify-changes] model error:', err)
    return null
  }
}
