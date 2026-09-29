/**
 * Once a day, one approvals-channel post per kind of listing that went live
 * since the last report: how many, and their titles, each linked. Nothing is
 * posted for a kind with no new listings.
 *
 * This replaces the per-crawl "N new leads" posts. A lead is not a listing; most
 * are suppressed by the pipeline, and a post per crawl run told the channel
 * nothing it needed to act on.
 */
import { and, eq, gt, desc } from 'drizzle-orm'
import { getDb, grants, tools, albums, eventListings, practiceFields } from '@the-tool-pit/db'
import { sendApprovalNotice, siteUrl, type ApprovalVertical } from '@the-tool-pit/types'
import { getRedis } from '../redis.js'

const SINCE_KEY = 'new-listings-report:since'
/** Titles listed per post; the count above them is always the full number. */
const MAX_TITLES = 40
/** Discord's per-field value cap. */
const FIELD_MAX = 1024

export interface NewListing {
  title: string
  url: string
}

export interface ListingGroup {
  vertical: ApprovalVertical
  heading: string
  path: string
  listings: NewListing[]
}

/** Title lines as Discord fields: markdown links, split under the field cap. */
export function listingFields(listings: NewListing[]): Array<{ label: string; value: string }> {
  const lines = listings.slice(0, MAX_TITLES).map((l) => `[${l.title.replace(/[[\]]/g, '')}](${l.url})`)
  if (listings.length > MAX_TITLES) lines.push(`+${listings.length - MAX_TITLES} more`)
  const fields: Array<{ label: string; value: string }> = []
  let chunk = ''
  for (const line of lines) {
    if (chunk && chunk.length + line.length + 1 > FIELD_MAX) {
      fields.push({ label: fields.length === 0 ? 'Listings' : '​', value: chunk })
      chunk = ''
    }
    chunk = chunk ? `${chunk}\n${line}` : line
  }
  if (chunk) fields.push({ label: fields.length === 0 ? 'Listings' : '​', value: chunk })
  return fields
}

async function newSince(since: Date): Promise<ListingGroup[]> {
  const db = getDb()
  const base = siteUrl().replace(/\/+$/, '')
  const [g, t, a, e, f] = await Promise.all([
    db.select({ title: grants.name, slug: grants.slug }).from(grants).where(and(eq(grants.status, 'published'), gt(grants.publishedAt, since))).orderBy(desc(grants.publishedAt)),
    db.select({ title: tools.name, slug: tools.slug }).from(tools).where(and(eq(tools.status, 'published'), gt(tools.publishedAt, since))).orderBy(desc(tools.publishedAt)),
    db.select({ title: albums.title, url: albums.url }).from(albums).where(and(eq(albums.status, 'published'), gt(albums.publishedAt, since))).orderBy(desc(albums.publishedAt)),
    db.select({ title: eventListings.name, slug: eventListings.slug }).from(eventListings).where(and(eq(eventListings.status, 'published'), gt(eventListings.publishedAt, since))).orderBy(desc(eventListings.publishedAt)),
    db.select({ title: practiceFields.name, slug: practiceFields.slug }).from(practiceFields).where(and(eq(practiceFields.status, 'published'), gt(practiceFields.publishedAt, since))).orderBy(desc(practiceFields.publishedAt)),
  ])
  return [
    { vertical: 'grant', heading: 'New grants', path: '/grants', listings: g.map((r) => ({ title: r.title, url: `${base}/grants/${r.slug}` })) },
    { vertical: 'tool', heading: 'New tools', path: '/', listings: t.map((r) => ({ title: r.title, url: `${base}/tools/${r.slug}` })) },
    { vertical: 'album', heading: 'New photo albums', path: '/photos', listings: a.map((r) => ({ title: r.title ?? r.url, url: r.url })) },
    { vertical: 'event', heading: 'New events', path: '/events', listings: e.map((r) => ({ title: r.title, url: `${base}/events/${r.slug}` })) },
    { vertical: 'field', heading: 'New practice fields', path: '/fields', listings: f.map((r) => ({ title: r.title, url: `${base}/fields/${r.slug}` })) },
  ]
}

export async function processNewListingsReportJob(now = new Date()): Promise<void> {
  const redis = getRedis()
  const stored = await redis.get(SINCE_KEY)
  // First run covers the last day, so the first post is not every listing ever.
  const since = stored ? new Date(stored) : new Date(now.getTime() - 24 * 3600 * 1000)
  const groups = await newSince(since)
  const base = siteUrl().replace(/\/+$/, '')
  for (const group of groups) {
    if (group.listings.length === 0) continue
    sendApprovalNotice({
      vertical: group.vertical,
      alert: true,
      title: `${group.heading}: ${group.listings.length}`,
      reviewUrl: `${base}${group.path}`,
      facts: listingFields(group.listings),
    })
  }
  await redis.set(SINCE_KEY, now.toISOString())
  console.log(`[new-listings] ${groups.map((g) => `${g.vertical} ${g.listings.length}`).join(', ')} since ${since.toISOString()}`)
}
