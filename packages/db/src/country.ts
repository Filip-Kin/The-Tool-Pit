/**
 * One country standard for every listing: ISO 3166-1 alpha-2 ("US", "CA").
 *
 * WHY. Grants always stored codes (grants.countries). Events and fields took
 * whatever a person typed or a reader returned, so the same country was "US",
 * "USA" and "United States" on neighbouring rows, and the first field refresh
 * "changed" eight of them from "United States" to "US". Every path that writes
 * a country (web submit and edit, admin save, the readers, the refresh jobs)
 * runs it through normaliseCountry, and every place that shows one goes
 * through countryName / placeLine, so storage is codes and the page reads
 * English.
 *
 * Zero dependencies, so client components can import it.
 */

/** Spellings people and models write, folded to lower case with dots removed. */
const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'u s': 'US', 'u s a': 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  ca: 'CA', can: 'CA', canada: 'CA',
  mx: 'MX', mex: 'MX', mexico: 'MX', 'méxico': 'MX',
  au: 'AU', aus: 'AU', australia: 'AU',
  tr: 'TR', tur: 'TR', turkey: 'TR', 'türkiye': 'TR', turkiye: 'TR',
  cn: 'CN', chn: 'CN', china: 'CN', "people's republic of china": 'CN',
  tw: 'TW', twn: 'TW', taiwan: 'TW', 'chinese taipei': 'TW',
  il: 'IL', isr: 'IL', israel: 'IL',
  gb: 'GB', uk: 'GB', gbr: 'GB', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  br: 'BR', brazil: 'BR', brasil: 'BR',
  nz: 'NZ', 'new zealand': 'NZ',
  jp: 'JP', japan: 'JP',
  in: 'IN', india: 'IN',
  nl: 'NL', netherlands: 'NL', 'the netherlands': 'NL',
  de: 'DE', germany: 'DE',
  fr: 'FR', france: 'FR',
  co: 'CO', colombia: 'CO',
  cl: 'CL', chile: 'CL',
  do: 'DO', 'dominican republic': 'DO',
  kr: 'KR', 'south korea': 'KR', korea: 'KR',
}

/**
 * A country as an ISO 3166-1 alpha-2 code.
 *
 * Known spellings map to their code. Any other two-letter value is taken as a
 * code and upper-cased ("uk" is the one exception, it maps to GB). Anything
 * else passes through trimmed and unchanged: a guess would be worse than the
 * value a person typed. Blank is null.
 */
export function normaliseCountry(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  const key = trimmed.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
  const known = COUNTRY_ALIASES[key]
  if (known) return known
  if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toUpperCase()
  return trimmed
}

/** A list of countries as codes, blanks dropped, each code once. For grants.countries. */
export function normaliseCountries(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const v of values) {
    const c = normaliseCountry(v)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/** Same country, however each side spells it. */
export function sameCountry(a: string | null | undefined, b: string | null | undefined): boolean {
  return normaliseCountry(a) === normaliseCountry(b)
}

let displayNames: Intl.DisplayNames | null | undefined

/**
 * The English name for a stored country. A two-letter code becomes its name
 * ("CA" -> "Canada"); a value that is not a code is shown as it was stored.
 */
export function countryName(value: string | null | undefined): string | null {
  const code = normaliseCountry(value)
  if (!code) return null
  if (!/^[A-Z]{2}$/.test(code)) return code
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames('en', { type: 'region' })
    } catch {
      displayNames = null
    }
  }
  try {
    return displayNames?.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * One location line: the given parts in order, then the country, joined by
 * ", ". The country is left off for the US, where nearly every listing is,
 * and written out in English for anywhere else.
 */
export function placeLine(parts: ReadonlyArray<string | null | undefined>, country?: string | null): string {
  const code = normaliseCountry(country)
  const shown = code && code !== 'US' ? countryName(code) : null
  return [...parts, shown]
    .map((p) => (typeof p === 'string' ? p.trim() : p))
    .filter((p): p is string => Boolean(p))
    .join(', ')
}
