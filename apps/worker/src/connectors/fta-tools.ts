/**
 * Connector for https://fta.tools/
 *
 * WHY THIS IS NOT AN HTML SCRAPE. The site used to list its tools as anchor
 * tags; it does not any more. The page is a shell whose `<section id="sections">`
 * is empty and filled client-side from a `toolSections` array in script.js.
 * The old anchor scrape therefore found exactly one link, the site's own source
 * repo in the footer, and imported it as a junk tool literally named "fta
 * tools". Zero of the real tools were captured for as long as that shape held.
 *
 * So this reads the data at its source: script.js, where `toolSections` is an
 * array of sections, each `{ title, description, items: [...] }`, and each item
 * is `{ name, resourceUrl, sourceUrl?, maintainer, description, tags }`. That is
 * curated, structured metadata, which is far better than anything a page scrape
 * of this site ever produced.
 *
 * It is a JavaScript object literal, not JSON: unquoted keys, trailing commas,
 * the odd inline comment. Rather than a brittle regex over that, the array text
 * is evaluated in a node:vm context built from nothing, the same locked-down
 * sandbox the team-list parser uses: no require, no process, no fetch, no
 * globals, and a short timeout. An array literal evaluates to an array; a
 * hostile script would find nothing to reach for. It is fta.tools, a known FRC
 * community site, not an arbitrary target, and this keeps it safe regardless.
 */
import vm from 'node:vm'
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch } from './base.js'

const SCRIPT_URL = 'https://fta.tools/script.js'

interface FtaToolItem {
  name?: unknown
  resourceUrl?: unknown
  sourceUrl?: unknown
  description?: unknown
  maintainer?: unknown
}

interface FtaToolSection {
  items?: unknown
}

/** Pull the `toolSections = [ ... ]` array text out of the script, bracket-matched. */
export function extractToolSectionsArray(script: string): string | null {
  const at = script.indexOf('toolSections')
  if (at === -1) return null
  const open = script.indexOf('[', at)
  if (open === -1) return null

  let depth = 0
  let inString: string | null = null
  for (let i = open; i < script.length; i++) {
    const ch = script[i]
    const prev = script[i - 1]
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return script.slice(open, i + 1)
    }
  }
  return null
}

/** Evaluate the object-literal array in an empty sandbox. Null on any failure. */
export function parseToolSections(arrayText: string): FtaToolSection[] | null {
  try {
    const value = vm.runInContext(`(${arrayText})`, vm.createContext({}), { timeout: 500 })
    return Array.isArray(value) ? (value as FtaToolSection[]) : null
  } catch {
    return null
  }
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function httpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

export class FtaToolsConnector implements Connector {
  name = 'fta_tools'

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []
    let skipped = 0

    try {
      const res = await politeFetch(SCRIPT_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SCRIPT_URL}`)

      const arrayText = extractToolSectionsArray(await res.text())
      if (!arrayText) throw new Error('could not find the toolSections array in script.js')

      const sections = parseToolSections(arrayText)
      if (!sections) throw new Error('could not evaluate the toolSections array')

      const seen = new Set<string>()
      for (const section of sections) {
        const items = Array.isArray(section?.items) ? (section.items as FtaToolItem[]) : []
        for (const item of items) {
          const canonicalUrl = httpUrl(item.resourceUrl)
          const title = text(item.name)
          // A tool needs a name and a place to go. An entry missing either is
          // not something a reader can use, so it is counted and skipped rather
          // than filed half-formed.
          if (!canonicalUrl || !title) {
            skipped++
            continue
          }
          if (seen.has(canonicalUrl)) {
            skipped++
            continue
          }
          seen.add(canonicalUrl)

          const maintainer = text(item.maintainer)
          const description = text(item.description)
          candidates.push({
            sourceUrl: SCRIPT_URL,
            canonicalUrl,
            title,
            description: [description, maintainer ? `Maintained by ${maintainer}.` : null]
              .filter(Boolean)
              .join(' ')
              .slice(0, 500) || undefined,
            githubUrl: httpUrl(item.sourceUrl),
          })
        }
      }

      console.log(`[fta-tools] ${candidates.length} tools from script.js, ${skipped} skipped`)
    } catch (err) {
      errors.push(String(err))
      console.error('[fta-tools] error:', err)
    }

    return { candidates, stats: { discovered: candidates.length, skipped, errors } }
  }
}
