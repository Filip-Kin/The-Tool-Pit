/**
 * Spectrum FRC CAD Collection connector.
 * Imports the hand-curated team CAD list published by FRC 3847 (Spectrum) at
 * spectrum3847.org/resources/frc-cad-collection. The page renders its data client-side from a
 * Google Apps Script endpoint (?action=entries) that returns JSON, one row per team CAD release.
 *
 * These are curated team CAD documents, so we trust the source:
 *   - `skipExtract = true` tells the crawl job NOT to fetch each target page (Onshape / GrabCAD
 *     pages are JS shells that block bots and carry no useful server-rendered metadata).
 *   - enrich.ts pre-classifies `spectrum_cad` candidates deterministically as team CAD, so we
 *     spend zero AI credits on ~900 entries and always land them in the Robot Code Archive.
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch } from './base.js'

const ENTRIES_URL =
  'https://script.google.com/macros/s/AKfycbwVaI2x6_0rGPk47gn1xYFhz0fHkeXQTKhDscd1LNJLbXiBAx5TzDffSrU07AKHdEbH/exec?action=entries'
const COLLECTION_URL = 'https://www.spectrum3847.org/resources/frc-cad-collection/'

interface CadEntry {
  rowIndex: number
  team?: string
  year?: string
  description?: string
  format?: string
  teamName?: string
  links?: string[]
}

/** Prefer a real CAD host as the primary link; fall back to the first usable link. */
function primaryLink(links: string[] | undefined): string | null {
  const cleaned = (links ?? []).map((l) => l.trim()).filter(Boolean)
  if (cleaned.length === 0) return null
  const preferred = cleaned.find((l) => /onshape\.com|grabcad\.com|a360\.co/.test(l))
  return preferred ?? cleaned[0]
}

export class SpectrumCadConnector implements Connector {
  name = 'spectrum_cad'
  /** Trusted, self-describing source — the crawl job must not fetch the (bot-blocked) targets. */
  skipExtract = true

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []

    try {
      const res = await politeFetch(ENTRIES_URL)
      if (!res.ok) {
        return { candidates, stats: { discovered: 0, skipped: 0, errors: [`[spectrum-cad] HTTP ${res.status}`] } }
      }

      const data = (await res.json()) as { success?: boolean; entries?: CadEntry[] }
      const entries = data.entries ?? []
      const seen = new Set<string>()

      for (const entry of entries) {
        const link = primaryLink(entry.links)
        if (!link || seen.has(link)) continue
        seen.add(link)

        const team = (entry.team ?? '').trim()
        const teamName = (entry.teamName ?? '').trim()
        const yearRaw = (entry.year ?? '').trim()
        const year = /^(19|20)\d{2}$/.test(yearRaw) ? yearRaw : ''
        const format = (entry.format ?? '').trim()

        const title = [team && `FRC ${team}`, teamName, year, 'Robot CAD'].filter(Boolean).join(' ')

        candidates.push({
          sourceUrl: COLLECTION_URL,
          canonicalUrl: link,
          title,
          description: entry.description || undefined,
          keywords: [
            'frc',
            'cad',
            'spectrum-cad',
            team && `team:${team}`,
            year && `year:${year}`,
            format && `format:${format.toLowerCase()}`,
          ].filter(Boolean) as string[],
          notes: `Curated FRC CAD Collection (Spectrum 3847)${format ? ` [${format}]` : ''}`,
        })
      }

      console.log(`[spectrum-cad] ${candidates.length} CAD entries from ${entries.length} rows`)
    } catch (err) {
      const msg = `[spectrum-cad] error: ${String(err)}`
      console.error(msg)
      errors.push(msg)
    }

    return { candidates, stats: { discovered: candidates.length, skipped: 0, errors } }
  }
}
