/**
 * Which currency a price on an event page is in.
 *
 * Event fees were stored as US dollars until 2026-11-11, when FIRST Israel's
 * 2,000 shekels went up as $2,000 and every Canadian event's CAD fee showed as
 * dollars. The amount is now kept in the page's own currency (costCurrency),
 * and this is how a quote is read for it. Pure.
 */

/**
 * A three-letter code counts only next to an amount: "CAD 450", "$450 CAD",
 * "CAD$450". Case matters too: "CAD files" on a robotics page is not money.
 * A "$" written with the code is part of it, so "$300 USD" in Canada is USD.
 */
const code = (c: string) => `\\b${c}\\s?\\$?\\s?\\d|\\$?\\s?\\d[\\d,.]*\\s?${c}\\b`

/** Symbols, codes and names that fix the currency whatever the country. */
const MARKERS: Array<[RegExp, string]> = [
  [new RegExp(`₪|ש"ח|ש״ח|\\bshekels?\\b|${code('ILS')}|${code('NIS')}`), 'ILS'],
  [new RegExp(`\\bUS\\$|${code('USD')}|\\bU\\.S\\.\\s*[Dd]ollars?\\b`), 'USD'],
  [new RegExp(`\\bC\\$|\\bCA\\$|${code('CAD')}|\\b[Cc]anadian [Dd]ollars?\\b`), 'CAD'],
  [new RegExp(`\\bA\\$|\\bAU\\$|${code('AUD')}|\\b[Aa]ustralian [Dd]ollars?\\b`), 'AUD'],
  [new RegExp(`\\bNZ\\$|${code('NZD')}`), 'NZD'],
  [new RegExp(`\\bMX\\$|${code('MXN')}|\\b[Pp]esos?\\b`), 'MXN'],
  [new RegExp(`\\bNT\\$|${code('TWD')}|新台幣`), 'TWD'],
  [new RegExp(`\\bR\\$|${code('BRL')}`), 'BRL'],
  [new RegExp(`€|${code('EUR')}|\\b[Ee]uros?\\b`), 'EUR'],
  [new RegExp(`£|${code('GBP')}`), 'GBP'],
  [new RegExp(`₺|${code('TRY')}|\\b[Ll]ira\\b`), 'TRY'],
  [new RegExp(`₹|${code('INR')}|\\b[Rr]upees?\\b`), 'INR'],
  [new RegExp(`₩|${code('KRW')}`), 'KRW'],
  [new RegExp(`${code('CNY')}|${code('RMB')}|元|人民币`), 'CNY'],
  [new RegExp(`${code('JPY')}|円`), 'JPY'],
]

/** A bare "$" is the local dollar. */
const DOLLAR_BY_COUNTRY: Record<string, string> = { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', MX: 'MXN', TW: 'TWD' }

/**
 * The currency a price quote is written in, or null when the quote does not
 * say: no symbol or code, or a bare "$" in a country whose dollar is unknown.
 * Two different currencies in one quote is also null; the reader has to pick
 * the team fee out of it.
 */
export function currencyOf(quote: string, country: string | null | undefined): string | null {
  const found = new Set<string>()
  let rest = quote
  for (const [re, code] of MARKERS) {
    if (re.test(rest)) {
      found.add(code)
      rest = rest.replace(new RegExp(re.source, 'g'), ' ')
    }
  }
  if (/\$/.test(rest)) {
    const local = DOLLAR_BY_COUNTRY[String(country ?? 'US').toUpperCase()]
    if (!local) return null
    found.add(local)
  }
  return found.size === 1 ? [...found][0] : null
}

/** An ISO 4217 code as the reader or a form gave it, or null. */
export function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(v) ? v : null
}
