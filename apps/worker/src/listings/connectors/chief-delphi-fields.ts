/**
 * Chief Delphi practice-field threads -> practice field candidates.
 *
 * A practice field exists nowhere as data. No API lists them, no organisation
 * registers them. A team that has built a full field and is happy to share it
 * writes one forum post saying so, and that post is the only public record.
 * That is why this connector exists and why it is the only angle the fields
 * vertical has.
 *
 * PRECISION, honestly. Two problems, and only one of them is solved here.
 *
 *   1. Offer versus request. "Our practice field is open to any team" and
 *      "does anyone have a practice field we could use" use the same words in
 *      the same order. The negative phrase list below catches the common
 *      request phrasings and counts them as skipped, but it is a word list and
 *      a request phrased unusually will get through. That is the main way a
 *      reviewer's time gets wasted here.
 *   2. Field spec. A thread that says "full field with real game pieces" may
 *      be describing what the poster HAS, what they WANT, or what somebody
 *      else has. So coverage, perimeter, elements, FMS and ceiling height are
 *      never parsed into `extracted`. The phrases go in `signals` as evidence
 *      and a person decides. A wrong spec sends a team across a state to a
 *      half field.
 *
 * What IS read deterministically: the thread URL, the title, a team number
 * when the title names one, and the links, split into a booking form and a
 * site. Location is not: a post says "we are just north of Grand Rapids" and
 * nothing in that is a city column.
 *
 * No model call anywhere on this path.
 */
import { searchChiefDelphi, fetchChiefDelphiTopic } from '../../connectors/discourse.js'
import {
  canonicalListingUrl,
  extractOutboundLinks,
  looksLikeRegistrationUrl,
  matchedPhrases,
  phrasesInSameSentence,
  parseProgramFromTitle,
  parseTeamNumberFromTitle,
  withinRecencyWindow,
} from './shared.js'
import type {
  ListingConnectorContext,
  ListingConnectorResult,
  PracticeFieldCandidateInput,
  PracticeFieldConnector,
} from '../types.js'

const BASE_QUERIES = [
  'practice field available to teams',
  'our practice field is open',
  'open practice field invite teams',
  'full field available for practice',
  'come practice at our field',
  'offering practice field time',
  'practice field open house teams welcome',
  'field elements practice space available',
]

const MAX_TOPICS_PER_QUERY = 20
const MAX_TOPIC_FETCHES = 30

/**
 * Longer window than the events sweep. A field a team built in 2023 is very
 * likely still there, and unlike an event it does not expire on a date. Two
 * years keeps the queue to fields that still plausibly exist.
 */
const RECENCY_DAYS = 730

/** The thread has to be about a FIELD. */
const FIELD_WORDS = [
  'practice field', 'full field', 'half field', 'field time', 'practice space',
  'open field', 'practice facility', 'field available', 'our field',
]

/**
 * And it has to be OFFERING one, in words that mean an offer.
 *
 * This list used to hold 'available', 'welcome', 'reach out', 'let us know' and
 * 'any team' as bare words, which appear in most forum threads ever written.
 * Combined with a field word anywhere else in the same search blurb, that let
 * through a blog post about algae, a thread about team churn rate by region and
 * a discussion of how the California districts went. Two of nine candidates in
 * the first live run were real.
 *
 * Phrases now, not words, and they have to sit NEXT TO the field phrase. See
 * phrasesNear in shared.ts.
 */
const OFFER_WORDS = [
  'is available', 'are available', 'available to any', 'available to teams',
  'available for teams', 'available to other', 'open to any', 'open to teams',
  'open to other', 'open house', 'come practice', 'come and practice',
  'offering', 'happy to host', 'happy to share', 'hosting a practice',
  'welcome to use', 'welcome to come', 'you can use our', 'use our field',
  'use our practice', 'free to use', 'sign up for a slot', 'sign up for time',
  'booking', 'reserve a time', 'reach out if you want to practice',
]

/**
 * Request phrasings. This list is the precision story for this connector: it
 * is what separates "we have a field" from "we need a field", and there is no
 * deterministic way to do that job perfectly.
 */
const NEGATIVE_PHRASES = [
  'looking for a practice', 'looking for practice', 'anyone have a practice',
  'anybody have a practice', 'does anyone have', 'in search of', 'need a practice',
  'need practice space', 'where can we practice', 'can we practice', 'any teams near',
  'wanted', 'seeking', 'trying to find', 'help us find', 'is there a field',
  'how do i build', 'how to build a practice field', 'plans for a practice field',
]

/**
 * Field-spec phrases worth putting in front of a reviewer. These are EVIDENCE
 * only. Nothing in this list ever sets a column, for the reason in the header.
 */
