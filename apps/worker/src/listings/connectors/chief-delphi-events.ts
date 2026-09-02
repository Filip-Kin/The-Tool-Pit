/**
 * Chief Delphi off-season event threads -> event listing candidates.
 *
 * This is the half of event discovery TBA cannot do. An off-season event is
 * announced on the forum in March and does not reach TBA until somebody
 * registers it, sometimes weeks before it runs, and the whole point of the
 * events vertical is to tell a team about it while there are still slots.
 *
 * It is also the imprecise half, and it is worth being blunt about where the
 * line falls. FINDING a thread that announces an event is easy: the title says
 * "registration is open" and the category is right. READING that thread into a
 * venue, a capacity and a fee is not, because it is prose written by a person
 * who assumed you already knew where they are. So this connector extracts only
 * what a strict parser can defend:
 *
 *   CAN read      thread URL, title, the sign-up link, the event's own site,
 *                 a host team number when the TITLE names one, the program
 *                 when the title says FRC or FTC but not both, and dates when
 *                 the thread gives an explicit day-month-YEAR and gives only
 *                 one such reading.
 *   CANNOT read   venue, address, city, region, capacity, cost, registration
 *                 state, volunteer sign-up, whether it is on at all. Those are
 *                 left empty and the evidence is attached so a reviewer can
 *                 fill them in from the thread in one read.
 *
 * NOTE the difference from the grants Chief Delphi connector, which treats the
 * forum as provenance only and never lets a thread be the listing. Here the
 * thread legitimately IS the pointer: event_listings carries a chief_delphi_url
 * column exactly for the events whose only home is a forum post.
 *
 * No model call. Everything above is a regex or a link.
 */
import { searchChiefDelphi, fetchChiefDelphiTopic } from '../../connectors/discourse.js'
import {
  canonicalListingUrl,
  extractOutboundLinks,
  looksLikeRegistrationUrl,
  matchedPhrases,
  parseExplicitDates,
  parseProgramFromTitle,
  parseTeamNumberFromTitle,
  withinRecencyWindow,
} from './shared.js'
import type {
  EventListingCandidateInput,
  EventListingConnector,
  ListingConnectorContext,
  ListingConnectorResult,
} from '../types.js'

/**
 * Search queries. Phrased around ANNOUNCING an event, not around discussing
 * one: "offseason" on its own returns a decade of arguments about whether
 * off-season events should use the current game.
 */
const BASE_QUERIES = [
  'offseason event registration open',
  'off-season event announcing teams',
  'offseason competition sign up',
  'announcing our offseason event',
  'preseason scrimmage registration open',
  'scrimmage registration teams welcome',
  'hosting an offseason event this year',
  'save the date offseason event',
]

/** Topics read per query. Discourse orders by relevance, so one page is enough. */
const MAX_TOPICS_PER_QUERY = 20

/**
 * Full-topic fetches per run, across every query. Each is a second request to
 * somebody else's forum. A blurb is enough to reject a thread; it is only the
 * threads that survive the filter that are worth opening.
 */
const MAX_TOPIC_FETCHES = 40

/**
 * How old a thread can be and still matter. An off-season event is announced,
 * runs, and the thread dies. Anything older than this window is last year's
 * event, and listing last year's event as upcoming is the exact failure the
 * whole review gate exists to prevent.
 *
 * 200, down from 400. The queries were run against live Chief Delphi before
 * this connector had ever fired: 400 days let two of last year's events through
 * (Clipper Clash, September 2025, and Mississippi Mayhem, November 2025) into a
 * set of 15 survivors. A window that admits the exact thing the comment above
 * says it exists to exclude is not a window.
 *
 * 200 still reaches an event announced in March for an October date, which is
 * the longest real announcement-to-event gap in the FRC off-season. The cost of
 * being wrong in this direction is one missed candidate a human can add by
 * hand. The cost in the other direction is last year's event on the front page.
 */
const RECENCY_DAYS = 200

/** The thread has to be ABOUT an event. */
const EVENT_WORDS = [
  'offseason', 'off-season', 'off season', 'scrimmage', 'preseason',
  'pre-season', 'invitational', 'kickoff', 'competition', 'tournament', 'event',
]

/** And it has to be ANNOUNCING one, not reminiscing about one. */
const ANNOUNCE_WORDS = [
  'registration', 'register', 'sign up', 'signup', 'signups', 'announcing',
  'announce', 'hosting', 'save the date', 'applications open', 'now open',
  'slots', 'spots', 'teams welcome', 'invited', 'we are excited',
]

/**
 * Phrases that mean the poster WANTS an event rather than offers one, or that
 * the thread is a curated list of everybody else's events. Both look identical
 * to the filters above.
 */
const NEGATIVE_PHRASES = [
  'looking for an offseason', 'looking for offseason', 'any offseason events',
  'anyone know of', 'is there an offseason', 'list of offseason',
  'offseason events spreadsheet', 'master list', 'recap', 'thank you to everyone',
  'results', 'match videos', 'stream',
]

