/**
 * ChiefDelphi connector.
 * Searches the ChiefDelphi Discourse forum (chiefdelphi.com) for posts
 * that link to GitHub repositories. Returns them as candidates so they
 * can be enriched and published as tools.
 *
 * Strategy:
 *   - Use the Discourse /search.json endpoint with several queries that
 *     target programming / technical posts containing GitHub URLs.
 *   - For each matching topic, record the post's like count and thread URL
 *     as structured keywords so the publish pipeline can store them.
 *   - Respect Discourse's public rate-limit (~60 req/min) with a 1.5 s delay.
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const BASE = 'https://www.chiefdelphi.com'

/** Queries sent to /search.json — each yields up to 50 results. */
const SEARCH_QUERIES = [
  'github.com category:programming',
  'github.com category:technical',
  'github.com frc software',
  'github.com ftc software',
  'github.com fll robotics',
  'github.com robotics library',
]

const GITHUB_URL_RE = /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g

/** Extract unique owner/repo GitHub URLs from arbitrary text. */
function extractGitHubUrls(text: string): string[] {
  const matches = text.match(GITHUB_URL_RE) ?? []
  return matches
    .map((u) => {
      const parts = u.replace(/\/$/, '').split('/')
      return parts.slice(0, 5).join('/') // keep up to owner/repo only
    })
    .filter((u) => u.split('/').filter(Boolean).length >= 4)
    .filter((u, i, arr) => arr.indexOf(u) === i) // deduplicate
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

    // Track seen GitHub URLs to avoid emitting duplicates from different posts
    const seenGithubUrls = new Set<string>()
    // Track seen topic IDs to avoid fetching the same thread multiple times
    const seenTopicIds = new Set<number>()

    for (const query of SEARCH_QUERIES) {
      try {
        const url = `${BASE}/search.json?q=${encodeURIComponent(query)}&page=1`
        const res = await politeFetch(url)

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

        // Build a map from topic_id → like_count using posts list
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

          // Try to extract GitHub repo URLs from the blurb first.
          // The blurb is a truncated snippet — if it doesn't contain a GitHub URL,
          // fetch the full topic to get the first post's complete content.
          let searchText = topic.blurb ?? ''
          let githubUrls = extractGitHubUrls(searchText)

          if (githubUrls.length === 0) {
            try {
              await delay(1000) // Respect Discourse rate limit
              const topicRes = await politeFetch(`${BASE}/t/${topic.id}.json`)
              if (topicRes.ok) {
                const topicData = await topicRes.json() as DiscourseTopicDetail
                const firstPost = topicData.post_stream?.posts?.[0]
                // Use cooked (HTML) or raw — extract URLs from whichever has them
                const postContent = (firstPost?.cooked ?? '') + ' ' + (firstPost?.raw ?? '')
                searchText = postContent
                githubUrls = extractGitHubUrls(postContent)
              }
            } catch {
              // Silently skip — we'll just get no GitHub URL for this topic
            }
          }

          if (githubUrls.length === 0) continue

          // Use the first (most prominent) GitHub URL as the canonical URL
          const primaryGithub = githubUrls[0]
          if (seenGithubUrls.has(primaryGithub)) continue
          seenGithubUrls.add(primaryGithub)

          const keywords: string[] = []
          if (likeCount > 0) keywords.push(`cd_likes:${likeCount}`)
          keywords.push(`cd_thread:${threadUrl}`)

          candidates.push({
            sourceUrl: threadUrl,
            canonicalUrl: primaryGithub,
            githubUrl: primaryGithub,
            title: topic.title || undefined,
            description: topic.blurb || undefined,
            keywords,
          })
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
