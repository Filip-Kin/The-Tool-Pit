/**
 * Read one off-season event candidate properly.
 *
 * The connector reads a Chief Delphi thread with regular expressions and files
 * what a pattern can see. Across the first 13 candidates that was venue on 0,
 * city on 0, cost on 0, and a start date on 6, one of which was wrong: Beach
 * Blitz runs 30 October to 1 November and the parser recorded 1 November,
 * because "October 30 - Sunday, November 1" puts a weekday where the pattern
 * wanted a month.
 *
 * The same thread says, in words anybody reads instantly:
 *
 *   Dates: Friday, October 30 - Sunday, November 1, 2026
 *   Location: Capistrano Valley High School, Mission Viejo, California
 *
 * and links to beachblitz.org, whose /pay page carries the entry fee. Another
 * regex loses to the next thread that words it differently, and loses quietly.
 *
 * SAME SHAPE AS THE REST OF THE PLATFORM. The model call with a page tool is
 * model/page-reader.ts, shared with pipeline/classify.ts. The quote checking is
 * model/evidence.ts, shared with grants/candidate-extract.ts. What is here is
 * the two things that are actually specific to an event: what to ask for, and
 * what a valid answer looks like.
 *
 * NOTHING HERE PUBLISHES. It fills in a candidate a person still has to accept
 * and then approve.
 */
import {
  EVENT_PROGRAMS,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
  type ExtractedEventListingFields,
  type EventFieldEvidence,
} from '@the-tool-pit/db'
import { askWithPages } from '../model/page-reader.js'
import { parseJsonObject, quoteSource, urlAsWritten, type NamedText } from '../model/evidence.js'

const SYSTEM_PROMPT = `You are reading one off-season FIRST Robotics competition and writing down its details for a directory.

You get a Chief Delphi thread. It usually links to the event's own website. OPEN IT, then open only the few pages it links to that carry what you still need: registration, sign-up, apply, pay, cost, tickets, volunteer, schedule, contact. The entry fee is very often on a pay or registration page and almost never in the thread.

FOLLOW THE LINKS YOU ARE SHOWN. Every page comes back with the links on it. Open the ones whose text or path says they carry what you need, and do NOT invent a path: guessing "/registration" on a site whose page is called "/bordie-through-time-2026" wastes a load on a 404 and misses the page with the venue and the cost on it.

MIND THE YEAR. These sites keep every past event up, so the same site has a registration page for this year and for three previous ones. Work out which pages belong to the event in the thread, and take nothing from a past event: last year's price on this year's listing is worse than no price.

Be economical. You have a small number of page loads. Do not open a sitemap, a sponsor, a venue's Wikipedia article, or anything on another site: none of them can tell you what this event charges. When you have enough, answer.

Return ONE JSON object. Every key is an object: {"value": ..., "quote": "..."}.

- The quote is the words from the thread or a page you opened that state the value, copied EXACTLY. Not a paraphrase.
- If you cannot find a field, return {"value": null, "quote": null}. Null is a fine answer; a wrong value is not. A wrong venue sends a team to the wrong building on a Saturday morning.
- For a URL the quote may be the URL itself.

Fields:
  name              the event's own name
  program           one of ${EVENT_PROGRAMS.map((p) => `"${p}"`).join(', ')}
  hostTeamNumber    integer team number of the host, when one team runs it
  venueName         the building, e.g. "Capistrano Valley High School"
  address           street address
  city              town or city
  region            state or province, the two-letter code where there is one
  country           two-letter code, "US" or "CA"
  startDate         "YYYY-MM-DD", the FIRST day. "October 30 - November 1" starts on 30 October
  endDate           "YYYY-MM-DD", the LAST day. Null for a one-day event
  days              1 or 2: how many days of COMPETITION there are, which is not the same as how
                    many days the event spans. Off-season events very often open with a day of
                    load-in, move-in, setup, pit hours, inspection or practice matches only, and
                    that day does not count. "Friday, October 30 - Sunday, November 1 (Friday
                    load-in and practice matches in the late afternoon)" is TWO days of
                    competition, not three. If the source does not distinguish, count the days
                    that have qualification or elimination matches on them.
  capacity          integer, how many teams can enter
  costUsd           integer US dollars per team to enter, so 250 for "$250 per team"
  costNote          ONLY when the price is not one flat number: a discount for a second robot, a
                    cheaper combined price for both days of a two-day event, a different rate for
                    FTC than FRC, an early-bird deadline, or a fee charged on top. Do NOT restate
                    costUsd here: "$300 registration fee" next to costUsd 300 is noise. If the
                    price is a single figure, return null.
  registrationStatus  where team sign-ups have got to. These are four different things and the
                    difference matters to a team deciding whether to act today:
                      "not_open"  sign-ups have not started. "Save the date", "applications open in
                                  a couple of weeks", "registration opens 1 September"
                      "open"      a team can sign up right now
                      "waitlist"  full, but still taking names
                      "closed"    sign-ups have ENDED, or the field is full and no list is being kept.
                                  "Applications closed", "accepted teams were notified in August"
                      "unknown"   nothing you read says
                    Never answer "closed" for an event whose sign-ups have not opened yet.
  volunteerStatus     one of ${VOLUNTEER_STATUSES.map((s) => `"${s}"`).join(', ')}, same distinction:
                    "not_open" is a sign-up that has not started, not one that has finished
  registrationUrl   where a team signs up
  volunteerUrl      where a volunteer signs up
  website           the event's own site
  contactEmail      an email address for the organisers
  notes             the source's OWN sentence that a reader would want and no other field holds,
                    quoted, not summarised. If the thread says "More information and registration
                    will arrive soon, so be sure to bookmark this thread", that IS the note. Do not
                    write your own description of what the thread did or did not say.

Return only the JSON object.`

