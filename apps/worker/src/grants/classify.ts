/**
 * Grant candidate classifier.
 *
 * The one question this file answers is "can a robotics team APPLY for the
 * money on this page". It is NOT "is this page about robotics funding".
 * Scoring relatedness instead of applicability is what filled the tools
 * directory with forum threads, bot walls and general-purpose libraries, and
 * avoiding that failure is the whole reason this classifier is separate from
 * the tools one in ../pipeline/classify.ts.
 *
 * Two gates, in order, because the Anthropic account is pay as you go:
 *
 *   1. detectGrantJunkPage() - deterministic, free. Bot walls, error shells,
 *      maintenance pages, pages with no readable text. The tools classifier
 *      has waved a Cloudflare challenge page through at 0.9 confidence, so
 *      these never reach the model.
 *   2. classifyGrantCandidate() - one Haiku call, JSON only, no tools. The
 *      page text is already on the candidate, so there is no render loop.
 *
 * What this file deliberately does NOT do is read dates. Deadlines come from
 * the extractor and are confirmed by a human, because a wrong deadline is
 * worse than no deadline. A classification is only ever a routing decision
 * for the review queue.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  GRANT_PROGRAMS,
  GRANT_GEO_SCOPES,
  GRANT_DEADLINE_TYPES,
  type GrantCandidate,
  type GrantClassification,
  type RawGrantMetadata,
} from '@the-tool-pit/db'

/** The fields the classifier reads. A full grantCandidates row satisfies this. */
export type ClassifiableGrantCandidate = Pick<
  GrantCandidate,
  'sourceUrl' | 'canonicalUrl' | 'rawMetadata'
>

// #region deterministic junk gate

/**
 * Anchored at the start of the title and kept conservative, the same shape as
 * detectJunkPage in ../jobs/enrich.ts. A real funder page whose body happens
 * to mention Cloudflare must not be caught here.
 */
const JUNK_TITLE_RE =
  /^(?:just a moment|attention required|access denied|forbidden|client challenge|are you a robot\??|checking your browser|security check|verify you are human|captcha required|page not found|404 not found|not found|error 4\d\d|error 5\d\d|site maintenance|under maintenance|temporarily unavailable|service unavailable|you are being redirected|redirecting)\b/i

const JUNK_BODY_MARKERS = [
  'enable javascript and cookies to continue',
  'checking if the site connection is secure',
  'performance & security by cloudflare',
  'please complete the security check',
  'verify you are human',
  'your browser is out of date',
]

/**
 * Below this many characters of readable text there is nothing for the model
 * to reason about, and a thin page is the usual shape of a JS shell or a
 * consent wall. Funder pages that really are this short still reach a human
 * through a manual submission, so nothing is lost that a person wanted.
 */
const MIN_CONTENT_CHARS = 200

/**
 * Deterministic detector for pages that cannot be classified. Returns a
 * suppression reason, or null when the page looks real. Free, so it always
 * runs before the model call.
 */
export function detectGrantJunkPage(
  title: string,
  body: string,
  opts: { allowShortBody?: boolean } = {},
): string | null {
  const t = title.trim()
  if (JUNK_TITLE_RE.test(t)) return `Junk page (title: "${t.slice(0, 60)}")`

  const lower = body.toLowerCase()
  // Body markers only count on a thin page, for the same reason the tools gate
  // does it: a long, real page that mentions a security check is still real.
  // These still fire when the body is only a snippet: a snippet that says
  // "verify you are human" read that off the page.
  if (body.length < 600 && JUNK_BODY_MARKERS.some((m) => lower.includes(m))) {
    return 'Bot challenge or security check page'
  }
  // The length test is the one call that needs the real page. When the caller
  // could not fetch it, a short body means we did not read the page, not that
  // the funder published an empty one, and suppressing on that would silently
  // drop real listings. ./enrich.ts passes allowShortBody in exactly that case.
  if (!opts.allowShortBody && body.trim().length < MIN_CONTENT_CHARS) {
    return `Empty or near-empty page (${body.trim().length} chars of readable text)`
  }
  return null
}

// #endregion

// #region model call

/**
 * Why the classifier can refuse to answer at all. Every one of these leaves
 * the candidate unclassified so a later pass can pick it up again, which is
 * why they are one error type and not a low-confidence result: a stored
 * confidence of 0 would look like a real verdict to the reviewer.
 */
