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
