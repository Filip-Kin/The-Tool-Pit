/**
 * schema.org JSON-LD builders, one per public vertical.
 *
 * RULES THAT RUN THROUGH ALL OF IT:
 *   - Every value comes from data already on the page (the same rows
 *     generateMetadata reads). Nothing is invented. No ratings, no reviews, no
 *     counts we do not hold: a fabricated aggregateRating is exactly the kind
 *     of slop Google penalises and an owner would rightly hate.
 *   - Optional fields are omitted when null, never emitted empty. `prune`
 *     drops undefined keys so the JSON a crawler sees carries only real facts.
 *   - Each builder returns one node with its own @context/@type, ready to hand
 *     straight to <JsonLd data={...} />.
 *
 * The types are the public read shapes, so a column that never leaves the
 * server (submitter audit, crawl bookkeeping) cannot reach a builder here.
 */
import type { PublicEvent } from '@/lib/events/event-display'
import { effectiveEventStatus, effectiveRegistrationStatus, eventHostTeams } from '@/lib/events/event-display'
import type { PublicField } from '@/lib/fields/field-display'
import type { PublicGrant } from '@/lib/grants/grant-display'
import type { ToolDetailData } from '@/lib/queries/tools'
import { eventListingUrl, fieldUrl, grantListingUrl, toolUrl } from '@the-tool-pit/types'

/** Drop keys whose value is undefined/null/'' so only real facts are emitted. */
function prune<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out as T
}

// ---------------------------------------------------------------------------
// Tools -> SoftwareApplication (WebApplication for the web ones)
// ---------------------------------------------------------------------------

/**
 * schema.org applicationCategory for each of our tool types. The value is a
 * schema.org software category token where one fits, and a plain readable
 * label otherwise; both are valid for the free-text applicationCategory field.
 */
const TOOL_APPLICATION_CATEGORY: Record<string, string> = {
  web_app: 'WebApplication',
  desktop_app: 'DeveloperApplication',
  mobile_app: 'MobileApplication',
  calculator: 'UtilitiesApplication',
  spreadsheet: 'BusinessApplication',
  github_project: 'DeveloperApplication',
  browser_extension: 'BrowserApplication',
  api: 'DeveloperApplication',
  resource: 'ReferenceApplication',
  other: 'DeveloperApplication',
}

export function toolJsonLd(tool: ToolDetailData): Record<string, unknown> {
  // The homepage link is the tool's real front door; fall back to our canonical
  // listing when there is no working homepage on file.
  const homepage = tool.links.find((l) => l.linkType === 'homepage' && !l.isBroken)?.url
  const canonical = toolUrl(tool.slug)

  // Author, only when we actually know one: a named vendor, or a team's own
  // code repo (the team is the author). Never a guessed name.
  let author: Record<string, unknown> | undefined
  if (tool.vendorName) {
    author = { '@type': 'Organization', name: tool.vendorName }
  } else if (tool.isTeamCode && tool.teamNumber) {
    author = { '@type': 'Organization', name: `FIRST Robotics Competition Team ${tool.teamNumber}` }
  }

  const isWeb = tool.toolType === 'web_app'

  return prune({
    '@context': 'https://schema.org',
    '@type': isWeb ? 'WebApplication' : 'SoftwareApplication',
    name: tool.name,
    description: tool.summary ?? tool.description ?? undefined,
    url: homepage ?? canonical,
    applicationCategory: TOOL_APPLICATION_CATEGORY[tool.toolType] ?? 'DeveloperApplication',
    // Web apps run in the browser; say so where it is true and leave it off
    // where we do not know the platform rather than guessing "Windows".
    operatingSystem: isWeb ? 'Any' : undefined,
    author,
  })
}

// ---------------------------------------------------------------------------
// Events -> Event
// ---------------------------------------------------------------------------

