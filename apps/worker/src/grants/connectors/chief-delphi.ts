/**
 * Chief Delphi connector: mine funding threads for LEADS, never for listings.
 *
 * Teams talk about money on the forum constantly, and the useful part of that
 * conversation is not the thread, it is the link somebody drops in the second
 * reply. So this connector reuses the shape of ../../connectors/chief-delphi.ts
 * (Discourse /search.json, blurb first, full first post only when the blurb has
 * no links, polite delays under the ~60 req/min public limit) but inverts what
 * it keeps: the tools connector wants the linked repo, we want the linked
 * FUNDER.
 *
 * The rule that cannot bend: a forum thread must NEVER become a grant listing.
 * `canonicalUrl` is always the outbound funder page and chiefdelphi.com is on
 * the NON_FUNDER_HOSTS blocklist in ./shared.ts, so a thread can only ever be
 * the `sourceUrl` a reviewer clicks through to for context. A thread saying
 * "we got 5k from Acme" is evidence about Acme, not a grant.
 *
 * Everything here is deterministic. No model call is made at discovery time,
 * because the Anthropic account is pay as you go and the classifier downstream
 * already spends exactly one call per candidate that survives.
 */
import { parse } from 'node-html-parser'
import { politeFetch, delay } from '../../connectors/base.js'
import { canonicalGrantUrl, hostOf, isNonFunderHost, looksLikeOrganisationName } from './shared.js'
import type {
  GrantConnector,
  GrantConnectorContext,
  GrantConnectorResult,
  GrantCandidateInput,
} from './types.js'

const BASE = 'https://www.chiefdelphi.com'

/**
 * Discourse search queries. Phrased around money the team RECEIVES, because
 * "sponsor" on its own pulls in threads about sponsoring an offseason event
 * and about sponsor logo placement on a bumper.
 */
const SEARCH_QUERIES = [
  'grant application team funding',
  'we received a grant',
  'grant deadline apply team',
  'sponsorship funding local business',
  'how to fund your team money',
  'corporate matching gift robotics team',
  'foundation grant robotics team',
  'rookie team funding grant startup',
  'STEM grant application state',
  'travel grant championship funding',
]

/** Topics considered per query. Older search pages repeat, so one page is enough. */
const MAX_TOPICS_PER_QUERY = 15

/**
 * Full-topic fetches allowed per run, across all queries. Each one is a second
 * request to a volunteer-run forum, and a blurb with no link is usually a
 * thread with no link. The cap is reported in `limits` rather than assumed.
 */
const MAX_TOPIC_FETCHES = 60

/** Links per thread. A "here is every grant we found" post is an aggregator, not ten leads. */
const MAX_LINKS_PER_TOPIC = 6

/** Delay between search requests, matching the tools connector's cadence. */
const SEARCH_DELAY_MS = 1500
/** Delay before a full-topic fetch. */
const TOPIC_DELAY_MS = 1000

/**
 * A link only becomes a lead when something around it talks about money. The
 * haystack is the anchor text, the thread title and the URL path together, so
 * a bare "https://acmefoundation.org/apply" still passes on its path.
 */
const MONEY_WORDS = [
  'grant',
  'fund',
  'funding',
  'foundation',
  'award',
  'scholarship',
  'sponsor',
  'sponsorship',
  'donat',
  'apply',
  'application',
  'giving',
  'philanthrop',
]

/**
 * Paths that are a team's own page, a vendor product or a document, not a
 * funder's programme. These slip past the host blocklist because they sit on
 * ordinary domains.
 */
const NON_FUNDER_PATH_RE =
  /\/(?:products?|shop|store|cart|checkout|pricing|blog\/\d|wp-content|uploads|\.pdf$)/i

