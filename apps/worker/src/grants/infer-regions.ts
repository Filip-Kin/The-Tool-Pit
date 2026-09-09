/**
 * A state-scoped grant with no state is unpublishable: the matcher cannot
 * rule anyone in or out. The model often names the scope ("state") and drops
 * the code when the page never spells the state out in one place. The
 * funder's name and the page text usually do: "Maryland State Department of
 * Education", "nonprofits serving Wyoming". Count mentions, take the clear
 * winner. Deterministic, and the quote records which words decided it.
 */
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', "hawai'i": 'HI', 'hawaiʻi': 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const CA_PROVINCES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
  'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE', quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK',
}

export interface RegionGuess {
  codes: string[]
  quote: string
}

/**
 * Longest names first so "West Virginia" is not counted as "Virginia" and
 * "Washington" is not read out of "Washington, D.C.".
 */
const NAMES = Object.entries({ ...US_STATES, ...CA_PROVINCES }).sort((a, b) => b[0].length - a[0].length)

export function inferRegions(texts: Array<string | null | undefined>, country: string | null | undefined): RegionGuess | null {
  const table = country === 'CA' ? CA_PROVINCES : country === 'US' || !country ? US_STATES : null
  if (!table) return null
  let haystack = texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n').toLowerCase()
  const counts = new Map<string, number>()
  for (const [name, code] of NAMES) {
    if (!(name in table)) continue
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    const n = (haystack.match(re) ?? []).length
    if (n > 0) {
      counts.set(code, (counts.get(code) ?? 0) + n)
      haystack = haystack.replace(re, ' ')
    }
  }
  if (counts.size === 0) return null
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [top, topN] = ranked[0]
  const second = ranked[1]?.[1] ?? 0
  // A clear winner: at least two mentions and at least twice the runner-up.
  // A page that names five states evenly is a multi-state programme, and a
  // guess there would be wrong for four of them; leave it for a human.
  if (topN < 2 || topN < second * 2) return null
  const names = Object.keys(table).filter((k) => table[k] === top)
  return { codes: [top], quote: `${names[0]} named ${topN} time${topN === 1 ? '' : 's'} in the funder name and page text` }
}
