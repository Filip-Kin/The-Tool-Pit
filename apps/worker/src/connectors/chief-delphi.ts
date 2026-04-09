/**
 * ChiefDelphi connector.
 * Searches the ChiefDelphi Discourse forum for any tools, resources, or projects
 * shared by the community — code repos, web apps, spreadsheets, CAD files, etc.
 *
 * Strategy:
 *   - Run a broad set of queries across multiple categories and tool types.
 *   - For each matched topic, extract ALL external tool URLs (not just GitHub).
 *     Emit one candidate per unique URL, so a single topic sharing a web app
 *     AND its GitHub repo produces two candidates.
 *   - If the search blurb has no URLs, fetch the full first post to find them.
 *   - Respect Discourse's public rate-limit (~60 req/min) with delays.
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const BASE = 'https://www.chiefdelphi.com'

/**
 * Search queries sent to /search.json.
 * Covers: code repos, web apps, scouting tools, strategy spreadsheets,
 * CAD files, volunteer tools, and libraries across all relevant categories.
 */
const SEARCH_QUERIES = [
  // GitHub repos by CD category
  'github.com category:programming',
  'github.com category:technical',
  'github.com category:cad',

  // Scouting tools — often web apps or GitHub projects
  'scouting app',
  'scouting tool software',
  'pit scouting',

  // Strategy, analytics, and data tools
  'spreadsheet calculator frc',
  'strategy tool analytics',

  // CAD sharing (Onshape links, GrabCAD, etc.)
  'onshape robot',
  'grabcad frc',

  // Volunteer and event management tools
  'volunteer tool fta event',

  // Libraries and frameworks
  'github.com frc library',
  'github.com ftc library',

  // General tool posts in technical categories
  'tool software category:technical',
  'github.com ftc software',
]

// Domains that are never tools — images, social, vendors, the forum itself, etc.
const DOMAIN_BLOCKLIST = [
  'chiefdelphi.com',
  'firstinspires.org',
  'imgur.com',
  'i.imgur.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'discord.gg',
  'discord.com',
  'reddit.com',
  'andymark.com',
  'revrobotics.com',
  'vexrobotics.com',
  'wcproducts.com',
  'shields.io',
  'img.shields.io',
  'travis-ci.org',
  'travis-ci.com',
  'circleci.com',
  'codecov.io',
  'coveralls.io',
  'snyk.io',
  'wikipedia.org',
  'wikimedia.org',
  'amazon.com',
  'amzn.to',
  'goo.gl',
  'bit.ly',
  'tinyurl.com',
  'lmgtfy.com',
]

const URL_RE = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?:\/[^\s"<>)'[\]]*)?/g

/**
 * Returns the canonical form of a URL if it looks like a linkable tool,
 * or null if it should be skipped.
 */
function canonicalToolUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.replace(/[).,;:!?]+$/, '')) // strip trailing punctuation
  } catch {
    return null
  }

  const host = u.hostname.toLowerCase()

  if (DOMAIN_BLOCKLIST.some((b) => host === b || host.endsWith('.' + b))) return null

  // The Blue Alliance — index the site itself but not individual event/match/team-event pages
  if (host === 'thebluealliance.com' || host === 'www.thebluealliance.com') {
    if (/^\/(event|match|team\/\d+\/event)\//.test(u.pathname)) return null
    return 'https://www.thebluealliance.com'
  }

  // FTC Events — index the root only, not individual season/event result pages
  if (host === 'ftc-events.com' || host === 'www.ftc-events.com') {
    if (u.pathname.length > 1) return null
    return 'https://ftc-events.com'
  }

  // Statbotics — index the site itself but not individual event/team/match pages
  if (host === 'statbotics.io' || host === 'www.statbotics.io') {
    if (/^\/(events?|teams?|matches?)\//.test(u.pathname)) return null
    return 'https://www.statbotics.io'
  }

  // GitHub: must have owner/repo (at least two path segments)
  if (host === 'github.com' || host === 'www.github.com') {
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    // Drop deeper paths — keep just owner/repo
    return `https://github.com/${parts[0]}/${parts[1]}`
  }

  // Google Docs/Sheets/Slides/Forms — must be a specific document
  if (host === 'docs.google.com') {
    if (!/\/(spreadsheets|document|presentation|forms)\/d\//.test(u.pathname)) return null
    // Normalize to view URL (strip edit/copy fragments)
    const idMatch = u.pathname.match(/\/d\/([^/]+)/)
    if (!idMatch) return null
    const type = u.pathname.split('/')[1]
    return `https://docs.google.com/${type}/d/${idMatch[1]}`
  }

  // Onshape CAD documents
  if (host === 'cad.onshape.com') {
    if (!u.pathname.startsWith('/documents/')) return null
    return `https://cad.onshape.com${u.pathname}`
  }

  // GrabCAD library items
  if (host === 'grabcad.com') {
    if (!u.pathname.startsWith('/library/')) return null
    return `https://grabcad.com${u.pathname}`
  }

  // npm packages
  if (host === 'npmjs.com' || host === 'www.npmjs.com') {
    if (!u.pathname.startsWith('/package/')) return null
    return `https://www.npmjs.com${u.pathname}`
  }

  // PyPI packages
  if (host === 'pypi.org') {
    if (!u.pathname.startsWith('/project/')) return null
    return `https://pypi.org${u.pathname}`
  }

  // Everything else with a real hostname is potentially a web tool —
  // the AI classifier will determine relevance and confidence.
  // Strip query strings and fragments from non-doc URLs for cleaner canonicalization.
  return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '') || null
}

/** Extract all unique tool URLs from arbitrary text (HTML, markdown, or plain). */
function extractToolUrls(text: string): string[] {
  const raw = text.match(URL_RE) ?? []
  const seen = new Set<string>()
  const result: string[] = []
  for (const u of raw) {
    const canonical = canonicalToolUrl(u)
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical)
      result.push(canonical)
    }
  }
  return result
}

