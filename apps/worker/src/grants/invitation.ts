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
 * Pure over page text and deterministic, so the same page always gets the same
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

export interface InvitationOnlyResult {
  invitationOnly: boolean
  /** The sentence that says so, whitespace-collapsed, as it appears on the page. Null when invitationOnly is false. */
  quote: string | null
}

const QUOTE_LIMIT = 400

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
    for (const part of line.split(/(?<=[.!?])\s+(?=["'“(\[]?[A-Z0-9])/)) {
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

/**
 * The detector. Returns the first sentence that makes the grant invitation
 * only, or { invitationOnly: false, quote: null }.
 */
export function detectInvitationOnly(text: string | null | undefined): InvitationOnlyResult {
  if (!text || !text.trim()) return { invitationOnly: false, quote: null }
  const sentences = sentencesOf(text)
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    const neighbours = [sentences[i - 1] ?? '', sentences[i + 1] ?? '']

    if (inviteHit(s)) {
      if (!APPLY_CONTEXT.test(s)) continue
      if (EVENT_WORD.test(s) && !/\b(?:apply|applying|applications?|proposals?|submit)\b/i.test(s)) continue
      if (NEXT_STAGE.test(s)) continue
      if (opensFirstStage(s) || neighbours.some(opensFirstStage)) continue
      return { invitationOnly: true, quote: s.slice(0, QUOTE_LIMIT) }
    }

    const u = unsolicitedHit(s)
    if (u) {
      // "We do not accept unsolicited proposals; instead, submit a letter of
      // inquiry" is a two-stage process with an open first stage.
      const rest = s.slice(u.end)
      if (opensFirstStage(rest) || neighbours.some(opensFirstStage)) continue
      return { invitationOnly: true, quote: s.slice(0, QUOTE_LIMIT) }
    }
  }
  return { invitationOnly: false, quote: null }
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
  return { invitationOnly: false, quote: null, url: null }
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
 * Sets the marker when the page says it. Clears it only when THIS page was
 * the proof and no longer says it: a marker an admin set by hand (no proof
 * URL), or one proven on another page (the application page), is not this
 * page's to clear.
 */
export function invitationPatch(current: InvitationColumns, pageUrl: string, pageText: string): InvitationColumns | null {
  const found = detectInvitationOnly(pageText)
  if (found.invitationOnly) {
    if (current.invitationOnly && current.invitationProof) return null
    return { invitationOnly: true, invitationProof: found.quote, invitationProofUrl: pageUrl }
  }
  if (current.invitationOnly && current.invitationProofUrl === pageUrl) {
    return { invitationOnly: false, invitationProof: null, invitationProofUrl: null }
  }
  return null
}

// #endregion
