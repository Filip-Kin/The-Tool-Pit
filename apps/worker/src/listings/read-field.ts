/**
 * Read one practice-field candidate properly.
 *
 * The connector files a thread URL, a title, a team number when the title names
 * one, and the links. Everything a team actually needs in order to go and use
 * the field, the address, the hours, who to ask, whether it is a full field, is
 * left blank, and the connector's own comment explains why: a thread saying
 * "full field with real game pieces" may be describing what the poster HAS,
 * what they WANT, or what somebody else has, and a regex cannot tell those
 * apart. That reasoning is right about regexes.
 *
 * A reader that understands the sentence can tell, and every value it gives
 * back carries the sentence it came from, so a moderator checks the words
 * rather than trusting a label. Same shape as read-event.ts, same shared model
 * call and same shared quote checking.
 *
 * COORDINATES ARE NOT READ HERE. A pin is a claim about a building and the
 * publish gate requires one; a model reading "just north of Grand Rapids" would
 * produce a plausible pin in the wrong car park. The address goes in, and a
 * person places the pin.
 *
 * NOTHING HERE PUBLISHES.
 */
import {
  FIELD_PROGRAMS,
  FIELD_COVERAGE,
  FIELD_PERIMETER,
  FIELD_ELEMENTS,
  FIELD_AVAILABILITY,
  type ExtractedPracticeFieldFields,
} from '@the-tool-pit/db'
import { askWithPages } from '../model/page-reader.js'
import { parseJsonObject, quoteSource, urlSource, type NamedText } from '../model/evidence.js'

const SYSTEM_PROMPT = `You are reading one Chief Delphi thread in which a FIRST Robotics team offers other teams the use of their practice field, and writing down the details for a directory.

If the thread links to a sign-up form, a booking page or the team's site, OPEN IT: the address and the hours are often there and not in the post.

Return ONE JSON object. Every key is an object: {"value": ..., "quote": "..."}.

- The quote is the words from the thread or a page you opened that state the value, copied EXACTLY. Not a paraphrase.
- If you cannot find a field, return {"value": null, "quote": null}. Null is a fine answer; a wrong value is not. A wrong address sends a team on a two-hour drive to a locked door.
- Describe the field being OFFERED. A post often mentions other fields, or what the poster wishes they had. If the thread is asking for a field rather than offering one, return {"value": null, "quote": null} for everything and put why in notes.
- For a URL the quote may be the URL itself.

Fields:
  name           what to call the place, e.g. "Team 195 Practice Field" or the facility's name
  teamNumber     integer team number of the team offering it
  teamName       the team's name
  program        one of ${FIELD_PROGRAMS.map((p) => `"${p}"`).join(', ')}
  address        street address of the building
  city           town or city
  region         state or province, the two-letter code where there is one
  country        two-letter code, "US" or "CA"
  hours          when it can be used, in the poster's own words
  availability   one of ${FIELD_AVAILABILITY.map((a) => `"${a}"`).join(', ')}
  coverage       one of ${FIELD_COVERAGE.map((c) => `"${c}"`).join(', ')}, how much of a field is set up
  perimeter      one of ${FIELD_PERIMETER.map((p) => `"${p}"`).join(', ')}
  elements       one of ${FIELD_ELEMENTS.map((e) => `"${e}"`).join(', ')}, shop-built wood or real official pieces
  hasFms         true or false, whether they have a Field Management System
  ceilingHeightFt  integer feet, when the post says
  contactInfo    how to get in touch: an email, or "message @user on the FiM Discord"
  contactUrl     a booking or sign-up form
  website        the team's own site
  notes          one or two sentences a visiting team would want that no other field holds

Do not guess coordinates. Return only the JSON object.`

const ENUMS: Record<string, readonly string[]> = {
  program: FIELD_PROGRAMS,
  availability: FIELD_AVAILABILITY,
  coverage: FIELD_COVERAGE,
  perimeter: FIELD_PERIMETER,
  elements: FIELD_ELEMENTS,
}

