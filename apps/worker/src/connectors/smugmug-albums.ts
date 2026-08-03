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

/** Public web API key SmugMug ships in-page; fallback if scrape fails. */
const FALLBACK_API_KEY = 'W0g9oqdOrzuhEpIQ2qaTXimrzsfryKSZ'
const API_BASE = 'https://api.smugmug.com/api/v2'
const MAX_DEPTH = 7
const MAX_NODES = 4000

/** Gallery names that aren't event albums. */
const SKIP_NAME = /\b(robot gallery|photo booth|volunteers?|awards? (gallery|ceremony)|headshots?|portraits?|misc|test)\b/i

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
        // A root can itself be a single gallery (e.g. one team's event album)
        // rather than a folder of galleries - emit it directly.
        if (start.node && start.node.Type === 'Album') {
          const cand = this.albumToCandidate(start.node, root)
          if (cand && !seenUrls.has(cand.canonicalUrl)) {
            seenUrls.add(cand.canonicalUrl)
            candidates.push(cand)
          }
          continue
        }
        // BFS over the folder tree from this root.
        const queue: { id: string; depth: number }[] = [{ id: start.id, depth: 0 }]
        while (queue.length > 0 && nodesVisited < MAX_NODES) {
          const { id, depth } = queue.shift()!
          nodesVisited++
          const children = await this.children(id)
          for (const child of children) {
            if (child.Type === 'Folder') {
              if (depth + 1 <= MAX_DEPTH) queue.push({ id: child.NodeID, depth: depth + 1 })
            } else if (child.Type === 'Album') {
              const cand = this.albumToCandidate(child, root)
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

  private albumToCandidate(node: SmugNode, sourceUrl: string): AlbumCandidateInput | null {
    if (SKIP_NAME.test(node.Name)) return null
    const canonical = canonicalizeAlbumUrl(node.WebUri)
    if (!canonical) return null
    // Year from a path segment (e.g. .../2026/...) first, else from the album name.
    const fromPath = node.UrlPath.match(/\/((?:19|20)\d{2})(?:\/|$)/)
    const fromName = node.Name.match(/\b((?:19|20)\d{2})\b/)
    const year = fromPath ? parseInt(fromPath[1], 10) : fromName ? parseInt(fromName[1], 10) : undefined
    return {
      sourceUrl,
      canonicalUrl: canonical.canonicalUrl,
      provider: 'smugmug',
      targetEventYear: year,
      rawMetadata: { title: node.Name },
    }
  }
}
