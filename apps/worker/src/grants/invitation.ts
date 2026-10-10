/**
 * Invitation only: does the funder take applications only from organisations
 * it has invited?
 *
 * Many employer and corporate foundation grants work this way. The Hershey
 * Company: "you may only apply for a grant if you receive an invitation".
 * Such a grant is still worth listing, because a team with a contact at the
 * company can ask for an invitation, but it is not an open grant: it is
 * labelled, hidden from the public list by default, and never sent to a team
 * as a match (grants.invitation_only, see packages/db/src/schema/grants.ts).
 *
 * TWO LAYERS. The detector below is a high-recall candidate finder: pure,
 * deterministic, no model. A 2026-10 dry run over 150 published grants found
 * 12 candidates and only 3 were right; the other 9 scoped invitation-only to
 * PART of the funder's giving ("two of our Focus Areas ... are by invitation
 * only", "Other types of funding is by invitation only", a FIRST team grant
 * beside a corporate foundation's invite-only general grants). Whether a
 * sentence covers the listed programme is judgement, so confirmInvitationOnly
 * asks the model, and only when the detector found a candidate.
 *
 * The detector is pure over page text and deterministic, so the same page always gets the same
 * answer and the quote is always a sentence that is on the page. The caller
 * passes the FUNDER's own text (the programme page, the application page),
 * never an aggregator blurb: someone else's summary is not the funder's word.
 *
 * What counts, one sentence at a time:
 *   - "invitation only", "invitation-only", "by invitation", "invite only";
 *   - "only ... if you receive (or are sent) an invitation";
 *   - "only ... invited" (only invited organisations may apply), "must be
 *     invited to apply", "accepted from invited organisations";
 *   - "does not accept unsolicited proposals / requests / applications",
 *     "unsolicited requests are not accepted", "no unsolicited proposals";
 *   - "unless requested (to do so) by" / "unless invited by".
 *
 * What does not, because it is wrong often enough to matter:
 *   - the SECOND stage of a two-stage process. "Submit a letter of intent;
 *     selected applicants are invited to submit a full proposal" is open to
 *     anyone at stage one. A sentence that names a full proposal, a finalist,
 *     a next stage, or an invitation that follows a letter of inquiry, is
 *     dropped; so is an "unsolicited proposals" sentence when the funder says,
 *     in the same or a neighbouring sentence, to start with a letter of
 *     inquiry or a pre-proposal.
 *   - an invitation-only event ("Join us for an invitation-only gala"): the
 *     sentence must be about applying or grants, and an event noun right after
 *     "invitation only" rules it out.
 *   - a negation ("this grant is not invitation-only").
 *   - "we invite applications from ...": an open call, not an invitation.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'

export interface InvitationOnlyResult {
  invitationOnly: boolean
  /** The sentence that says so, whitespace-collapsed, as it appears on the page. Null when invitationOnly is false. */
  quote: string | null
  /**
   * About CONTEXT_CHARS of page text either side of the sentence, for the
   * model that decides whether the sentence covers THIS grant
   * (confirmInvitationOnly). Null when invitationOnly is false.
   */
  context: string | null
}

/** One sentence the detector flagged, with where it was read and what surrounds it. */
export interface InvitationCandidate {
  url: string
  sentence: string
  context: string
}

const QUOTE_LIMIT = 400
const CONTEXT_CHARS = 600

// #region patterns

/** Phrasings about who may apply. Each is tested against one sentence. */
const INVITE_PATTERNS: RegExp[] = [
  /\binvit(?:ation|e)[- ]only\b/i,
  /\bby invitation\b/i,
  /\bon an invitation(?:al)? basis\b/i,
  // "you may only apply for a grant if you receive an invitation"
  /\bonly\b[^.;:]{0,100}\bif\b[^.;:]{0,60}\b(?:receive[sd]?|are sent|is sent|have received|has received|been sent|get|gets)\b[^.;:]{0,30}\binvitation\b/i,
  // "only organisations invited by the foundation may apply", "accepted only from invited ..."
  /\bonly\b[^.;:]{0,80}\binvited\b/i,
  /\b(?:only|solely|exclusively)\b[^.;:]{0,60}\b(?:receive|received|with|holding)\b[^.;:]{0,15}\binvitation\b/i,
  // "organisations must be invited to apply", "must first receive an invitation"
  /\bmust (?:first )?(?:be invited|receive an invitation|have (?:an|received an) invitation)\b/i,
  // "proposals are accepted from invited organisations"
  /\b(?:accept(?:s|ed)?|consider(?:s|ed)?|review(?:s|ed)?|fund(?:s|ed)?)\b[^.;:]{0,30}\b(?:from|of) invited\b/i,
]