interface DiscourseSearchTopic {
  id: number
  title: string
  slug: string
  like_count: number
  blurb: string
}

interface DiscourseSearchResult {
  topics?: DiscourseSearchTopic[]
  posts?: Array<{
    blurb: string
    username: string
    topic_id: number
    like_count: number
  }>
}

interface DiscourseTopicDetail {
  post_stream?: {
    posts?: Array<{ cooked?: string; raw?: string }>
  }
}

export class ChiefDelphiConnector implements Connector {
  name = 'chief_delphi'

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []

    // Track all emitted canonical URLs to avoid duplicates across topics/queries
    const seenUrls = new Set<string>()
    // Track seen topic IDs to avoid fetching the same thread multiple times
    const seenTopicIds = new Set<number>()

    for (const query of SEARCH_QUERIES) {
      try {
        const res = await politeFetch(
          `${BASE}/search.json?q=${encodeURIComponent(query)}&page=1`,
        )

        if (!res.ok) {
          const msg = `[chief-delphi] HTTP ${res.status} for query "${query}"`
          console.warn(msg)
          errors.push(msg)
          await delay(3000)
          continue
        }

        const data = await res.json() as DiscourseSearchResult
        const topics = data.topics ?? []
        const posts = data.posts ?? []

        // Build topic_id → like_count map from the posts list
        const likesMap = new Map<number, number>()
        for (const post of posts) {
          if (!likesMap.has(post.topic_id)) {
            likesMap.set(post.topic_id, post.like_count)
          }
        }

        for (const topic of topics) {
          if (seenTopicIds.has(topic.id)) continue
          seenTopicIds.add(topic.id)

          const threadUrl = `${BASE}/t/${topic.slug}/${topic.id}`
          const likeCount = likesMap.get(topic.id) ?? topic.like_count ?? 0

          // Try extracting tool URLs from the blurb first
          let toolUrls = extractToolUrls(topic.blurb ?? '')

          // Blurb is a truncated snippet — if it has no URLs, fetch the full first post
          if (toolUrls.length === 0) {
            try {
              await delay(1000)
              const topicRes = await politeFetch(`${BASE}/t/${topic.id}.json`)
              if (topicRes.ok) {
                const topicData = await topicRes.json() as DiscourseTopicDetail
                const firstPost = topicData.post_stream?.posts?.[0]
                const fullText = (firstPost?.cooked ?? '') + ' ' + (firstPost?.raw ?? '')
                toolUrls = extractToolUrls(fullText)
              }
            } catch {
              // skip
            }
          }

          if (toolUrls.length === 0) continue

          // Emit one candidate per unique URL found in this topic
          for (const toolUrl of toolUrls) {
            if (seenUrls.has(toolUrl)) continue
            seenUrls.add(toolUrl)

            const isGitHub = toolUrl.includes('github.com')
            const keywords: string[] = []
            if (likeCount > 0) keywords.push(`cd_likes:${likeCount}`)
            keywords.push(`cd_thread:${threadUrl}`)

            candidates.push({
              sourceUrl: threadUrl,
              canonicalUrl: toolUrl,
              githubUrl: isGitHub ? toolUrl : undefined,
              title: topic.title || undefined,
              description: topic.blurb || undefined,
              keywords,
            })
          }
        }

        console.log(
          `[chief-delphi] query "${query}" → ${topics.length} topics, ${candidates.length} total so far`,
        )
      } catch (err) {
        const msg = `[chief-delphi] error for query "${query}": ${String(err)}`
        console.error(msg)
        errors.push(msg)
      }

      // Polite delay between search requests (~60 req/min Discourse limit)
      await delay(1500)
    }

    console.log(`[chief-delphi] done — ${candidates.length} unique candidates`)
    return {
      candidates,
      stats: { discovered: candidates.length, skipped: 0, errors },
    }
  }
}
