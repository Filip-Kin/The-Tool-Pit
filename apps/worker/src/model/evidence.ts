/**
 * Checking that a model's answer is actually written somewhere we read.
 *
 * Lifted out of grants/candidate-extract.ts, which had the only copy, because
 * the listings verticals need exactly the same check and a second copy of a
 * verification rule is how one of them quietly stops verifying.
 *
 * The rule: a value arrives with a quote, and the quote has to appear in the
 * text we actually fetched. A paraphrase fails, because every word still has to
 * be there in order. That is the whole point: a model is good at reading a page
 * and, like anyone, capable of filling a gap with something plausible, and a
 * wrong venue on a listing is worse than a blank one. A blank asks a question;
 * a wrong one answers it.
 */

/**
 * Whitespace-folded and lowercased, so a quote that crossed a line break in the
 * page still matches. Nothing else is stripped: dropping punctuation would let
 * a paraphrase pass as a quote, which is the one thing the check is for.
 */
export function normaliseForQuoteMatch(text: string): string {
  return (
    text
      // Typographic characters, folded to their ascii twin on BOTH sides of the
      // comparison. Real pages are full of curly apostrophes, en dashes and
      // non-breaking spaces; the model writes the plain versions back. The
      // check was losing correct data to that alone: 51 grant fields across the
      // first 29 records were dropped as "quote is in neither text", including
      // deadlines, which are the fields most worth having.
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/…/g, '...')
      // Zero width joiners and marks carry no meaning and are invisible in the
      // model's copy of the text.
      .replace(/[​-‍﻿]/g, '')
      // Every kind of space, including nbsp and the thin spaces, collapses.
      .replace(/[\s  -   　]+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

/**
 * The named sources a quote can have come from, in preference order.
 *
 * Grants pass the funder's page and the aggregator; a listing passes the thread
 * and each page that was opened. First match wins, so the caller orders them
 * most-authoritative first: a line in both texts is the funder's own, and
 * labelling it second hand would make a moderator trust it less than they
 * should.
 */
export type NamedText<S extends string> = { source: S; text: string }

/** Which source a quote came from, or null when nobody wrote it. */
export function quoteSource<S extends string>(
  quote: string,
  sources: ReadonlyArray<NamedText<S>>,
  minLength = 12,
): S | null {
  const needle = normaliseForQuoteMatch(quote)
  // Two or three words are not evidence of anything, they match by accident.
  if (needle.length < minLength) return null
  for (const { source, text } of sources) {
    if (text && normaliseForQuoteMatch(text).includes(needle)) return source
  }
  return null
}

/**
 * A URL is verified by PRESENCE, not by prose.
 *
 * Asking for a sentence containing the link fails on every page that puts it on
 * a button, and those are the pages that carry registration links. Compared
 * without the scheme, the www or a trailing slash, because those differ between
 * how a page writes a link and how a model copies it back.
 */
export function urlSource<S extends string>(
  url: string,
  sources: ReadonlyArray<NamedText<S>>,
): S | null {
  const bare = (u: string) =>
    u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  const needle = bare(url)
  if (!needle) return null
  for (const { source, text } of sources) {
    if (text && bare(text).includes(needle)) return source
  }
  return null
}

/** The first JSON object in a model response, fenced or not. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