const UNSOLICITED_OBJECT =
  '(?:grant )?(?:proposals?|requests?|applications?|submissions?|solicitations?|inquir(?:y|ies)|letters? of (?:inquiry|intent|interest)|requests? for (?:funding|support|grants?)|grant requests?|funding requests?)'

/** "We do not accept unsolicited ..." and its turns of phrase. */
const UNSOLICITED_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(?:do(?:es)?\\s+not|don['’]t|doesn['’]t|will\\s+not|won['’]t|cannot|can['’]t|is\\s+not|are\\s+not|no\\s+longer|unable\\s+to)\\s+(?:currently\\s+|presently\\s+)?(?:accept(?:ing)?|consider(?:ing)?|review(?:ing)?|fund(?:ing)?|respond(?:ing)?\\s+to|entertain(?:ing)?|solicit(?:ing)?)\\s+(?:any\\s+|new\\s+)?unsolicited\\s+${UNSOLICITED_OBJECT}`,
    'i',
  ),
  new RegExp(`\\bunsolicited\\s+${UNSOLICITED_OBJECT}\\s+(?:are|is|will)\\s+not\\s+(?:be\\s+)?(?:accepted|considered|reviewed|funded|acknowledged)\\b`, 'i'),
  new RegExp(`\\bno\\s+unsolicited\\s+${UNSOLICITED_OBJECT}\\b`, 'i'),
  /\bunless\s+(?:specifically\s+|expressly\s+|otherwise\s+)?(?:requested|invited|asked)(?:\s+to\s+do\s+so)?\s+by\b/i,
  /\bunless\s+(?:you\s+are\s+|you\s+have\s+been\s+|it\s+is\s+|they\s+are\s+)?(?:specifically\s+)?(?:invited|requested)\s+to\s+(?:apply|submit)\b/i,
]

/** The sentence is about applying for money, not about a party. */
const APPLY_CONTEXT = /\b(?:grants?|apply|applying|applications?|applicants?|proposals?|requests?|submit|submissions?|funding|funded|fund|considered|consideration|eligible|eligibility|nominations?|sponsorships?|donations?|contributions?|support)\b/i

/** "invitation-only gala": an event, not a grant. */
const EVENT_AFTER = /^\W{0,3}(?:events?|gala|galas|receptions?|dinners?|luncheons?|breakfasts?|celebrations?|ceremon(?:y|ies)|parties|party|webinars?|meetings?|tours?|previews?|summits?|sessions?|workshops?|conferences?|briefings?|launch|screenings?|retreats?|convenings?|forums?|panels?|networking)\b/i
const EVENT_WORD = /\b(?:gala|reception|dinner|luncheon|breakfast|celebration|ceremony|party|webinar|screening|tour|summit|conference|networking event)\b/i

/**
 * The invitation is to a LATER stage: a full proposal, a finalist round, a
 * second stage, or something that follows a letter of inquiry.
 */
const NEXT_STAGE =
  /\b(?:full|final|complete|formal|detailed|second[- ]stage|stage[- ]two)\s+(?:grant\s+)?(?:proposals?|applications?|requests?)\b|\b(?:semi-?)?finalists?\b|\b(?:next|second|later|subsequent|final)\s+(?:stage|step|round|phase)\b|\b(?:stage|round|phase)\s+(?:2|two|ii)\b|\binvited\s+to\s+(?:present|interview|pitch|attend|participate|meet)\b|\bsite visits?\b|\binterviews?\b|\b(?:after|following|upon|based on|once)\b[^.;]{0,80}\b(?:letters? of (?:inquiry|intent|interest)|LOIs?|inquir(?:y|ies)|pre-?proposals?|pre-?applications?|concept (?:papers?|notes?)|initial (?:applications?|proposals?|requests?|review))\b/i

/** An open first stage the funder asks for: the way in for anybody. */
const OPEN_FIRST_STAGE =
  /\b(?:submit|send|complete|file|fill out|begin(?:s)? with|start(?:s)? (?:with|by)|first step|accepts?|accepting|welcomes?|invites?|reviews?)\b[^.;]{0,60}\b(?:letters? of (?:inquiry|intent|interest)|LOIs?|pre-?proposals?|pre-?applications?|concept (?:papers?|notes?)|inquiry forms?|eligibility (?:quiz|questionnaire)|initial inquir(?:y|ies))\b|\b(?:letters? of (?:inquiry|intent|interest)|LOIs?|pre-?proposals?|inquir(?:y|ies))\b[^.;]{0,40}\b(?:are|is|may be|can be)\s+(?:accepted|welcome[d]?|due|open|submitted|reviewed)\b/i

const NEGATION = /\b(?:not|no|never|isn['’]t|aren['’]t|without)\b|n['’]t\b/i

// #endregion

// #region sentences

/**
 * Split page text into sentences. Line breaks end a sentence too: a heading
 * ("Invitation only") is a sentence of its own on most pages.
 */
export function sentencesOf(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n+/)) {
    for (const part of line.split(/(?<=[.!?])\s+(?=[*\u2022]|["'“(\[]?[A-Z0-9])/)) {
      const s = part.replace(/\s+/g, ' ').trim()
      if (s) out.push(s)
    }
  }
  return out
}

function negatedBefore(sentence: string, index: number): boolean {
  const before = sentence.slice(Math.max(0, index - 30), index)
  return NEGATION.test(before)
}

/** An open first stage stated affirmatively, not "we do not accept letters of inquiry". */
function opensFirstStage(text: string): boolean {
  const m = OPEN_FIRST_STAGE.exec(text)
  if (!m) return false
  if (NEGATION.test(m[0])) return false
  return !negatedBefore(text, m.index)
}

// #endregion

// #region detector

function inviteHit(sentence: string): boolean {
  for (const re of INVITE_PATTERNS) {
    const m = re.exec(sentence)
    if (!m) continue
    if (negatedBefore(sentence, m.index)) continue
    const after = sentence.slice(m.index + m[0].length)
    if (/invit(?:ation|e)[- ]only$/i.test(m[0]) && EVENT_AFTER.test(after)) continue
    return true
  }
  return false
}

function unsolicitedHit(sentence: string): { index: number; end: number } | null {
  for (const re of UNSOLICITED_PATTERNS) {
    const m = re.exec(sentence)
    if (m) return { index: m.index, end: m.index + m[0].length }
  }
  return null
}

/** Every flagged sentence on one page, in page order. */
function flaggedSentences(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return []
  const out: string[] = []
  const sentences = sentencesOf(text)
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    const neighbours = [sentences[i - 1] ?? '', sentences[i + 1] ?? '']

    if (inviteHit(s)) {
      // No apply word AND an event word: a party, not a grant. Otherwise a
      // sentence with no apply word still goes to the model ("Honda may extend
      // invitation-only opportunities to select community partners").
      if (!APPLY_CONTEXT.test(s) && EVENT_WORD.test(s)) continue
      if (EVENT_WORD.test(s) && !/\b(?:apply|applying|applications?|proposals?|submit)\b/i.test(s)) continue
      if (NEXT_STAGE.test(s)) continue
      if (opensFirstStage(s) || neighbours.some(opensFirstStage)) continue
      out.push(s)
      continue
    }

    const u = unsolicitedHit(s)
    if (u) {
      // "We do not accept unsolicited proposals; instead, submit a letter of
      // inquiry" is a two-stage process with an open first stage.
      const rest = s.slice(u.end)
      if (opensFirstStage(rest) || neighbours.some(opensFirstStage)) continue
      out.push(s)
    }
  }
  return out
}

/** CONTEXT_CHARS of the whitespace-collapsed page either side of the sentence. */
function contextAround(text: string, sentence: string): string {
  const collapsed = text.replace(/\s+/g, ' ')
  const at = collapsed.indexOf(sentence)
  if (at < 0) return sentence
  const start = Math.max(0, at - CONTEXT_CHARS)
  const end = Math.min(collapsed.length, at + sentence.length + CONTEXT_CHARS)
  return `${start > 0 ? '...' : ''}${collapsed.slice(start, end)}${end < collapsed.length ? '...' : ''}`
}

/**
 * The candidate finder. The first flagged sentence with its context, or
 * { invitationOnly: false, quote: null, context: null }. "invitationOnly: true"
 * here means "a candidate", not a verdict: confirmInvitationOnly decides.
 */
export function detectInvitationOnly(text: string | null | undefined): InvitationOnlyResult {
  const [first] = flaggedSentences(text)
  if (!first) return { invitationOnly: false, quote: null, context: null }
  return { invitationOnly: true, quote: first.slice(0, QUOTE_LIMIT), context: contextAround(text!, first) }
}

/**
 * Every candidate sentence on every page, for confirmInvitationOnly. A page
 * may scope invitation-only to one focus area early on and state it for the
 * whole programme later, so all of them go to the model, not just the first.
 * `urlOf` attributes a sentence to a page when one text holds several (the
 * funder text enrich.ts assembles); default is the page's own URL.
 */
export function findInvitationCandidates(
  pages: ReadonlyArray<{ url: string; text: string | null | undefined }>,
  urlOf?: (text: string, sentence: string, pageUrl: string) => string,
): InvitationCandidate[] {
  const out: InvitationCandidate[] = []
  for (const p of pages) {
    for (const sentence of flaggedSentences(p.text)) {
      out.push({
        url: urlOf ? urlOf(p.text!, sentence, p.url) : p.url,
        sentence: sentence.slice(0, QUOTE_LIMIT),
        context: contextAround(p.text!, sentence),
      })
    }
  }
  return out
}

/**
 * The detector over several pages the caller read, in order. Returns the
 * first page that says it, with that page's URL as the proof URL.
 */
export function detectInvitationOnlyInPages(
  pages: ReadonlyArray<{ url: string; text: string | null | undefined }>,
): InvitationOnlyResult & { url: string | null } {
  for (const p of pages) {
    const r = detectInvitationOnly(p.text)
    if (r.invitationOnly) return { ...r, url: p.url }
  }
  return { invitationOnly: false, quote: null, context: null, url: null }
}

/**
 * Which page a quote came off, in the funder text enrich.ts assembles: the
 * programme page first, then each followed page after an "Apply at: <url>"
 * line. The quote belongs to the last such page that starts before it; a quote
 * ahead of every marker is the programme page's.
 */
export function invitationQuoteUrl(funderPage: string, quote: string, firstUrl: string): string {
  const collapsed = funderPage.replace(/\s+/g, ' ')
  const at = collapsed.indexOf(quote)
  if (at < 0) return firstUrl
  let url = firstUrl
  for (const m of collapsed.matchAll(/Apply at: (\S+)/g)) {
    if ((m.index ?? 0) > at) break
    url = m[1]
  }
  return url
}

/** The three grant columns this module owns. */
export interface InvitationColumns {
  invitationOnly: boolean
  invitationProof: string | null
  invitationProofUrl: string | null
}

/**
 * What the monitor writes after reading one page of a grant, or null when
 * nothing should change. Only ever called with a page that loaded and has
 * text: a failed read proves nothing either way.
 *
 *   - A marker an admin set by hand (no proof URL), or one proven on another
 *     page (the application page), is not this page's to touch. No model call.
 *   - No candidate sentence on the page: clear the marker when this page was
 *     its proof, else nothing. No model call.
 *   - Candidates: the model decides. Set only on a confirmed true; clear only
 *     when this page was the proof and the model says it no longer applies.
 *
 * `confirm` is confirmInvitationOnly with the grant's identity bound in. It
 * may throw (no key, rate limit); the caller leaves the marker as it was.
 */
export async function invitationPatch(
  current: InvitationColumns,
  pageUrl: string,
  pageText: string,
  confirm: (candidates: InvitationCandidate[]) => Promise<InvitationConfirmation>,
): Promise<InvitationColumns | null> {
  const off: InvitationColumns = { invitationOnly: false, invitationProof: null, invitationProofUrl: null }
  const provenHere = current.invitationOnly && current.invitationProofUrl === pageUrl
  if (current.invitationOnly && !provenHere) return null

  const candidates = findInvitationCandidates([{ url: pageUrl, text: pageText }])
  if (candidates.length === 0) return provenHere ? off : null

  const verdict = await confirm(candidates)
  if (verdict.invitationOnly) {
    if (provenHere && current.invitationProof === verdict.quote) return null
    return { invitationOnly: true, invitationProof: verdict.quote, invitationProofUrl: verdict.url ?? pageUrl }
  }
  return provenHere ? off : null
}

// #endregion

// #region confirm (model)

export interface ConfirmInvitationInput {
  grantName: string
  funderName: string | null
  applicationUrl: string | null
  infoUrl: string
  candidates: InvitationCandidate[]
}

export interface InvitationConfirmation {
  invitationOnly: boolean
  /** The candidate sentence the verdict rests on, verbatim from the page. Null when false. */
  quote: string | null
  url: string | null
  /** The model's one sentence, or why no model was asked. */
  reason: string
}

/** (system, user) -> the model's text reply. Injectable so tests never reach the API. */
export type InvitationModel = (system: string, user: string) => Promise<string>

export const INVITATION_MODEL = 'claude-sonnet-5'

const CONFIRM_SYSTEM = `You decide whether ONE grant programme listed in a directory for FIRST robotics teams is invitation-only.