export function eventJsonLd(ev: PublicEvent): Record<string, unknown> {
  // Status and availability follow the same derivations the map and cards use,
  // so a finished event is not advertised as taking registrations.
  const now = new Date()
  const regStatus = effectiveRegistrationStatus(ev, now)
  const eventStatus = effectiveEventStatus(ev, now)
  // A Place with as much of the address as the listing carries. Built only when
  // there is a name or an address to hang it on.
  const placeName = ev.venueName ?? ev.city ?? ev.name
  const address = prune({
    '@type': 'PostalAddress',
    streetAddress: ev.address ?? undefined,
    addressLocality: ev.city ?? undefined,
    addressRegion: ev.region ?? undefined,
    addressCountry: ev.country ?? undefined,
  })
  const hasAddress = Object.keys(address).length > 1
  const location =
    placeName || hasAddress
      ? prune({
          '@type': 'Place',
          name: placeName ?? undefined,
          address: hasAddress ? address : undefined,
          geo:
            ev.latitude != null && ev.longitude != null
              ? { '@type': 'GeoCoordinates', latitude: ev.latitude, longitude: ev.longitude }
              : undefined,
        })
      : undefined

  // Registration offer, only when there is somewhere to register. Price is the
  // whole-dollar per-team fee when the listing states it; free is a real 0.
  let offers: Record<string, unknown> | undefined
  if (ev.registrationUrl) {
    offers = prune({
      '@type': 'Offer',
      url: ev.registrationUrl,
      price: ev.costUsd != null ? String(ev.costUsd) : undefined,
      priceCurrency: ev.costUsd != null ? 'USD' : undefined,
      availability:
        regStatus === 'open'
          ? 'https://schema.org/InStock'
          : regStatus === 'closed'
            ? 'https://schema.org/SoldOut'
            : regStatus === 'waitlist'
              ? 'https://schema.org/BackOrder'
              : undefined,
    })
  }

  return prune({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.name,
    // The date columns are YYYY-MM-DD strings, which are valid ISO-8601 dates.
    startDate: ev.startDate ?? undefined,
    endDate: ev.endDate ?? undefined,
    eventStatus: eventStatus === 'cancelled' ? 'https://schema.org/EventCancelled' : undefined,
    // Every off-season event is an in-person competition.
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    url: eventListingUrl(ev.slug),
    organizer: (() => {
      const orgs = eventHostTeams(ev).map((n) => ({
        '@type': 'Organization',
        name: `FIRST Robotics Competition Team ${n}`,
      }))
      return orgs.length === 0 ? undefined : orgs.length === 1 ? orgs[0] : orgs
    })(),
    offers,
    description: ev.notes ?? undefined,
  })
}

// ---------------------------------------------------------------------------
// Practice fields -> Place
// ---------------------------------------------------------------------------

export function fieldJsonLd(field: PublicField): Record<string, unknown> {
  const address = prune({
    '@type': 'PostalAddress',
    streetAddress: field.address ?? undefined,
    addressLocality: field.city ?? undefined,
    addressRegion: field.region ?? undefined,
    addressCountry: field.country ?? undefined,
  })
  const hasAddress = Object.keys(address).length > 1

  return prune({
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: field.name,
    url: fieldUrl(field.slug),
    address: hasAddress ? address : undefined,
    geo:
      field.latitude != null && field.longitude != null
        ? { '@type': 'GeoCoordinates', latitude: field.latitude, longitude: field.longitude }
        : undefined,
  })
}

// ---------------------------------------------------------------------------
// Grants -> MonetaryGrant
// ---------------------------------------------------------------------------

export function grantJsonLd(grant: PublicGrant): Record<string, unknown> {
  // Award as a MonetaryAmount: a range when we hold both ends, a single value
  // when we hold one, nothing when we hold neither.
  let amount: Record<string, unknown> | undefined
  if (grant.awardMin != null && grant.awardMax != null && grant.awardMin !== grant.awardMax) {
    amount = {
      '@type': 'MonetaryAmount',
      currency: grant.awardCurrency,
      minValue: grant.awardMin,
      maxValue: grant.awardMax,
    }
  } else if (grant.awardMax != null || grant.awardMin != null) {
    amount = {
      '@type': 'MonetaryAmount',
      currency: grant.awardCurrency,
      value: grant.awardMax ?? grant.awardMin,
    }
  }

  return prune({
    '@context': 'https://schema.org',
    '@type': 'MonetaryGrant',
    name: grant.name,
    description: grant.summary ?? grant.description ?? undefined,
    url: grantListingUrl(grant.slug),
    funder: grant.funder
      ? prune({ '@type': 'Organization', name: grant.funder.name, url: grant.funder.website ?? undefined })
      : undefined,
    amount,
  })
}
