/**
 * SmugMug albums connector.
 * Photographers organize their SmugMug sites differently: some have one flat
 * folder of event galleries, others nest program -> year -> events (+ an
 * off-season subfolder). Rather than guess, we walk the site with SmugMug's
 * public API v2, which labels every child node as a Folder (descend) or an
 * Album (a gallery = one event). Each Album becomes a candidate.
 *
 * No API credentials of our own are needed: SmugMug embeds a public read-only
 * web API key in every page, and the node/children endpoints accept it
 * anonymously. We scrape that key from the first page, with a known fallback.
 */
import { politeFetch, delay } from './base.js'
import { canonicalizeAlbumUrl } from './album-hosts.js'
import type { AlbumConnector, AlbumConnectorResult, AlbumCandidateInput } from './album-hosts.js'

/** Start points to crawl. Each is walked recursively. */
const SMUGMUG_ROOTS = [
  'https://fit.smugmug.com/FIRST-Robotics-Competition/',
  'https://fit.smugmug.com/FIRST-Tech-Challenge-FTC',
  'https://firstcalifornia.smugmug.com/FIRST-Robotics-Competition',
  'https://firstwisconsin.smugmug.com/',
  'https://nefirst.smugmug.com/',
  'https://ferrisphotos.smugmug.com/Academic/Engineering-Technology/FIRST-Robotics-Competition',
]

/**
 * SmugMug's own read-only browse key, the one it embeds in the pages it serves
 * to any anonymous visitor, used as a fallback when scraping the key off the live
 * page fails. It is public by design, not a secret, but it reads better from an
 * env var than hard-coded, so SMUGMUG_API_KEY overrides it where one is set.
 */
const FALLBACK_API_KEY = process.env.SMUGMUG_API_KEY ?? 'W0g9oqdOrzuhEpIQ2qaTXimrzsfryKSZ'
const API_BASE = 'https://api.smugmug.com/api/v2'
const MAX_DEPTH = 7
const MAX_NODES = 4000

/** Gallery names that aren't event albums. */
const SKIP_NAME = /\b(robot gallery|photo booth|volunteers?|awards? (gallery|ceremony)|headshots?|portraits?|misc|test)\b/i

/** A pure year folder ("2026") or a "Pre-2022"-style bucket. */
function isYearName(name: string): boolean {
  return /^(?:pre[- ]?)?(?:19|20)\d{2}$/i.test(name.trim())
}

/** Program label folders ("FIRST Robotics Competition", "FTC") are not events. */
function detectProgram(text: string): 'frc' | 'ftc' | 'fll' | undefined {
  const n = text.toLowerCase()
  if (/tech[-\s]*chall|\bftc\b/.test(n)) return 'ftc'
  if (/lego|\bfll\b/.test(n)) return 'fll'
  if (/robotics[-\s]*comp|\bfrc\b/.test(n)) return 'frc'
  return undefined
}

/**
 * Generic leaf gallery names that carry no event identity - the event name has
 * to come from an ancestor folder instead. Covers "Event Photos", "Event Photos
 * B", "Photos", "Gallery 111625-329-PM", bare years, "2025 A", single letters.
 */