const ENUMS: Record<string, readonly string[]> = {
  program: EVENT_PROGRAMS,
  registrationStatus: REGISTRATION_STATUSES,
  volunteerStatus: VOLUNTEER_STATUSES,
}

const URL_FIELDS = new Set(['registrationUrl', 'volunteerUrl', 'website'])
const INT_FIELDS = new Set(['hostTeamNumber', 'capacity', 'costUsd', 'days'])
const DATE_FIELDS = new Set(['startDate', 'endDate'])
const TEXT_MAX: Record<string, number> = {
  name: 160, venueName: 160, address: 200, city: 120, region: 60, country: 8,
  costNote: 200, contactEmail: 200, notes: 400,
}

export interface EventRead {
  fields: ExtractedEventListingFields
  evidence: EventFieldEvidence
  pagesRead: string[]
  /** Everything dropped, and why. Shown to the reviewer, never hidden. */
  rejected: string[]
}

/**
 * Keep only what the evidence supports.
 *
 * Same rule as the grants extractor: a value whose quote is not in anything we
 * read is dropped. A model is good at reading a page and, like anyone, capable
 * of filling a gap with something plausible.
 */
export function validateEventRead(
  raw: Record<string, unknown>,
  sources: ReadonlyArray<NamedText<string>>,
): { fields: ExtractedEventListingFields; evidence: EventFieldEvidence; rejected: string[] } {
  const fields: Record<string, unknown> = {}
  const kept: EventFieldEvidence = {}
  const rejected: string[] = []

  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue
    const { value, quote } = entry as { value?: unknown; quote?: unknown }
    if (value === null || value === undefined || value === '') continue

    const quoteText = typeof quote === 'string' ? quote : ''

    // A URL is taken as the page wrote it, not as the model typed it back: an
    // answer of "/volunteer" against a page linking "/volunteer/index.html" is
    // a link that usually redirects, and usually is not good enough for a link
    // somebody is about to click.
    let checked = value
    let source: string | null
    if (URL_FIELDS.has(key)) {
      const written = typeof value === 'string' ? urlAsWritten(value, sources) : null
      source = written?.source ?? null
      if (written) checked = written.url
    } else {
      source = quoteSource(quoteText, sources, 10)
    }

    if (!source) {
      rejected.push(`${key}: nothing that was read contains that`)
      continue
    }

    if (ENUMS[key]) {
      if (typeof value !== 'string' || !ENUMS[key].includes(value)) {
        rejected.push(`${key}: "${String(value)}" is not one of ${ENUMS[key].join(', ')}`)
        continue
      }
      fields[key] = value
    } else if (INT_FIELDS.has(key)) {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
        rejected.push(`${key}: "${String(value)}" is not a plausible number`)
        continue
      }
      fields[key] = Math.round(n)
    } else if (DATE_FIELDS.has(key)) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        rejected.push(`${key}: "${String(value)}" is not an ISO date`)
        continue
      }
      fields[key] = value
    } else if (URL_FIELDS.has(key)) {
      if (typeof checked !== 'string' || !/^https?:\/\//i.test(checked)) {
        rejected.push(`${key}: "${String(checked)}" is not an absolute URL`)
        continue
      }
      fields[key] = checked
    } else {
      if (typeof value !== 'string') {
        rejected.push(`${key}: expected text`)
        continue
      }
      fields[key] = value.trim().slice(0, TEXT_MAX[key] ?? 300)
    }

    kept[key] = { quote: quoteText.slice(0, 300), source }
  }

  // Competition days is 1 or 2 by definition of the column. Anything else is
  // the span being counted instead, which is the mistake the prompt spells out.
  if (typeof fields.days === 'number' && fields.days !== 1 && fields.days !== 2) {
    rejected.push(`days: ${fields.days} is not 1 or 2, so it is counting the span rather than the competition`)
    delete fields.days
  }

  // An end before a start is a misread, and days would come out negative.
  if (typeof fields.startDate === 'string' && typeof fields.endDate === 'string' && fields.endDate < fields.startDate) {
    rejected.push(`endDate ${fields.endDate} is before startDate ${fields.startDate}, both dropped`)
    delete fields.startDate
    delete fields.endDate
  }

  return { fields: fields as ExtractedEventListingFields, evidence: kept, rejected }
}

