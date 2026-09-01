/**
 * Chief Delphi (Discourse) search client.
 *
 * ./chief-delphi.ts and ./chief-delphi-albums.ts each grew their own copy of
 * this before it existed, and a third copy was the alternative to writing it.
 * The parts worth having in one place are the ones that get a bot blocked when
 * somebody forgets them: the delay between requests, the blurb merge, and the
 * fact that a search blurb is a TRUNCATED snippet so an empty one does not
 * mean an empty thread.
 *
 * The delay lives INSIDE the two calls rather than at the call site. A caller
 * that forgets to sleep is the failure mode that gets one IP rate limited off
 * a volunteer-run forum, and the cost of an unnecessary sleep is nothing.
 *
 * The existing two connectors are deliberately left alone: they work, they are
 * covered by tests, and rewriting them is not what this change is for.
 */
import { politeFetch, delay } from './base.js'

export const CHIEF_DELPHI_BASE = 'https://www.chiefdelphi.com'

/** Public Discourse allows roughly 60 requests a minute. This sits well under. */
const SEARCH_DELAY_MS = 1500
const TOPIC_DELAY_MS = 1000

export interface DiscourseTopicHit {
  id: number
  title: string
  slug: string
  /** ISO timestamp the thread was opened, when the search response carried one. */
  createdAt: string | null
  /**
   * Search blurbs for this topic and for any matching replies, joined. Always
   * truncated by Discourse, so absence of something here is not evidence of
   * absence in the thread.
   */
  blurb: string
  /** Canonical thread URL. */
  url: string
}

export interface DiscourseSearchOutcome {
  topics: DiscourseTopicHit[]
  /** Set when the request failed. The caller records it, never throws it away. */
  error?: string
}

interface RawSearchTopic {
  id: number
  title: string
  slug: string
  created_at?: string
  blurb?: string
}

interface RawSearchResponse {
  topics?: RawSearchTopic[]
  posts?: Array<{ blurb?: string; topic_id: number }>
}

interface RawPostAction {
  /** Discourse post-action ids. 2 is "like". The rest are flags and bookmarks. */
  id?: number
  count?: number
}

interface RawPost {
  cooked?: string
  raw?: string
  actions_summary?: RawPostAction[]
}

interface RawTopicDetail {
  created_at?: string
  category_id?: number
  like_count?: number
  posts_count?: number
  post_stream?: { posts?: RawPost[] }
}

/** Discourse's post-action id for a like. Everything else in the array is a flag. */
const LIKE_ACTION_ID = 2

/**
 * Likes on the OPENING post of a thread.
 *
 * The opening post only, and this is the whole of the Chief Delphi popularity
 * signal. See the note above fetchChiefDelphiTopic for why the topic's own
 * like_count is not usable and why summing the thread is worse.
 *
 * Pure and exported so the rule can be tested against a captured payload
 * without going near the forum.
 */
export function openingPostLikes(detail: { post_stream?: { posts?: RawPost[] } }): number {
  const first = detail.post_stream?.posts?.[0]
  if (!first) return 0
  for (const action of first.actions_summary ?? []) {
    if (action.id === LIKE_ACTION_ID) return action.count ?? 0
  }
  return 0
}

/**
 * Topic id out of a Chief Delphi thread URL.
 *
 * Discourse thread URLs are /t/<slug>/<id> and sometimes /t/<slug>/<id>/<post>,
 * so the id is the first numeric segment after the slug, not the last one.
 * Returns null for anything that is not a thread, which includes the category
 * and user pages that end up in tool_links.
 */
export function parseChiefDelphiTopicId(url: string): number | null {
  const match = url.match(/chiefdelphi\.com\/t\/[^/]+\/(\d+)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** One Discourse search. Never throws: a dead query must not kill a sweep. */
export async function searchChiefDelphi(query: string, page = 1): Promise<DiscourseSearchOutcome> {
  try {
    const res = await politeFetch(
      `${CHIEF_DELPHI_BASE}/search.json?q=${encodeURIComponent(query)}&page=${page}`,
    )
    if (!res.ok) {
      // A 429 needs longer than the normal pacing before the next request.
      await delay(res.status === 429 ? 10_000 : SEARCH_DELAY_MS)
      return { topics: [], error: `HTTP ${res.status} for query "${query}"` }
    }

    const data = (await res.json()) as RawSearchResponse

    // The response splits topics from posts, and only the posts carry a blurb
    // for a REPLY. Both matter: on Chief Delphi the useful detail is as often
    // in the third reply as in the opening post.
    const replyBlurbs = new Map<number, string[]>()
    for (const post of data.posts ?? []) {
      if (!post.blurb) continue
      const list = replyBlurbs.get(post.topic_id) ?? []
      list.push(post.blurb)
      replyBlurbs.set(post.topic_id, list)
    }

    const topics: DiscourseTopicHit[] = (data.topics ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      createdAt: t.created_at ?? null,
      blurb: [t.blurb ?? '', ...(replyBlurbs.get(t.id) ?? [])].join(' ').trim(),
      url: `${CHIEF_DELPHI_BASE}/t/${t.slug}/${t.id}`,
    }))

    await delay(SEARCH_DELAY_MS)
    return { topics }
  } catch (err) {
    await delay(SEARCH_DELAY_MS)
    return { topics: [], error: `query "${query}" failed: ${String(err)}` }
  }
}

export interface DiscourseTopicDetail {
  /** Rendered HTML of the opening post. */
  html: string
  /** Plain markdown of the opening post, when Discourse returned it. */
  raw: string
  createdAt: string | null
  /**
   * Likes on the opening post. This is the Chief Delphi half of a tool's
   * popularity score.
   *
   * NOT the topic's like_count, which is the sum over every post and therefore
   * measures how long the thread got rather than how good the tool is. Measured
   * on production threads: the Statbotics 2023 thread carries 2186 likes across
   * 424 posts for a project with 102 GitHub stars, and YAGSL carries 662 across
   * 1425 posts, while the AdvantageScope 2026 announcement carries 159 across
   * 45. Ranking on that number puts a busy support thread above WPILib.
   *
   * Summing the thread by hand is worse again, and not only because it measures
   * the same wrong thing: /t/<id>.json returns the first 20 posts, so a full
   * sum of a 1425-post thread is seventy requests to a volunteer-run forum for
   * one listing.
   *
   * The opening post is in the first response and is the one people like
   * because of the tool. Across 20 sampled threads it runs 1 to 69 and
   * separates cleanly: "Feedback on RidgeScout" 1, "Universal Parts Library" 6,
   * "Introducing BumbleBoard" 26, "Maneuver" 46, "Yet Another Software Suite"
   * 60.
   */
  openingPostLikes: number
}

/**
 * Full opening post of one thread. Only the opening post: on an announcement
 * thread that is the announcement, and the replies are people saying thanks.
 */
export async function fetchChiefDelphiTopic(topicId: number): Promise<DiscourseTopicDetail | null> {
  try {
    const res = await politeFetch(`${CHIEF_DELPHI_BASE}/t/${topicId}.json`)
    if (!res.ok) {
      await delay(res.status === 429 ? 10_000 : TOPIC_DELAY_MS)
      return null
    }
    const detail = (await res.json()) as RawTopicDetail
    const first = detail.post_stream?.posts?.[0]
    await delay(TOPIC_DELAY_MS)
    return {
      html: first?.cooked ?? '',
      raw: first?.raw ?? '',
      createdAt: detail.created_at ?? null,
      openingPostLikes: openingPostLikes(detail),
    }
  } catch {
    await delay(TOPIC_DELAY_MS)
    return null
  }
}
