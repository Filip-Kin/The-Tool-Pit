/**
 * The mid-April renewal sweep for offseason event listings.
 *
 * Once a year it walks last calendar year's published listings and asks the
 * people who manage them whether the event is running again, with a link that
 * opens next year's submission form already filled in from last year's.
 *
 * WHAT THIS FILE DOES NOT DO: send email. It writes rows into
 * notification_outbox through queueNotification, exactly like the admin
 * approval actions do, and the drain in ../notifications/outbox.ts turns them
 * into email on its normal five-minute pass. That is what gets this feature
 * address resolution, the sandbox check, backoff, parking and a SELECT that
 * answers "did we tell them", for free.
 *
 * IDEMPOTENCE IS THE WHOLE DESIGN. The job is scheduled for a week of mornings
 * rather than one, because a yearly cron that fires once is one worker restart
 * away from skipping a season in silence. Every pass re-derives the same work
 * and the unique index on dedupe_key decides what is actually new, so passes
 * two through seven queue nothing. Running it by hand is safe for the same
 * reason.
 *
 * WHICH SEASON IS ASKED ABOUT. The offseason season is the calendar year. In
 * April 2027 the current season is 2027, the season that just finished is 2026,
 * and the question is "you ran this in 2026, are you running it in 2027". So
 * the source listings are seasonYear 2026 and the season being created is 2027.
 */
import { and, eq, inArray, ne } from 'drizzle-orm'
import {
  getDb,
  eventListings,
  listingOwners,
  queueNotification,
  currentOffseasonSeason,
  LISTING_WRITE_ROLES,
  type EventListing,
} from '@the-tool-pit/db'
import { eventListingUrl, siteUrl, type EmailFact } from '@the-tool-pit/types'
import {
  SEASON_RENEWAL_EMAIL_KIND,
  type SeasonRenewalEmailPayload,
} from '../notifications/season-renewal-email.js'
import { resolveEmailRecipient } from '../notifications/recipients.js'

// #region dedupe

/**
 * The idempotency key for one renewal ask.
 *
 * `event_season_renewal:<seasonYear>:<listingId>:<userId>`, and the unique
 * index on notification_outbox.dedupe_key is what makes it exactly once per
 * listing per person per season, however many times the job runs.
 *
 * THE SEASON IS IN THE KEY even though the listing id alone would already be
 * unique in practice, because the job only ever looks at the season that just
 * finished and so never sees the same listing twice. It is there because the
 * key is what an admin reads when they are working out why somebody did or did
 * not get an email, and `...:2027:...` answers "which year's ask is this"
 * without a join. It also means that if the selection rule is ever widened to
 * ask about older listings again, the widening cannot accidentally silence a
 * new season's ask behind an old row.
 */
export function seasonRenewalDedupeKey(
  seasonYear: number,
  listingId: string,
  userId: string,
): string {
  return `${SEASON_RENEWAL_EMAIL_KIND}:${seasonYear}:${listingId}:${userId}`
}

// #endregion

// #region payload

/** The listing columns the payload is built from. Nothing private. */
export type RenewableListing = Pick<
  EventListing,
  | 'id'
  | 'slug'
  | 'name'
  | 'seasonYear'
  | 'startDate'
  | 'endDate'
  | 'venueName'
  | 'city'
  | 'region'
  | 'country'
  | 'capacity'
  | 'costUsd'
>

/** "12 - 13 September 2026", or null. Long month names: this is an email. */
function dateRange(startDate: string | null, endDate: string | null): string | null {
  if (!startDate) return null
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10))
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    return `${d} ${months[(m ?? 1) - 1]} ${y}`
  }
  if (!endDate || endDate === startDate) return fmt(startDate)
  return `${fmt(startDate)} to ${fmt(endDate)}`
}

/**
 * Build the email payload for one listing.
 *
 * Pure, so the copy and the facts can be checked without a database. The facts
 * are last year's, and the email says so: they are there to identify the event,
 * not to assert anything about this year.
 */