const SPEC_SIGNALS = [
  'full field', 'half field', 'quarter field', 'field perimeter', 'wood field',
  'official field elements', 'am14u', 'andymark', 'apriltags', 'april tags',
  'fms', 'field management system', 'game pieces', 'carpet', 'ceiling',
  'lighting', 'year round', 'year-round', 'by appointment', 'weekends',
]

interface ChiefDelphiFieldsConfig {
  extraQueries?: string[]
  recencyDays?: number
}

export class ChiefDelphiFieldsConnector implements PracticeFieldConnector {
  name = 'cd_practice_fields'
  vertical = 'field' as const
  sourceKind = 'chief_delphi'

  async run(ctx: ListingConnectorContext): Promise<ListingConnectorResult<PracticeFieldCandidateInput>> {
    const candidates: PracticeFieldCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    let skipped = 0

    const config = (ctx.config ?? {}) as ChiefDelphiFieldsConfig
    const queries = [...BASE_QUERIES, ...(config.extraQueries ?? [])]
    const recencyDays = config.recencyDays ?? RECENCY_DAYS

    const seenTopicIds = new Set<number>()
    let topicsTruncated = 0
    let topicFetches = 0
    let topicFetchesWanted = 0
    let tooOld = 0
    let looksLikeRequest = 0
    let notAnOffer = 0

    for (const query of queries) {
      const outcome = await searchChiefDelphi(query)
      if (outcome.error) errors.push(`[cd-practice-fields] ${outcome.error}`)

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
          looksLikeRequest++
          skipped++
          continue
        }
        // Cheap gate on the search blurb, only to decide whether the post is
        // worth fetching. The real test is below, against the post itself.
        if (matchedPhrases(haystack, FIELD_WORDS).length === 0) {
          skipped++
          continue
        }

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

        // Re-check the request phrasing against the FULL post. A title can be
        // neutral ("practice field") while the post is plainly asking for one.
        const fullText = `${topic.title} ${postText}`.toLowerCase()
        if (NEGATIVE_PHRASES.some((p) => fullText.includes(p))) {
          looksLikeRequest++
          skipped++
          continue
        }

        // THE REAL GATE. A field phrase and an offer phrase in the SAME
        // SENTENCE, in the post rather than in a search blurb. Matching them
        // anywhere in the same document is what filed a blog post about algae.
        const offer = phrasesInSameSentence(fullText, FIELD_WORDS, OFFER_WORDS)
        if (!offer) {
          // Includes the case where the fetch budget ran out and there is no
          // post text to read. Skipping is the right way to be wrong: a missed
          // field is one a person can still add, and a queue full of noise is
          // how a reviewer stops opening the queue.
          notAnOffer++
          skipped++
          continue
        }

        const links = extractOutboundLinks(postHtml || topic.blurb)
        const contactUrl = links.find((l) => looksLikeRegistrationUrl(l))
        const website = links.find((l) => l !== contactUrl)

        const team = parseTeamNumberFromTitle(topic.title)
        const signals = matchedPhrases(fullText, SPEC_SIGNALS)

        const threadUrl = canonicalListingUrl(topic.url) ?? topic.url

        candidates.push({
          sourceUrl: threadUrl,
          canonicalUrl: threadUrl,
          title: topic.title.trim(),
          description:
            'Found on Chief Delphi. Whether this is a field being OFFERED rather than one being asked for still needs a human eye, and the field spec was deliberately not parsed: the phrases the thread used are attached as signals instead.',
          discoveredVia: `chief_delphi:"${query}"`,
          teamNumber: team.teamNumber,
          evidence: team.evidence ? [team.evidence] : undefined,
          signals: signals.length > 0 ? signals : undefined,
          links: links.length > 0 ? links : undefined,
          extracted: {
            name: topic.title.trim(),
            teamNumber: team.teamNumber,
            program: parseProgramFromTitle(topic.title),
            website,
            contactUrl,
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
    if (looksLikeRequest > 0) {
      limits.push(
        `${looksLikeRequest} threads read as asking FOR a field rather than offering one and were dropped; that filter is a phrase list, so it will be wrong in both directions sometimes`,
      )
    }
    if (notAnOffer > 0) {
      limits.push(
        `${notAnOffer} threads mentioned a field but never offered one in the same sentence, and were dropped; some of those are real offers phrased in a way this phrase list does not know`,
      )
    }

    console.log(
      `[cd-practice-fields] ${candidates.length} candidates from ${seenTopicIds.size} threads, ${skipped} skipped`,
    )
    return { candidates, skipped, errors, limits }
  }
}
