/**
 * A funder page behind a bot wall (aauw.org answers 403 to a fetch and to a
 * headless browser) still has a public copy: the Wayback Machine's. The copy
 * is only worth reading when it is recent, and the listing says where the
 * words came from, so a reader can tell an archive from the live page.
 */
const MAX_AGE_DAYS = 180
const UA = 'FRC.Tools grants monitor (+https://frc.tools/grants)'

export interface ArchiveCopy {
  url: string
  html: string
  capturedAt: string
}

function stamp(ts: string): Date {
  return new Date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10) || '00'}:${ts.slice(10, 12) || '00'}:${ts.slice(12, 14) || '00'}Z`)
}

/** The raw (id_) archive URL for a capture, which serves the page's own bytes with no toolbar. */
export function archiveUrl(ts: string, url: string): string {
  return `https://web.archive.org/web/${ts}id_/${url}`
}

export async function archiveCopy(url: string, today = new Date()): Promise<ArchiveCopy | null> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 25000)
  try {
    const ts = today.toISOString().slice(0, 10).replace(/-/g, '')
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${ts}`, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } }
    const closest = body.archived_snapshots?.closest
    if (!closest?.available || !closest.timestamp) return null
    const captured = stamp(closest.timestamp)
    if (today.getTime() - captured.getTime() > MAX_AGE_DAYS * 86_400_000) return null
    const copy = await fetch(archiveUrl(closest.timestamp, url), { headers: { 'User-Agent': UA }, redirect: 'follow', signal: controller.signal })
    if (!copy.ok) return null
    const html = await copy.text()
    if (html.length < 500) return null
    return { url: archiveUrl(closest.timestamp, url), html, capturedAt: captured.toISOString() }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