interface ChiefDelphiEventsConfig {
  /** Extra queries an admin added on the crawl source row. */
  extraQueries?: string[]
  /** Override the recency window in days. */
  recencyDays?: number
}

export class ChiefDelphiEventsConnector implements EventListingConnector {
  name = 'cd_offseason_events'
  vertical = 'event' as const
  sourceKind = 'chief_delphi'

  async run(ctx: ListingConnectorContext): Promise<ListingConnectorResult<EventListingCandidateInput>> {
    const candidates: EventListingCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    let skipped = 0

    const config = (ctx.config ?? {}) as ChiefDelphiEventsConfig
    const queries = [...BASE_QUERIES, ...(config.extraQueries ?? [])]
    const recencyDays = config.recencyDays ?? RECENCY_DAYS
    const currentYear = new Date().getFullYear()

    const seenTopicIds = new Set<number>()
    let topicsTruncated = 0
    let topicFetches = 0
    let topicFetchesWanted = 0
    let tooOld = 0

    for (const query of queries) {
      const outcome = await searchChiefDelphi(query)
      if (outcome.error) errors.push(`[cd-offseason-events] ${outcome.error}`)

      if (outcome.topics.length > MAX_TOPICS_PER_QUERY) {
        topicsTruncated += outcome.topics.length - MAX_TOPICS_PER_QUERY
      }

      for (const topic of outcome.topics.slice(0, MAX_TOPICS_PER_QUERY)) {
        if (seenTopicIds.has(topic.id)) continue
        seenTopicIds.add(topic.id)

        if (!withinRecencyWindow(topic.createdAt, recencyDays)) {
          tooOld++
          skipped++
          continue
        }

        const haystack = `${topic.title} ${topic.blurb}`.toLowerCase()
        if (NEGATIVE_PHRASES.some((p) => haystack.includes(p))) {
          skipped++
          continue
        }
        if (matchedPhrases(haystack, EVENT_WORDS).length === 0) {
          skipped++
          continue
        }
        if (matchedPhrases(haystack, ANNOUNCE_WORDS).length === 0) {
          skipped++
          continue
        }

        // The thread survived the filter, so it is worth the second request:
        // the opening post is where the dates and the sign-up link live, and a
        // search blurb is truncated to a couple of lines.
        topicFetchesWanted++
        let postHtml = ''
        let postText = ''
        if (topicFetches < MAX_TOPIC_FETCHES) {
          topicFetches++
          const detail = await fetchChiefDelphiTopic(topic.id)
          if (detail) {
            postHtml = detail.html
            postText = detail.raw || detail.html.replace(/<[^>]+>/g, ' ')
          }
        }

        const links = extractOutboundLinks(postHtml || topic.blurb)
        const registrationUrl = links.find((l) => looksLikeRegistrationUrl(l))
        const website = links.find((l) => l !== registrationUrl)

        // Title first: an announcement title carries the date far more often
        // than it carries a wrong one, and the body quotes past years.
        const dates = parseExplicitDates(`${topic.title}\n${postText}`, currentYear)
        const team = parseTeamNumberFromTitle(topic.title)

        const evidence = [...dates.evidence]
        if (team.evidence) evidence.push(team.evidence)
        if (dates.ambiguous) {
          evidence.push('several different dates appear in this thread, so none was filled in')
        }

        const threadUrl = canonicalListingUrl(topic.url) ?? topic.url

        candidates.push({
          sourceUrl: threadUrl,
          canonicalUrl: threadUrl,
          title: topic.title.trim(),
          description:
            'Found on Chief Delphi. The thread title, the links and any explicit dates were read off the post; venue, city, cost, capacity and registration state were not, because the thread does not carry them in a form that can be parsed.',
          discoveredVia: `chief_delphi:"${query}"`,
          evidence: evidence.length > 0 ? evidence : undefined,
          links: links.length > 0 ? links : undefined,
          extracted: {
            name: topic.title.trim(),
            program: parseProgramFromTitle(topic.title),
            hostTeamNumber: team.teamNumber,
            startDate: dates.startDate,
            endDate: dates.endDate,
            website,
            registrationUrl,
            chiefDelphiUrl: threadUrl,
          },
        })
      }
    }

    if (topicFetchesWanted > topicFetches) {
      limits.push(
        `per-run cap: ${topicFetchesWanted - topicFetches} threads passed the filter but were not opened, cap is ${MAX_TOPIC_FETCHES} full-topic fetches`,
      )
    }
    if (topicsTruncated > 0) {
      limits.push(
        `per-query cap: ${topicsTruncated} search results beyond the first ${MAX_TOPICS_PER_QUERY} per query were not read`,
      )
    }
    if (tooOld > 0) {
      limits.push(`${tooOld} threads older than ${recencyDays} days were not read`)
    }

    console.log(
      `[cd-offseason-events] ${candidates.length} candidates from ${seenTopicIds.size} threads, ${skipped} skipped`,
    )
    return { candidates, skipped, errors, limits }
  }
}
