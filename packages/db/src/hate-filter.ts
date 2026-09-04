/**
 * A basic hate-speech gate for public submissions.
 *
 * Someone submitted a slur domain through the public submit form. It was caught
 * only by luck (the page had no title, so the quality gate binned it), and a
 * slur with a real title would have reached the review queue. This rejects the
 * obvious ones at intake, before anything lands in a table or a moderator has
 * to read it.
 *
 * DELIBERATELY NARROW. The list is a small set of unambiguous slurs, not a
 * profanity filter: blocking a real team's tool over a swear word is worse than
 * letting the swear word through. The base list is base64-encoded so the words
 * are not sitting in plaintext in a public repo, and HATE_TERMS (comma
 * separated) extends it at runtime without a deploy.
 *
 * The matcher tolerates the usual evasions - elongation ("niiigger"), leetspeak
 * ("n1gg3r"), and separators ("n.i.g.g.e.r") - while word boundaries plus the
 * required letters keep legitimate words out: "spice", "Pakistan", "Niger",
 * "negroni" and "snigger" do NOT match.
 */

// A slur with a digit or a lookalike symbol swapped in, mapped back to letters.
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e',
  '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '9': 'g',
}

function deleet(value: string): string {
  return value.toLowerCase().replace(/[0-9!@$|]/g, (c) => LEET[c] ?? c)
}

const ENCODED_TERMS =
  'WyJuaWdnZXIiLCAibmlnZ2EiLCAiZmFnZ290IiwgInJldGFyZCIsICJzcGljIiwgImtpa2UiLCAid2V0YmFjayIsICJnb29rIiwgImJlYW5lciIsICJwYWtpIiwgIm5pZ2xldCIsICJuZWdybyJd'

function loadTerms(): string[] {
  const base = JSON.parse(Buffer.from(ENCODED_TERMS, 'base64').toString('utf8')) as string[]
  const extra = (process.env.HATE_TERMS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set([...base, ...extra])]
}

function escapeRegExp(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A pattern for one term: each letter may repeat (elongation) with an optional
 * separator between letters, bounded at both ends so it will not fire inside a
 * longer legitimate word, with a short set of plural/tense suffixes allowed so
 * "niggers" and "retarded" still match.
 */
function termPattern(term: string): RegExp {
  const core = term.split('').map((ch) => `${escapeRegExp(ch)}+`).join('[\\W_]*')
  return new RegExp(`\\b${core}(?:s|es|ed|ing|er|ers|z|a|as|y|in)?\\b`, 'i')
}

const PATTERNS = loadTerms().map(termPattern)

/** True when any watched slur appears in any of the given strings. */
export function containsHateSpeech(...values: Array<string | null | undefined>): boolean {
  for (const raw of values) {
    if (!raw) continue
    const text = deleet(raw)
    if (PATTERNS.some((re) => re.test(text))) return true
  }
  return false
}

/**
 * True when a URL carries a slur - in its host (a slur domain or subdomain) or
 * along its path. Host separators become spaces so each label reads as its own
 * word: "nigger.com" matches, "spice.io" and "pakistan-robotics.org" do not.
 */
export function urlContainsHateSpeech(url: string | null | undefined): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    // Not a URL: fall back to scanning the raw string.
    return containsHateSpeech(url)
  }
  const host = parsed.hostname.replace(/[.\-_]/g, ' ')
  const path = decodeURIComponent(parsed.pathname + parsed.search).replace(/[/?=&.\-_]/g, ' ')
  return containsHateSpeech(host, path)
}