export type ClassifierUnavailableKind = 'no_api_key' | 'credit_exhausted' | 'bad_response'

export class GrantClassifierUnavailable extends Error {
  constructor(
    public readonly kind: ClassifierUnavailableKind,
    message: string,
  ) {
    super(message)
    this.name = 'GrantClassifierUnavailable'
  }
}

/**
 * Anthropic answers a spent account with a 400 whose message carries this
 * text. It is not a transient failure and retrying burns the queue, so it is
 * caught by string match and turned into a clean "come back later".
 */
const CREDIT_EXHAUSTED_MARKER = 'credit balance is too low'

/**
 * How much page text goes into the prompt. Truncation is logged rather than
 * silent, because a cap that hides half a page is a cap on coverage.
 */
const MAX_CONTENT_CHARS = 12000

let _client: Anthropic | undefined

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

const SYSTEM_PROMPT = `You are triaging web pages for a grants directory used by FIRST robotics teams (FRC, FTC, FLL) and other youth STEM teams.

The ONLY question you answer is: can a robotics team APPLY for money (or in-kind goods) described on this page, now or in a future cycle?

That is not the same question as "is this page about robotics funding". A page can be entirely about grants to robotics teams and still be useless to us. Judge applicability, never topical relatedness.

Set isGrant=false for ALL of the following. The first one is by far the most common false positive, so check it first:

1. PAST-TENSE AWARD ANNOUNCEMENTS AND PRESS RELEASES. "We are proud to announce our 2025 grant recipients", "Team 1234 receives $5,000 from...", "Foundation awards $2M to STEM programmes". These describe money that has already been handed out. The tell is past tense plus named recipients plus no instruction on how to apply. If the page tells you who GOT it rather than how to GET it, isGrant=false and isAnnouncement=true.
2. Sponsor logo walls, "our supporters", "thank you to our partners", donor honour rolls. A list of who gave money is not an offer of money.
3. Forum threads, news articles, blog posts and newsletters about funding, including Chief Delphi threads discussing grants. Useful reading, not an application. If the thread LINKS to a real grant page, that linked page is the candidate, not the thread.
4. A programme that has permanently ended: "this grant is no longer offered", "the foundation has closed", "final round was 2019". A closed CURRENT round on a grant that recurs is NOT this, that is a real grant between cycles, so isGrant=true.
5. Pages asking the reader to DONATE or to fundraise, crowdfunding campaigns, merchandise stores, and ticket sales. Money flowing the wrong way.
6. Scholarship pages for an individual student rather than a team, unless the same page also offers team or programme funding.

Set isAggregator=true, and do NOT treat it as a rejection, when the page LISTS many separate grants (a funding-opportunities index, a "grants for STEM education" round-up, a searchable database). These pages are valuable to us as a SOURCE to crawl rather than as a listing, and a human routes them. Set isGrant=false on a pure list page, but say clearly in reasoning that it is a list worth crawling.

Set isGrant=true when a team, a school or a team's fiscal sponsor could realistically prepare and submit an application off the back of this page or a link on it. Grants that are open to any youth STEM or education programme count, they do not have to name FIRST.

Return a JSON object with these fields:
- isGrant: boolean
- isAnnouncement: boolean - past-tense award news, press release, sponsor wall, thank-you page
- isAggregator: boolean - a page listing many grants
- name: string - the grant or programme name as printed. Not the funder name unless the page gives no other name.
- funderName: string - the organisation handing out the money
- summary: 1 to 2 sentences: who can apply, for what, roughly how much. Plain English, no marketing copy.
- programs: array from ["frc","ftc","fll","any"]. Use "any" when it funds youth STEM generally rather than a named FIRST programme. Empty array if you cannot tell.
- geoScope: one of "international","national","state","region","local"
- countries: array of ISO 3166-1 alpha-2 codes, e.g. ["US","CA"]
- regions: array of state or province codes, e.g. ["MI","OH"]. REQUIRED whenever geoScope is narrower than national. Empty if the page does not say.
- awardMin: integer or null - smallest award in the page's currency, digits only
- awardMax: integer or null - largest award, digits only. If a single figure is given, put it in awardMax and leave awardMin null.
- deadlineType: one of "fixed","annual_window","rolling","unknown". Use "unknown" freely, never guess.
- confidence: 0.0 to 1.0, how sure you are that a team could apply for this
- reasoning: one or two sentences naming the evidence you used, including the rejection rule number when you rejected

Do NOT return dates of any kind. Deadlines are read and confirmed elsewhere, by a person. A guessed deadline is worse than no deadline.
Never infer a figure, a country or an eligibility rule that the page does not state. Leave it null or empty and say so in reasoning.

Return ONLY the JSON object. No markdown fences, no prose before or after.`

