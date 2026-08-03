const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "YYYY-MM-DD" → parts without timezone drift. */
function parts(date: string): { y: number; m: number; d: number } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) }
}

/** Format an event date range, e.g. "Mar 12–14, 2026" or "Mar 30 – Apr 2, 2026". */
export function formatEventDates(start: string | null, end: string | null): string {
  const s = start ? parts(start) : null
  if (!s) return ''
  const e = end ? parts(end) : null
  if (!e || (e.y === s.y && e.m === s.m && e.d === s.d)) {
    return `${MONTHS[s.m - 1]} ${s.d}, ${s.y}`
  }
  if (e.y === s.y && e.m === s.m) {
    return `${MONTHS[s.m - 1]} ${s.d}–${e.d}, ${s.y}`
  }
  if (e.y === s.y) {
    return `${MONTHS[s.m - 1]} ${s.d} – ${MONTHS[e.m - 1]} ${e.d}, ${s.y}`
  }
  return `${MONTHS[s.m - 1]} ${s.d}, ${s.y} – ${MONTHS[e.m - 1]} ${e.d}, ${e.y}`
}

export function formatLocation(city: string | null, stateProv: string | null, country: string | null): string {
  return [city, stateProv, country && country !== 'USA' ? country : null].filter(Boolean).join(', ')
}

const PROVIDER_LABELS: Record<string, string> = {
  smugmug: 'SmugMug',
  flickr: 'Flickr',
  google_photos: 'Google Photos',
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
  pixieset: 'Pixieset',
  chief_delphi: 'Chief Delphi',
  firstinmichigan: 'First in Michigan',
  other: 'Photos',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}