You get the listed programme (name, funder, application link, info page) and numbered sentences from the funder's pages that mention invitations or unsolicited requests, each with the text around it.

It is invitation-only ONLY when a sentence says the LISTED programme, the one applied to at the application link, takes applications only from organisations the funder invited. Answer false when the invitation-only statement covers:
- other programmes, other focus areas, or other types of funding from the same funder;
- the funder's general or corporate giving, when the listed programme is a separate grant with its own application (a FIRST team grant on a Submittable or FIRST page beside invite-only foundation grants is open);
- "some cases", "select partners", "a few exceptions", or a footnote on excluded categories;
- a later stage (full proposal after an open letter of inquiry).
An open window or route for new applicants to this programme means false, but only when the page says so in words ("if you did not receive an invitation, submit a request here", "new partners can apply June 1 to July 31").
The application link existing is NOT an open route: invite-only funders put their portal on the same page for the organisations they invited. "You may only apply for a grant if you receive an invitation" with a portal link is invitation-only.
When unsure, false.

Reply with JSON only: {"invitationOnly": true | false, "sentence": <number of the deciding sentence, or null>, "reason": "<one sentence>"}`

export function confirmPrompt(input: ConfirmInvitationInput): string {
  const lines = [
    `Listed programme: ${input.grantName}`,
    `Funder: ${input.funderName ?? 'unknown'}`,
    `Application link: ${input.applicationUrl ?? 'none recorded'}`,
    `Info page: ${input.infoUrl}`,
    '',
  ]
  input.candidates.forEach((c, i) => {
    lines.push(`Sentence ${i + 1} (from ${c.url}): ${c.sentence}`, `Around it: ${c.context}`, '')
  })
  return lines.join('\n')
}

/** Parse the model reply against the candidates it was shown. The quote is always a candidate's own sentence. */
export function parseConfirmation(text: string, candidates: InvitationCandidate[]): InvitationConfirmation {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`invitation: no JSON in reply: ${text.slice(0, 120)}`)
  const parsed = JSON.parse(text.slice(start, end + 1)) as { invitationOnly?: unknown; sentence?: unknown; reason?: unknown }
  const reason = String(parsed.reason ?? '').slice(0, 400)
  if (parsed.invitationOnly !== true) return { invitationOnly: false, quote: null, url: null, reason }
  const n = Number(parsed.sentence)
  const picked = Number.isInteger(n) ? candidates[n - 1] : undefined
  // A yes that names no sentence we showed has nothing to quote; a listing
  // never carries a marker without the funder's words behind it.
  if (!picked) return { invitationOnly: false, quote: null, url: null, reason: `model said yes without naming a sentence: ${reason}` }
  return { invitationOnly: true, quote: picked.sentence, url: picked.url, reason }
}

const defaultModel: InvitationModel = async (system, user) => {
  const response = await anthropic().messages.create({
    model: INVITATION_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  })
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!block) throw new Error('invitation: model returned no text')
  return block.text
}

/**
 * Does an invitation-only statement cover THIS listing? No candidates, no
 * model call: the answer is false. Throws when the model cannot be reached or
 * replies with no JSON; callers keep the previous state.
 */
export async function confirmInvitationOnly(
  input: ConfirmInvitationInput,
  model: InvitationModel = defaultModel,
): Promise<InvitationConfirmation> {
  if (input.candidates.length === 0) {
    return { invitationOnly: false, quote: null, url: null, reason: 'no invitation-only sentence on the pages read' }
  }
  const reply = await model(CONFIRM_SYSTEM, confirmPrompt(input))
  return parseConfirmation(reply, input.candidates)
}

/**
 * The intake read, as stored on extraction.invitation: candidates from the
 * funder text enrich.ts assembled (each sentence attributed to the page it
 * came off), confirmed by the model when there are any.
 */
export async function readInvitationForIntake(
  input: Omit<ConfirmInvitationInput, 'candidates'> & { funderPage: string; firstUrl: string },
  model: InvitationModel = defaultModel,
  now: Date = new Date(),
): Promise<{ invitationOnly: boolean; quote: string | null; url: string | null; reason: string; checkedAt: string }> {
  const candidates = findInvitationCandidates([{ url: input.firstUrl, text: input.funderPage }], (text, sentence, pageUrl) =>
    invitationQuoteUrl(text, sentence, pageUrl),
  )
  const verdict = await confirmInvitationOnly({ ...input, candidates }, model)
  return { ...verdict, checkedAt: now.toISOString() }
}

// #endregion