function buildUserContent(candidate: ClassifiableGrantCandidate): string {
  const meta: RawGrantMetadata = candidate.rawMetadata ?? {}
  const url = candidate.canonicalUrl ?? candidate.sourceUrl
  const lines: string[] = [`URL: ${url}`]

  if (meta.title) lines.push(`Title: ${meta.title}`)
  if (meta.funderName) lines.push(`Funder (as guessed by the crawler): ${meta.funderName}`)
  if (meta.description) lines.push(`Meta description: ${meta.description}`)
  if (meta.ogDescription && meta.ogDescription !== meta.description) {
    lines.push(`OG description: ${meta.ogDescription}`)
  }
  if (meta.applicationUrl) lines.push(`Application link found on page: ${meta.applicationUrl}`)
  // The discovery angle is real evidence: a search for "grant recipients" and a
  // Chief Delphi thread both push hard towards the announcement rejection.
  if (meta.discoveredVia) lines.push(`Discovered via: ${meta.discoveredVia}`)

  const body = meta.contentText ?? ''
  if (body.length > MAX_CONTENT_CHARS) {
    console.warn(
      `[grant-classify] truncated page text for ${url}: ${body.length} chars -> ${MAX_CONTENT_CHARS}`,
    )
    lines.push('', 'Page content (TRUNCATED, the page was longer):', body.slice(0, MAX_CONTENT_CHARS))
  } else if (body) {
    lines.push('', 'Page content:', body)
  } else {
    lines.push('', '(No page text was captured, judge from the metadata above alone)')
  }

  return lines.join('\n')
}

// #endregion

// #region output validation

const VALID_PROGRAMS = new Set<string>(GRANT_PROGRAMS)
const VALID_GEO_SCOPES = new Set<string>(GRANT_GEO_SCOPES)
const VALID_DEADLINE_TYPES = new Set<string>(GRANT_DEADLINE_TYPES)

/** A plausible award figure. Above this it is a phone number or a page ID. */
const MAX_AWARD = 100_000_000

/** Ceiling applied to a rejection that came back with a high confidence. */
const CONTRADICTORY_CONFIDENCE_CAP = 0.5

function cleanMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : Number(value)
  if (!Number.isFinite(n) || n < 0 || n > MAX_AWARD) return null
  return Math.round(n)
}

function cleanStringArray(value: unknown, transform: (s: string) => string): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string').map(transform).filter(Boolean))]
}

/**
 * Sanitise raw model output into the stored shape. Pure, no I/O, so it can be
 * unit tested. Anything the model invented outside our enums is dropped and
 * logged rather than written to the row, because an unknown geoScope silently
 * breaks the eligibility matcher later.
 */