const URL_RE = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?:\/[^\s"<>)'[\]]*)?/g

interface DiscourseSearchTopic {
  id: number
  title: string
  slug: string
  blurb?: string
}

interface DiscourseSearchResult {
  topics?: DiscourseSearchTopic[]
  posts?: Array<{ blurb?: string; topic_id: number }>
}

interface DiscourseTopicDetail {
  post_stream?: { posts?: Array<{ cooked?: string; raw?: string }> }
}

interface ForumLink {
  url: string
  /** Anchor text, when Discourse rendered one. Often the organisation's name. */
  label?: string
}

/**
 * Pull outbound links out of one post. Anchors first, because the anchor text
 * is usually the organisation's name and a bare regex throws it away. The
 * regex sweep then catches the plain-text URLs Discourse did not linkify.
 */
function extractOutboundLinks(html: string): ForumLink[] {
  const found = new Map<string, ForumLink>()

  const push = (raw: string, label?: string) => {
    const canonical = canonicalGrantUrl(raw)
    if (!canonical) return
    // chiefdelphi.com itself is on this blocklist, which is what stops a thread
    // becoming its own listing.
    if (isNonFunderHost(canonical)) return
    if (NON_FUNDER_PATH_RE.test(new URL(canonical).pathname)) return
    const existing = found.get(canonical)
    // Keep the first usable label; a later bare URL must not erase it.
    if (existing) {
      if (!existing.label && label) existing.label = label
      return
    }
    found.set(canonical, { url: canonical, label })
  }

  try {
    const root = parse(html)
    for (const anchor of root.querySelectorAll('a')) {
      const href = anchor.getAttribute('href')?.trim()
      if (!href || !/^https?:\/\//i.test(href)) continue
      const text = anchor.textContent?.replace(/\s+/g, ' ').trim()
      // Discourse renders a bare URL as an anchor whose text IS the URL, which
      // is not a name.
      const label = text && !/^https?:\/\//i.test(text) && looksLikeOrganisationName(text) ? text : undefined
      push(href, label)
    }
  } catch {
    // Malformed cooked HTML still has readable text below.
  }

  for (const raw of html.match(URL_RE) ?? []) push(raw)

  return [...found.values()]
}

/** True when the thread, the anchor text or the URL says this is about money. */
function looksLikeFundingLead(link: ForumLink, threadTitle: string): boolean {
  let path = ''
  try {
    path = new URL(link.url).pathname
  } catch {
    return false
  }
  const haystack = `${link.label ?? ''} ${threadTitle} ${path}`.toLowerCase()
  return MONEY_WORDS.some((w) => haystack.includes(w))
}

export class GrantChiefDelphiConnector implements GrantConnector {
  name = 'grant_chief_delphi'

  async run(_ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    let skipped = 0

    const seenUrls = new Set<string>()
    const seenTopicIds = new Set<number>()
    let topicFetches = 0
    let topicFetchesWanted = 0
    let topicsTruncated = 0

    for (const query of SEARCH_QUERIES) {
      try {
        const res = await politeFetch(`${BASE}/search.json?q=${encodeURIComponent(query)}&page=1`)
        if (!res.ok) {
          errors.push(`[grant-chief-delphi] HTTP ${res.status} for query "${query}"`)
          await delay(3000)
          continue
        }

        const data = (await res.json()) as DiscourseSearchResult
        const topics = data.topics ?? []

        // The search response splits topics and posts, and only the posts carry
        // a blurb for replies. Both are worth reading: the funder link is more
        // often in a reply than in the opening post.
        const blurbs = new Map<number, string[]>()
        for (const post of data.posts ?? []) {
          if (!post.blurb) continue
          const list = blurbs.get(post.topic_id) ?? []
          list.push(post.blurb)
          blurbs.set(post.topic_id, list)
        }

        if (topics.length > MAX_TOPICS_PER_QUERY) topicsTruncated += topics.length - MAX_TOPICS_PER_QUERY

        for (const topic of topics.slice(0, MAX_TOPICS_PER_QUERY)) {
          if (seenTopicIds.has(topic.id)) continue
          seenTopicIds.add(topic.id)

          const threadUrl = `${BASE}/t/${topic.slug}/${topic.id}`
          const blurbText = [topic.blurb ?? '', ...(blurbs.get(topic.id) ?? [])].join(' ')
          let links = extractOutboundLinks(blurbText)

          // A blurb is a truncated snippet, so no link in it does not mean no
          // link in the thread. Spend a full fetch, within the run's cap.
          if (links.length === 0) {
            topicFetchesWanted++
            if (topicFetches < MAX_TOPIC_FETCHES) {
              topicFetches++
              try {
                await delay(TOPIC_DELAY_MS)
                const topicRes = await politeFetch(`${BASE}/t/${topic.id}.json`)
                if (topicRes.ok) {
                  const detail = (await topicRes.json()) as DiscourseTopicDetail
                  // Only the opening post. Replies are where the arguments are,
                  // and a link in an argument is usually a counter-example.
                  const first = detail.post_stream?.posts?.[0]
                  links = extractOutboundLinks(`${first?.cooked ?? ''} ${first?.raw ?? ''}`)
                }
              } catch (err) {
                errors.push(`[grant-chief-delphi] topic ${topic.id} fetch failed: ${String(err)}`)
              }
            }
          }

          const leads = links.filter((l) => looksLikeFundingLead(l, topic.title))
          skipped += links.length - leads.length

          if (leads.length > MAX_LINKS_PER_TOPIC) {
            // Almost always a curated list post. Worth a lead or two, not
            // twenty, and the overflow is counted rather than dropped quietly.
            limits.push(
              `thread ${threadUrl} offered ${leads.length} funding links, kept ${MAX_LINKS_PER_TOPIC}`,
            )
          }

          for (const lead of leads.slice(0, MAX_LINKS_PER_TOPIC)) {
            if (seenUrls.has(lead.url)) {
              skipped++
              continue
            }
            seenUrls.add(lead.url)

            candidates.push({
              // The thread is provenance only. The canonical URL, which is the
              // dedup key and the page a reviewer reads, is always the funder.
              sourceUrl: threadUrl,
              canonicalUrl: lead.url,
              title: lead.label ?? hostOf(lead.url) ?? lead.url,
              description: `Linked from the Chief Delphi thread "${topic.title}". This is a lead, not a listing: the funder's own page still has to say whether a team can apply and by when.`,
              // Anchor text is what a team called the organisation, which is
              // not the same as the organisation confirming its own name, so it
              // is never promoted to funderName here.
              discoveredVia: `chief_delphi:${threadUrl}`,
            })
          }
        }

        console.log(
          `[grant-chief-delphi] query "${query}" -> ${topics.length} topics, ${candidates.length} leads so far`,
        )
      } catch (err) {
        errors.push(`[grant-chief-delphi] query "${query}" failed: ${String(err)}`)
      }

      await delay(SEARCH_DELAY_MS)
    }

    if (topicFetchesWanted > topicFetches) {
      limits.push(
        `per-run cap: ${topicFetchesWanted - topicFetches} threads had no link in the search blurb and were not opened, cap is ${MAX_TOPIC_FETCHES} full-topic fetches`,
      )
    }
    if (topicsTruncated > 0) {
      limits.push(
        `per-query cap: ${topicsTruncated} search results beyond the first ${MAX_TOPICS_PER_QUERY} per query were not read`,
      )
    }

    console.log(
      `[grant-chief-delphi] done, ${candidates.length} leads from ${seenTopicIds.size} threads, ${skipped} links dropped`,
    )
    return { candidates, skipped, errors, limits }
  }
}