const URL_FIELDS = new Set(['contactUrl', 'website'])
const INT_FIELDS = new Set(['teamNumber', 'ceilingHeightFt'])
const BOOL_FIELDS = new Set(['hasFms'])
const TEXT_MAX: Record<string, number> = {
  name: 160, teamName: 120, address: 200, city: 120, region: 60, country: 8,
  hours: 200, contactInfo: 300, notes: 400,
}

export interface FieldRead {
  fields: ExtractedPracticeFieldFields
  evidence: Record<string, { quote: string; source: string }>
  pagesRead: string[]
  rejected: string[]
}

export function validateFieldRead(
  raw: Record<string, unknown>,
  sources: ReadonlyArray<NamedText<string>>,
): { fields: ExtractedPracticeFieldFields; evidence: Record<string, { quote: string; source: string }>; rejected: string[] } {
  const fields: Record<string, unknown> = {}
  const kept: Record<string, { quote: string; source: string }> = {}
  const rejected: string[] = []

  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue
    const { value, quote } = entry as { value?: unknown; quote?: unknown }
    if (value === null || value === undefined || value === '') continue

    const quoteText = typeof quote === 'string' ? quote : ''
    const source = URL_FIELDS.has(key)
      ? typeof value === 'string'
        ? urlSource(value, sources)
        : null
      : quoteSource(quoteText, sources, 10)

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
    } else if (BOOL_FIELDS.has(key)) {
      if (typeof value !== 'boolean') {
        rejected.push(`${key}: expected true or false`)
        continue
      }
      fields[key] = value
    } else if (INT_FIELDS.has(key)) {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n) || n <= 0 || n > 100_000) {
        rejected.push(`${key}: "${String(value)}" is not a plausible number`)
        continue
      }
      fields[key] = Math.round(n)
    } else if (URL_FIELDS.has(key)) {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
        rejected.push(`${key}: "${String(value)}" is not an absolute URL`)
        continue
      }
      fields[key] = value
    } else {
      if (typeof value !== 'string') {
        rejected.push(`${key}: expected text`)
        continue
      }
      fields[key] = value.trim().slice(0, TEXT_MAX[key] ?? 300)
    }

    kept[key] = { quote: quoteText.slice(0, 300), source }
  }

  return { fields: fields as ExtractedPracticeFieldFields, evidence: kept, rejected }
}

/** Read one candidate. Null when the model could not be reached at all. */
export async function readFieldCandidate(input: {
  threadUrl: string
  title: string
  threadText: string
  links?: string[]
}): Promise<FieldRead | null> {
  const answer = await askWithPages({
    model: 'claude-sonnet-5',
    system: SYSTEM_PROMPT,
    user: [
      `Chief Delphi thread: ${input.threadUrl}`,
      `Thread title: ${input.title}`,
      input.links?.length ? `Links in the post: ${input.links.slice(0, 8).join(', ')}` : '',
      '',
      'Opening post:',
      input.threadText.slice(0, 20_000),
    ]
      .filter(Boolean)
      .join('\n'),
    maxTokens: 4000,
    maxTurns: 8,
    maxPages: 5,
    fallbackUrl: input.threadUrl,
    logPrefix: '[read-field]',
  })
  if (!answer) return null

  const raw = parseJsonObject(answer.text)
  if (!raw) {
    console.error('[read-field] could not parse the answer:', answer.text.slice(0, 200))
    return null
  }

  const sources: NamedText<string>[] = [
    { source: 'thread', text: `${input.title}\n${input.threadText}\n${(input.links ?? []).join('\n')}` },
    ...answer.pages.map((p) => ({ source: p.url, text: p.text })),
  ]

  const checked = validateFieldRead(raw, sources)
  return {
    fields: checked.fields,
    evidence: checked.evidence,
    pagesRead: answer.pages.map((p) => p.url),
    rejected: [...checked.rejected, ...answer.failed.map((u) => `could not open ${u}`)],
  }
}