/** Read one candidate. Null when the model could not be reached at all. */
export async function readEventCandidate(input: {
  threadUrl: string
  title: string
  threadText: string
  website?: string
}): Promise<EventRead | null> {
  const answer = await askWithPages({
    model: 'claude-sonnet-5',
    system: SYSTEM_PROMPT,
    user: [
      `Chief Delphi thread: ${input.threadUrl}`,
      `Thread title: ${input.title}`,
      input.website ? `The thread links to: ${input.website}` : '',
      '',
      'Opening post:',
      input.threadText.slice(0, 20_000),
    ]
      .filter(Boolean)
      .join('\n'),
    maxTokens: 4000,
    // Enough turns to open the site and a few pages behind it, then answer.
    maxTurns: 10,
    maxPages: 8,
    fallbackUrl: input.website ?? input.threadUrl,
    logPrefix: '[read-event]',
  })
  if (!answer) return null

  const raw = parseJsonObject(answer.text)
  if (!raw) {
    console.error('[read-event] could not parse the answer:', answer.text.slice(0, 200))
    return null
  }

  // What the model was allowed to see, which is what its quotes are checked
  // against. The thread first, so a fact in both is credited to the thread.
  const sources: NamedText<string>[] = [
    { source: 'thread', text: `${input.title}\n${input.threadText}\n${input.threadUrl}\n${input.website ?? ''}` },
    // The links are part of what was read, so a URL the reader took off a
    // button verifies against the page that carried it.
    ...answer.pages.map((p) => ({ source: p.url, text: `${p.text}\n${p.links.join('\n')}` })),
  ]

  const checked = validateEventRead(raw, sources)
  return {
    fields: checked.fields,
    evidence: checked.evidence,
    pagesRead: answer.pages.map((p) => p.url),
    rejected: [...checked.rejected, ...answer.failed.map((u) => `could not open ${u}`)],
  }
}