export function buildRenewalPayload(
  listing: RenewableListing,
  seasonYear: number,
): SeasonRenewalEmailPayload {
  const previousSeasonYear = listing.seasonYear ?? seasonYear - 1

  const facts: EmailFact[] = []
  const when = dateRange(listing.startDate, listing.endDate)
  if (when) facts.push({ label: `${previousSeasonYear} dates`, value: when })
  const where = [listing.venueName, listing.city, listing.region, listing.country]
    .filter(Boolean)
    .join(', ')
  if (where) facts.push({ label: 'Where', value: where })
  if (listing.capacity != null) facts.push({ label: 'Slots', value: `${listing.capacity} teams` })
  if (listing.costUsd != null) {
    facts.push({ label: 'Cost', value: listing.costUsd === 0 ? 'Free' : `$${listing.costUsd}` })
  }

  return {
    title: listing.name,
    seasonYear,
    previousSeasonYear,
    renewUrl: `${siteUrl()}/events/submit?renew=${listing.id}`,
    previousUrl: eventListingUrl(listing.slug),
    facts,
  }
}

// #endregion

// #region recipients

/** One permission row, as the sweep reads it. */
export interface OwnerRow {
  entityId: string
  userId: string
  role: string
}

/**
 * Who to ask about one listing.
 *
 * People who hold a WRITE role on the listing (owner or editor). Those are
 * exactly the people who can act on the answer: the renewal form carries their
 * role onto the new listing, so they can keep next year's dates and
 * registration state right without waiting on a moderator. A viewer cannot, so
 * a viewer is not asked.
 *
 * The fallback is the signed-in user who submitted the listing in the first
 * place. Nobody formally claimed it, but they are the person who put it there
 * and we already mail them when it is published, so asking them is not a new
 * relationship. Anonymous and seeded listings have neither and get nobody,
 * which is the normal case, not an error.
 *
 * Deduped, because one person can hold a role and be the submitter.
 */
export function renewalRecipients(
  listing: Pick<EventListing, 'id' | 'submittedByUserId'>,
  owners: OwnerRow[],
): string[] {
  const writeRoles = new Set<string>(LISTING_WRITE_ROLES)
  const users = owners
    .filter((o) => o.entityId === listing.id && writeRoles.has(o.role))
    .map((o) => o.userId)

  if (users.length === 0 && listing.submittedByUserId) users.push(listing.submittedByUserId)

  return [...new Set(users)]
}

// #endregion

// #region stats

export interface SeasonRenewalStats {
  /** The season the ask is about, e.g. 2027. */
  seasonYear: number
  /** The season the source listings belong to, e.g. 2026. */
  previousSeasonYear: number
  /** Published, uncancelled listings from that season. */
  listings: number
  /** Outbox rows newly queued. A re-run adds nothing. */
  queued: number
  /** Listings that produced at least one queued row. */
  listingsAsked: number
  skipped: {
    /** Nobody holds it and nobody signed in to submit it. Seeded rows land here. */
    noOwner: number
    /** Somebody holds it, but not one of them has an address we may write to. */
    noAddress: number
    /** Next year's listing already exists, so there is nothing to ask. */
    alreadyRenewed: number
    /** Every recipient was already asked on an earlier pass. */
    alreadyAsked: number
  }
}

function emptyStats(seasonYear: number): SeasonRenewalStats {
  return {
    seasonYear,
    previousSeasonYear: seasonYear - 1,
    listings: 0,
    queued: 0,
    listingsAsked: 0,
    skipped: { noOwner: 0, noAddress: 0, alreadyRenewed: 0, alreadyAsked: 0 },
  }
}

// #endregion

// #region sweep

export interface SeasonRenewalOptions {
  /** Pinned by a test. Production passes nothing. */
  now?: Date
}

/**
 * One renewal sweep.
 *
 * Bulk reads, not a query per listing: three selects and a couple of maps,
 * whatever the size of the season.
 */
