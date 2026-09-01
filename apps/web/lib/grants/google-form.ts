/**
 * Google Forms prefill link parsing.
 *
 * An admin building the autofill map for a grant should never have to read
 * `entry.1234567890` off a page source. Google Forms has a built-in "Get
 * pre-filled link" feature: you fill the form in with recognisable junk, hit
 * the link button, and Google hands back a URL carrying every answer as a
 * parameter. This module turns that URL back into a list of parameters and
 * their sample values, which is the difference between the map being
 * maintainable and being abandoned after one grant.
 *
 * The exact shape it expects, as Google produces it today:
 *
 *   https://docs.google.com/forms/d/e/1FAIpQLSdXXXXXXXX/viewform
 *     ?usp=pp_url
 *     &entry.1234567890=Team+number
 *     &entry.987654321=jane%40example.com
 *
 * Variations it also has to survive, all seen in the wild:
 *
 *   - /forms/d/<formId>/viewform      older, editor-scoped id
 *   - /forms/d/e/<publishedId>/viewform   current published id
 *   - /forms/d/<formId>/edit          someone copied the editor URL by mistake
 *   - ?usp=sf_link, ?usp=send_form, &pp=1, &fbzx=…, &pageHistory=0,1
 *   - entry.123_year / _month / _day / _hour / _minute  a date or time question,
 *     split across several parameters by Google
 *   - entry.123_sentinel               a checkbox bookkeeping parameter that
 *                                      never carries a real answer
 *   - the same entry.123 repeated      a multi-select checkbox question
 *
 * Pure string work, no network. Safe in a client component.
 */

// #region shapes

/** One prefillable parameter recovered from the link. */
export interface ParsedGoogleFormEntry {
  /** The parameter name to store on grant_form_fields.paramName. */
  paramName: string
  /** Numeric id without the `entry.` prefix or any suffix. */
  entryId: string
  /**
   * The sample answer the admin typed when generating the link. This is how a
   * human recognises which question a numeric id belongs to, so it is carried
   * through to the editor as the row's starting label.
   */
  sampleValue: string
  /** Every value seen for this parameter. Longer than one = a multi-select. */
  sampleValues: string[]
  /**
   * Set when Google split one question across parameters, e.g. 'year' for
   * `entry.123_year`. Each part is its own row, because each needs its own
   * profile path.
   */
  subfield: string | null
}

export interface ParsedGoogleForm {
  /**
   * The form URL with the sample answers and Google's own bookkeeping
   * parameters stripped, ready to store as grants.applicationUrl. Any other
   * query parameter is kept, because a form that genuinely needs one would
   * break without it.
   */
  formUrl: string
  /** The id out of /forms/d/<id> or /forms/d/e/<id>. Null if the path is odd. */
  formId: string | null
  /** True for the /forms/d/e/… published form id, false for the editor id. */
  isPublishedId: boolean
  entries: ParsedGoogleFormEntry[]
  /**
   * Things the admin needs told rather than silently dropped: sentinel
   * parameters ignored, an editor link rewritten, a link with no answers.
   */
  warnings: string[]
}

export type GoogleFormParseResult =
  | { ok: true; form: ParsedGoogleForm }
  | { ok: false; error: string }

// #endregion

/**
 * Query parameters Google adds to its own links that carry no answer. Dropped
 * from formUrl so the stored application URL stays clean; anything NOT on this
 * list is preserved.
 */
const NOISE_PARAMS = new Set([
  'usp', // pp_url on a prefilled link, sf_link on a share link
  'pp', // pp=1 on some newly generated prefill links
  'fbzx', // per-session anti-duplicate token, useless to anyone else
  'pageHistory', // which page of a multi-page form the link was made on
  'edit_requested',
  'embedded',
  'chromeless',
  'urp',
])

/** Suffixes Google appends when one question needs several parameters. */
const SUBFIELD_SUFFIXES = ['year', 'month', 'day', 'hour', 'minute', 'second']

/**
 * Parse a Google Forms pre-filled link.
 *
 * Forgiving on purpose: a missing scheme, stray whitespace from a copy-paste,
 * an editor URL, and Google's usp/pp noise are all normal admin behaviour and
 * none of them should be an error. Only a URL that is not a Google Form at all
 * fails.
 */