function isGenericLeaf(name: string): boolean {
  const n = name.trim()
  return (
    /^(event\s+)?photos(\s*[-#]?\s*[a-z0-9]{1,3})?$/i.test(n) ||
    /^gallery\b/i.test(n) ||
    /^(?:19|20)\d{2}(?:[-\s]*[a-z0-9]{1,3})?$/i.test(n) ||
    /^[a-z]$/i.test(n)
  )
}

interface PathContext {
  /** Meaningful ancestor folder names (event location), root/year/program stripped. */
  names: string[]
  year?: number
  program?: 'frc' | 'ftc' | 'fll'
}

/** Extend the path context by descending into a folder named `name`. */
function descend(ctx: PathContext, name: string): PathContext {
  const prog = detectProgram(name)
  const next: PathContext = { names: ctx.names, year: ctx.year, program: prog ?? ctx.program }
  const yearMatch = name.match(/\b((?:19|20)\d{2})\b/)
  if (isYearName(name)) {
    if (yearMatch) next.year = parseInt(yearMatch[1], 10)
  } else if (prog) {
    // program-label folder: sets program, not a location name
  } else {
    next.names = [...ctx.names, name]
    if (yearMatch) next.year = parseInt(yearMatch[1], 10)
  }
  return next
}

interface SmugNode {
  Type: 'Folder' | 'Album' | string
  Name: string
  UrlPath: string
  WebUri: string
  HasChildren?: boolean
  NodeID: string
}

export class SmugmugAlbumsConnector implements AlbumConnector {
  name = 'smugmug_albums'
  private apiKey = FALLBACK_API_KEY

  async run(_year: number): Promise<AlbumConnectorResult> {
    const errors: string[] = []
    const candidates: AlbumCandidateInput[] = []
    const seenUrls = new Set<string>()
    let nodesVisited = 0

    for (const root of SMUGMUG_ROOTS) {
      try {
        await this.loadApiKey(root)
        const start = await this.lookupNode(root)
        if (!start) {
          errors.push(`[smugmug] could not resolve start node for ${root}`)
          continue
        }
        // Program context can come from the root path itself (e.g. a
        // ".../FIRST-Robotics-Competition" root is unambiguously FRC).
        const rootCtx: PathContext = { names: [], year: undefined, program: detectProgram(new URL(root).pathname) }

        // A root can itself be a single gallery (e.g. one team's event album)
        // rather than a folder of galleries - emit it directly.
        if (start.node && start.node.Type === 'Album') {
          const cand = this.albumToCandidate(start.node, root, rootCtx)
          if (cand && !seenUrls.has(cand.canonicalUrl)) {
            seenUrls.add(cand.canonicalUrl)
            candidates.push(cand)
          }
          continue
        }
        // BFS over the folder tree, carrying the meaningful folder path so an
        // album whose own name is generic ("Event Photos", "2025 A") still gets
        // its event name (e.g. "Glendale") from an ancestor folder.
        const queue: { id: string; depth: number; ctx: PathContext }[] = [{ id: start.id, depth: 0, ctx: rootCtx }]
        while (queue.length > 0 && nodesVisited < MAX_NODES) {
          const { id, depth, ctx } = queue.shift()!
          nodesVisited++
          const children = await this.children(id)
          for (const child of children) {
            if (child.Type === 'Folder') {
              if (depth + 1 <= MAX_DEPTH) queue.push({ id: child.NodeID, depth: depth + 1, ctx: descend(ctx, child.Name) })
            } else if (child.Type === 'Album') {
              const cand = this.albumToCandidate(child, root, ctx)
              if (cand && !seenUrls.has(cand.canonicalUrl)) {
                seenUrls.add(cand.canonicalUrl)
                candidates.push(cand)
              }
            }
          }
          await delay(120)
        }
      } catch (err) {
        errors.push(`[smugmug] error crawling ${root}: ${String(err)}`)
      }
    }

    console.log(`[smugmug] ${candidates.length} album candidates from ${SMUGMUG_ROOTS.length} roots (${nodesVisited} nodes)`)
    return { candidates, stats: { discovered: candidates.length, skipped: 0, errors } }
  }

  /** Scrape the in-page public API key from a SmugMug page; keep the fallback on failure. */
  private async loadApiKey(pageUrl: string): Promise<void> {
    try {
      const res = await politeFetch(pageUrl)
      if (!res.ok) return
      const html = await res.text()
      const m = html.match(/"apiKey":"([A-Za-z0-9]{16,})"/)
      if (m) this.apiKey = m[1]
    } catch {
      // keep fallback
    }
  }

  private async apiGet(path: string): Promise<unknown> {
    // NB: no _verbosity=1 - that mode strips the nested Uris objects and the
    // child NodeIDs we need to walk the tree.
    const sep = path.includes('?') ? '&' : '?'
    const res = await politeFetch(`${API_BASE}${path}${sep}APIKey=${this.apiKey}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`SmugMug API HTTP ${res.status} for ${path}`)
    return res.json()
  }

  /**
   * Resolve a public URL to its SmugMug node via urlpathlookup, returning the
   * NodeID plus (best-effort) the full node so a root that is itself an Album can
   * be handled without a !children call.
   */
  private async lookupNode(url: string): Promise<{ id: string; node?: SmugNode } | null> {
    const u = new URL(url)
    const nick = u.hostname.split('.')[0]
    const path = u.pathname.replace(/\/+$/, '') || '/'
    const data = (await this.apiGet(
      `/user/${nick}!urlpathlookup?urlpath=${encodeURIComponent(path)}`,
    )) as { Response?: { Locator?: string; [k: string]: unknown } }
    const resp = data.Response
    if (!resp || !resp.Locator) return null
    const obj = resp[resp.Locator] as { Uris?: { Node?: { Uri?: string } } } | undefined
    const nodeUri = obj?.Uris?.Node?.Uri
    if (!nodeUri) return null
    const id = nodeUri.replace(/.*\/node\//, '')
    const node = await this.getNode(id)
    return { id, node: node ?? undefined }
  }

  private async getNode(nodeId: string): Promise<SmugNode | null> {
    try {
      const data = (await this.apiGet(`/node/${nodeId}`)) as { Response?: { Node?: SmugNode } }
      return data.Response?.Node ?? null
    } catch {
      return null
    }
  }

  private async children(nodeId: string): Promise<SmugNode[]> {
    const data = (await this.apiGet(`/node/${nodeId}!children?count=200`)) as {
      Response?: { Node?: SmugNode[] }
    }
    return data.Response?.Node ?? []
  }

  private albumToCandidate(node: SmugNode, sourceUrl: string, ctx: PathContext): AlbumCandidateInput | null {
    if (SKIP_NAME.test(node.Name)) return null
    const canonical = canonicalizeAlbumUrl(node.WebUri)
    if (!canonical) return null

    // The event name is the meaningful ancestor folders + the leaf name if the
    // leaf itself carries identity (skip generic "Event Photos" / "2025 A").
    const parts = [...ctx.names]
    if (!isGenericLeaf(node.Name) && !ctx.names.includes(node.Name)) parts.push(node.Name)

    // Year: prefer a year already on the path/leaf; else read one from the leaf.
    const fromLeaf = node.Name.match(/\b((?:19|20)\d{2})\b/)
    const year = ctx.year ?? (fromLeaf ? parseInt(fromLeaf[1], 10) : undefined)

    let title = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (year && !new RegExp(`\\b${year}\\b`).test(title)) title = `${title} ${year}`.trim()
    if (!title) title = node.Name

    return {
      sourceUrl,
      canonicalUrl: canonical.canonicalUrl,
      provider: 'smugmug',
      targetEventYear: year,
      rawMetadata: { title, targetProgram: ctx.program },
    }
  }
}