export async function processSeasonRenewalJob(
  opts: SeasonRenewalOptions = {},
): Promise<SeasonRenewalStats> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const seasonYear = currentOffseasonSeason(now)
  const previousSeasonYear = seasonYear - 1
  const stats = emptyStats(seasonYear)

  // Published only. An unpublished or rejected listing has no page to link to
  // and nobody agreed it was real, so there is nothing to renew. Not cancelled
  // either: the last thing the organiser of a cancelled event needs in April is
  // us asking whether they are doing it again.
  const listings = await db
    .select()
    .from(eventListings)
    .where(
      and(
        eq(eventListings.seasonYear, previousSeasonYear),
        eq(eventListings.status, 'published'),
        ne(eventListings.eventStatus, 'cancelled'),
      ),
    )

  stats.listings = listings.length
  if (listings.length === 0) {
    logSweep(stats)
    return stats
  }

  const listingIds = listings.map((l) => l.id)

  // Anything that already points back at one of these is next year's listing,
  // in the queue or already live. The organiser has answered the question, so
  // do not ask it.
  const renewed = await db
    .select({ previousListingId: eventListings.previousListingId })
    .from(eventListings)
    .where(inArray(eventListings.previousListingId, listingIds))
  const alreadyRenewed = new Set(renewed.map((r) => r.previousListingId).filter(Boolean) as string[])

  const owners = await db
    .select({
      entityId: listingOwners.entityId,
      userId: listingOwners.userId,
      role: listingOwners.role,
    })
    .from(listingOwners)
    .where(and(eq(listingOwners.entityType, 'event'), inArray(listingOwners.entityId, listingIds)))

  /** One address lookup per user per sweep, not one per listing. */
  const addressCache = new Map<string, string | null>()
  const hasAddress = async (userId: string): Promise<boolean> => {
    let address = addressCache.get(userId)
    if (address === undefined) {
      address = await resolveEmailRecipient(userId)
      addressCache.set(userId, address)
    }
    return Boolean(address)
  }

  for (const listing of listings) {
    if (alreadyRenewed.has(listing.id)) {
      stats.skipped.alreadyRenewed++
      continue
    }

    const recipients = renewalRecipients(listing, owners)
    if (recipients.length === 0) {
      stats.skipped.noOwner++
      continue
    }

    // Asked before the outbox is written rather than after. The drain would
    // hold a row for an unreachable user for a fortnight and then park it, and
    // a parked row is a thing an admin has to read and dismiss. There is
    // nothing to fix here: it is a listing whose owner has never confirmed an
    // address, and the honest thing is to count it and say so.
    const reachable: string[] = []
    for (const userId of recipients) {
      if (await hasAddress(userId)) reachable.push(userId)
    }
    if (reachable.length === 0) {
      stats.skipped.noAddress++
      continue
    }

    const payload = buildRenewalPayload(listing, seasonYear)
    let queuedForThis = 0
    for (const userId of reachable) {
      const id = await queueNotification({
        userId,
        kind: SEASON_RENEWAL_EMAIL_KIND,
        subjectType: 'event_listing',
        subjectId: listing.id,
        dedupeKey: seasonRenewalDedupeKey(seasonYear, listing.id, userId),
        payload: payload as unknown as Record<string, unknown>,
      })
      if (id) queuedForThis++
    }

    if (queuedForThis > 0) {
      stats.queued += queuedForThis
      stats.listingsAsked++
    } else {
      // Every recipient collided with a row from an earlier pass in this
      // window. That is the job working, not failing.
      stats.skipped.alreadyAsked++
    }
  }

  logSweep(stats)
  return stats
}

/**
 * One line per sweep with every skip reason on it.
 *
 * noOwner is the number worth watching. It is the count of events nobody has
 * claimed, and every one of them is a listing that will go stale because the
 * only person who could refresh it never hears from us.
 */
function logSweep(stats: SeasonRenewalStats): void {
  const s = stats.skipped
  console.log(
    `[event-renewal] season=${stats.seasonYear} from=${stats.previousSeasonYear} ` +
      `listings=${stats.listings} queued=${stats.queued} asked=${stats.listingsAsked} | ` +
      `skipped noOwner=${s.noOwner} noAddress=${s.noAddress} ` +
      `alreadyRenewed=${s.alreadyRenewed} alreadyAsked=${s.alreadyAsked}`,
  )
}

// #endregion