export function parseGoogleFormPrefillUrl(url: string): GoogleFormParseResult {
  const raw = (url ?? '').trim()
  if (!raw) return { ok: false, error: 'Paste a pre-filled Google Forms link first.' }

  let parsed: URL
  try {
    // People paste "docs.google.com/forms/..." without a scheme constantly.
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { ok: false, error: 'That does not look like a URL.' }
  }

  const host = parsed.hostname.toLowerCase()
  if (host === 'forms.gle' || host === 'goo.gl') {
    // A short link resolves only by following a redirect, which this pure
    // parser will not do. Saying so beats handing back an empty map.
    return {
      ok: false,
      error: 'Short forms.gle links hide the parameters. Open it, then use the form’s own "Get pre-filled link" and paste that.',
    }
  }
  if (!host.endsWith('google.com') || !parsed.pathname.includes('/forms/')) {
    return { ok: false, error: 'That is not a Google Forms link. Map this grant’s fields by hand instead.' }
  }

  const warnings: string[] = []

  // --- form id and canonical path ---
  const segments = parsed.pathname.split('/').filter(Boolean)
  const dIndex = segments.indexOf('d')
  let formId: string | null = null
  let isPublishedId = false
  if (dIndex >= 0) {
    if (segments[dIndex + 1] === 'e' && segments[dIndex + 2]) {
      formId = segments[dIndex + 2]
      isPublishedId = true
    } else if (segments[dIndex + 1]) {
      formId = segments[dIndex + 1]
    }
  }

  // An /edit link is the form's editor and prefill parameters do nothing on
  // it, so rewrite to /viewform and say we did.
  const last = segments[segments.length - 1]
  if (last === 'edit' || last === 'edit#responses' || last === 'formResponse') {
    segments[segments.length - 1] = 'viewform'
    parsed.pathname = `/${segments.join('/')}`
    warnings.push('That was the form editor link, not the response link. Saved as the /viewform link instead.')
  }
  if (!isPublishedId && formId) {
    warnings.push(
      'This link uses the editor form id (/forms/d/…). It usually still opens for respondents, but the published link from "Send" is safer.',
    )
  }

  // --- entry parameters ---
  const byParam = new Map<string, ParsedGoogleFormEntry>()
  const keptParams: [string, string][] = []
  let sentinelCount = 0
  let emptyCount = 0

  for (const [key, value] of parsed.searchParams.entries()) {
    if (!key.startsWith('entry.')) {
      if (!NOISE_PARAMS.has(key)) keptParams.push([key, value])
      continue
    }

    const suffixMatch = key.match(/^entry\.(\d+)(?:_([a-z]+))?$/i)
    if (!suffixMatch) {
      warnings.push(`Ignored a parameter that is not a normal entry id: ${key}`)
      continue
    }
    const [, entryId, suffixRaw] = suffixMatch
    const suffix = suffixRaw?.toLowerCase() ?? null

    if (suffix === 'sentinel') {
      // Google emits entry.<id>_sentinel for checkbox groups. It carries no
      // answer, so it is dropped, but counted so the admin is told why the
      // number of parameters does not match the number of rows.
      sentinelCount += 1
      continue
    }
    if (suffix && !SUBFIELD_SUFFIXES.includes(suffix)) {
      warnings.push(`Ignored an unrecognised entry suffix: ${key}`)
      continue
    }

    const trimmed = value.trim()
    if (!trimmed) {
      // A question left blank when generating the link tells us nothing about
      // which question the id belongs to, but the id is still real, so keep it
      // and let the admin label it.
      emptyCount += 1
    }

    const existing = byParam.get(key)
    if (existing) {
      // Repeated key = multi-select checkbox. Keep every value: the admin
      // needs to see the options to decide whether a profile field can answer.
      if (trimmed) existing.sampleValues.push(trimmed)
      existing.sampleValue = existing.sampleValues.join(', ')
      continue
    }
    byParam.set(key, {
      paramName: key,
      entryId,
      sampleValue: trimmed,
      sampleValues: trimmed ? [trimmed] : [],
      subfield: suffix,
    })
  }

  if (sentinelCount > 0) {
    warnings.push(
      `Skipped ${sentinelCount} checkbox sentinel parameter${sentinelCount === 1 ? ', which never carries' : 's, which never carry'} an answer.`,
    )
  }
  if (emptyCount > 0) {
    warnings.push(
      `${emptyCount} question${emptyCount === 1 ? ' was' : 's were'} left blank in the pre-filled link, so ${emptyCount === 1 ? 'it has' : 'they have'} no sample answer to recognise ${emptyCount === 1 ? 'it' : 'them'} by.`,
    )
  }

  const dateParts = [...byParam.values()].filter((e) => e.subfield !== null)
  if (dateParts.length > 0) {
    warnings.push(
      `${dateParts.length} parameter${dateParts.length === 1 ? ' is' : 's are'} part of a date or time question, which Google splits up. Each part needs its own profile field, or leave them unmapped.`,
    )
  }
  if (byParam.size === 0) {
    warnings.push(
      'No entry parameters in that link. It is probably the plain form link rather than a pre-filled one.',
    )
  }

  // Rebuild the query from the parameters worth keeping, in their original
  // order, so the stored URL is the form itself and nothing else.
  const clean = new URL(parsed.toString())
  clean.search = ''
  for (const [key, value] of keptParams) clean.searchParams.append(key, value)
  clean.hash = ''

  return {
    ok: true,
    form: {
      formUrl: clean.toString(),
      formId,
      isPublishedId,
      entries: [...byParam.values()],
      warnings,
    },
  }
}