export function validateGrantClassification(
  parsed: Partial<GrantClassification>,
): GrantClassification {
  const out: GrantClassification = { ...parsed }

  out.isGrant = parsed.isGrant === true
  out.isAnnouncement = parsed.isAnnouncement === true
  out.isAggregator = parsed.isAggregator === true

  // An award announcement is never itself an applicable grant. The model
  // occasionally sets both, and letting isGrant win would put a press release
  // in front of a reviewer as a real listing.
  if (out.isAnnouncement && out.isGrant) {
    console.warn('[grant-classify] model set isAnnouncement and isGrant, forcing isGrant=false')
    out.isGrant = false
  }

  if (out.programs !== undefined) {
    const before = cleanStringArray(out.programs, (s) => s.trim().toLowerCase())
    out.programs = before.filter((p) => VALID_PROGRAMS.has(p))
    const dropped = before.filter((p) => !VALID_PROGRAMS.has(p))
    if (dropped.length) console.warn(`[grant-classify] dropped unknown programs: ${dropped.join(', ')}`)
  }

  if (out.geoScope !== undefined && !VALID_GEO_SCOPES.has(out.geoScope)) {
    console.warn(`[grant-classify] unknown geoScope "${out.geoScope}", storing as undefined`)
    out.geoScope = undefined
  }

  if (out.deadlineType !== undefined && !VALID_DEADLINE_TYPES.has(out.deadlineType)) {
    console.warn(`[grant-classify] unknown deadlineType "${out.deadlineType}", storing as "unknown"`)
    out.deadlineType = 'unknown'
  }

  // ISO 3166-1 alpha-2 only. "United States" is not a country code and would
  // never match a team profile.
  if (out.countries !== undefined) {
    out.countries = cleanStringArray(out.countries, (s) => s.trim().toUpperCase()).filter((c) =>
      /^[A-Z]{2}$/.test(c),
    )
  }
  if (out.regions !== undefined) {
    out.regions = cleanStringArray(out.regions, (s) => s.trim().toUpperCase())
  }

  out.awardMin = cleanMoney(out.awardMin)
  out.awardMax = cleanMoney(out.awardMax)
  if (out.awardMin !== null && out.awardMax !== null && out.awardMin > out.awardMax) {
    // A single figure read into the wrong slot. Swap rather than drop, a
    // reviewer can see both numbers on the page.
    const swap = out.awardMin
    out.awardMin = out.awardMax
    out.awardMax = swap
  }

  const conf = Number(out.confidence)
  out.confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0

  // confidence means "how sure that a team can apply", so isGrant=false at 0.9
  // is the model answering a different question ("how sure am I of my verdict").
  // The review queue sorts on this number, and left alone a confidently rejected
  // press release sorts above a real grant the model was unsure about. Clamp and
  // log rather than drop, the reviewer still gets the row and the reasoning.
  if (!out.isGrant && !out.isAggregator && out.confidence > CONTRADICTORY_CONFIDENCE_CAP) {
    console.warn(
      `[grant-classify] isGrant=false with confidence ${out.confidence.toFixed(2)}, ` +
        `capping to ${CONTRADICTORY_CONFIDENCE_CAP} (model answered the wrong question)`,
    )
    out.confidence = CONTRADICTORY_CONFIDENCE_CAP
  }

  for (const key of ['name', 'funderName', 'summary', 'reasoning'] as const) {
    const v = out[key]
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : undefined
  }

  return out
}

function parseClassification(text: string): GrantClassification {
  // The prompt forbids fences, but Haiku adds them anyway often enough that
  // stripping them is cheaper than a retry.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = (fenceMatch ? fenceMatch[1] : text).trim()
  return validateGrantClassification(JSON.parse(jsonText) as Partial<GrantClassification>)
}

// #endregion

/**
 * Classify one candidate. Callers must run detectGrantJunkPage first, this
 * function assumes the page is worth a paid call.
 *
 * Throws GrantClassifierUnavailable when no verdict could be produced at all
 * (no key, spent account, unparseable reply). The caller leaves the candidate
 * unclassified for a later pass rather than storing a fake verdict.
 */
export async function classifyGrantCandidate(
  candidate: ClassifiableGrantCandidate,
): Promise<GrantClassification> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new GrantClassifierUnavailable('no_api_key', 'ANTHROPIC_API_KEY is not set')
  }

  const url = candidate.canonicalUrl ?? candidate.sourceUrl

  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(candidate) }],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes(CREDIT_EXHAUSTED_MARKER)) {
      // Not transient and not this candidate's fault. Retrying would spend the
      // queue's attempts on a wall, so surface it as its own state.
      throw new GrantClassifierUnavailable(
        'credit_exhausted',
        `Anthropic credit balance exhausted while classifying ${url}`,
      )
    }
    // Anything else (rate limit, 500, network) is worth a BullMQ retry, so let
    // it out as-is.
    throw err
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new GrantClassifierUnavailable('bad_response', `No text block in reply for ${url}`)
  }

  try {
    return parseClassification(textBlock.text)
  } catch {
    throw new GrantClassifierUnavailable(
      'bad_response',
      `Unparseable JSON for ${url}: ${textBlock.text.slice(0, 200)}`,
    )
  }
}
