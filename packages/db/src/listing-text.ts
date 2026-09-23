/**
 * Prose rules shared by the extractor (worker), the publish gate and the
 * page (web). A model reading a page narrates the reading: "the page is an
 * eligibility quiz", "award amounts are not stated in the available
 * metadata", "it appears to". A listing is about the grant, so those
 * sentences go, at extraction and again at render for rows written before
 * the rule existed.
 */
const NARRATION_RE = /\b(the|this|that) (web ?page|page|site|website|portal|form|quiz|document|pdf|listing|text|content|metadata|extraction|snippet|description|excerpt)\b|\b(in|from|per|on) the (available |provided |given |page |source )?(metadata|text|content|snippet|information|description|excerpt|page)\b|\bnot (stated|specified|provided|mentioned|listed|given|included|visible|available|shown|clear|detailed|disclosed) (in|on|from|within|here)\b|\b(it is|it's|it remains|remains) (unclear|not clear|uncertain|unknown)\b|\bappears? to\b|\bseems? to\b|\bpresumably\b|\bbased on (the|this|available)\b|\bcannot be (determined|confirmed|verified)\b|\bno (further |additional |specific |other )?(details?|information|amounts?|deadlines?|dates?) (is|are|were) (provided|available|given|stated|listed|mentioned)\b|\b(does not|doesn't|did not|didn't) (state|specify|mention|list|provide|give|indicate)\b|\bnot (explicitly )?(stated|specified|mentioned|indicated)\b\.?$/i

/** Split prose into sentences, keeping the terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(“])/)
    .filter((s) => s.trim().length > 0)
}

export function isNarration(sentence: string): boolean {
  return NARRATION_RE.test(sentence)
}

/** Sentences the scrub would drop, for a gate message or a log line. */
export function narrationIn(text: string | null | undefined): string[] {
  if (!text) return []
  return splitSentences(text).filter(isNarration)
}

/**
 * The prose with its narration removed. Null when too little survives,
 * which is the extractor's honest answer: it had no grant to describe.
 */
export function scrubNarration(text: string | null | undefined, minLength = 20): string | null {
  if (!text) return null
  const kept = splitSentences(text).filter((s) => !isNarration(s))
  const out = kept.join(' ').trim()
  return out.length >= minLength ? out : null
}

// #region reviewer notes

/**
 * Reviewer and pipeline context written into public text. Different from
 * narration above: that is a model describing the page it read; this is a
 * model (or a review agent) repeating what it was told privately. The
 * curated sheet, the candidate's classification, a moderator's flag, the
 * aggregator blurb, an older copy of the page, a check that failed. Real
 * strings from published grants (2026-09-23 audit):
 *
 *   "Filip's sheet marks 3M employee involvement as required and an earlier
 *    page version said '3M-mentored'"
 *   "Candidate classification wrongly lists Summit county."
 *   "priority places per sheet row: Michigan, ... (not verified on this page)."
 *   "The aggregator notes four strategic annual deadlines ..."
 *   "The funder states to 'Check your eligibility' but does not detail other
 *    restrictions on the page."
 *   "Programs run are VEX and RECF Aerial Drone, not FIRST."
 *
 * The patterns target reviewer phrases, never a bare "we" or "sheet": a
 * funder's "We fund FIRST teams" and a "fact sheet" are the funder talking.
 */
const REVIEWER_NOTE_RE = new RegExp(
  [
    // The curated sheet and the person who keeps it.
    String.raw`\bfilip\b`,
    String.raw`\b(filip'?s|curated|hand[- ]kept|grants?|per( the)?|on the|from the|in the|our) sheet\b`,
    String.raw`\bsheet (row|rows|notes?|status|column|entry|says|lists|marks)\b`,
    String.raw`\bthe sheet (says|lists|marks|notes|has|shows|states|gives)\b`,
    // The pipeline: candidate, classifier, extractor, triage, moderator.
    String.raw`\bcandidate('s)? (classification|record|row|extraction|listing|card)\b`,
    String.raw`\b(classifier|extractor|scraper|crawler|moderator|aggregator|blurb)s?\b`,
    String.raw`\b(triage|candidate|model'?s?|our) classification\b`,
    String.raw`\bclassification (wrongly|incorrectly|lists|says|marks|shows)\b`,
    String.raw`\b(from|per|by|in) triage\b`,
    String.raw`\bqueue review\b`,
    String.raw`\bthe (pipeline|model) (read|extracted|flagged|guessed|returned|classified|says|lists)\b`,
    // Another copy of the page.
    String.raw`\b(earlier|older|previous|prior|cached|archived|past) (page|site|web ?page) versions?\b`,
    String.raw`\b(earlier|older|previous|prior|cached|archived) versions? of (the|this) (page|site|web ?page|listing)\b`,
    String.raw`\b(current|live) (page|site) (no longer|now says|still says)\b`,
    // A check, and how it came out.
    String.raw`\b(not|un)[- ]?verified\b`,
    String.raw`\bunconfirmed\b`,
    String.raw`\b(could not|couldn't|cannot|can't) (be )?(verify|verified|confirm|confirmed)\b`,
    // Reviewer voice about the funder or the record.
    String.raw`\b(the )?funder (states|says|writes) to\b`,
    String.raw`\b(does not|doesn't|did not|didn't) (detail|say)\b`,
    String.raw`\b(wrongly|incorrectly|mistakenly|erroneously) (lists?|listed|says|states|marks|marked|classifie[sd]|tagged|labell?ed)\b`,
    String.raw`\beditorial (note|comment|inference|judge?ment)\b`,
    String.raw`\bnote to (self|reviewer|editor)s?\b`,
    String.raw`\bprograms? run (are|is)\b`,
    String.raw`,\s*not (FIRST|FRC|FTC|FLL)\s*[.)]?\s*$`,
    // First-person plural, only with a reviewer's verb.
    String.raw`\bwe (could not|couldn't|cannot|can't|did not|didn't) (find|verify|confirm|read|tell|see|locate|determine|access|load)\b`,
    String.raw`\bwe (checked|verified|assumed|guessed|looked at|scraped|crawled|classified)\b`,
  ].join('|'),
  'i',
)

/**
 * First-person singular. Case-sensitive, so "I" the pronoun and not the
 * letter in "Phase I" or a roman numeral; only with a reviewer's verb, so a
 * testimonial ("I built my first robot") stays.
 */
const FIRST_PERSON_RE = /(^|[\s("'“])I (could(n't| not)|can't|cannot|did(n't| not)|found|think|checked|read|saw|looked|assume[d]?|guess(ed)?|believe|verified|confirmed|am not sure|was unable)\b/

export function isReviewerNote(sentence: string): boolean {
  return REVIEWER_NOTE_RE.test(sentence) || FIRST_PERSON_RE.test(sentence)
}

/** Sentences that carry reviewer or pipeline context, for a gate message. */
export function reviewerNotesIn(text: string | null | undefined): string[] {
  if (!text) return []
  return splitSentences(text).filter(isReviewerNote)
}

/**
 * The text without its reviewer-note sentences. Null when too little
 * survives: a field that was only a note to the reviewer has no public value.
 */
export function scrubReviewerNotes(text: string | null | undefined, minLength = 1): string | null {
  if (!text) return null
  const kept = splitSentences(text).filter((s) => !isReviewerNote(s))
  const out = kept.join(' ').trim()
  return out.length >= minLength ? out : null
}

/** Both scrubs, for prose fields: no page narration and no reviewer notes. */
export function scrubListingText(text: string | null | undefined, minLength = 20): string | null {
  if (!text) return null
  const kept = splitSentences(text).filter((s) => !isNarration(s) && !isReviewerNote(s))
  const out = kept.join(' ').trim()
  return out.length >= minLength ? out : null
}

// #endregion
