import type { MetadataRoute } from 'next'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums, eventListings, events, grants, practiceFields, tools } from '@the-tool-pit/db'
import {
  eventListingUrl,
  fieldUrl,
  grantListingUrl,
  siteUrl,
  toolUrl,
  albumEventUrl,
} from '@the-tool-pit/types'

/**
 * The sitemap is built from live data on every request, never cached, because
 * a listing is published or unpublished by a moderator and a day-stale sitemap
 * would keep pointing crawlers at pages that 404 or hiding pages that are live.
 */
export const dynamic = 'force-dynamic'

/** A hard cap per vertical so one runaway table cannot make the sitemap huge. */
const PER_VERTICAL_LIMIT = 5000

/**
 * The dynamic sitemap for frc.tools.
 *
 * Static routes first (the verticals, the program pages, search), then every
 * PUBLISHED listing across the four verticals plus the photo event pages that
 * carry at least one published album. Only public, published rows: nothing
 * under /admin, /me or /api, and no draft/pending/suppressed row.
 *
 * Each row's URL comes from the same canonical builder the app and the emails
 * use, so the sitemap can never drift from where a page actually lives. The
 * queries select only id/slug/updatedAt to stay cheap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb()
  const origin = siteUrl()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/events`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${origin}/fields`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${origin}/grants`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${origin}/robot-code`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${origin}/photos`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${origin}/frc`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${origin}/ftc`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${origin}/fll`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${origin}/search`, changeFrequency: 'monthly', priority: 0.3 },
  ]

  const [toolRows, eventRows, fieldRows, grantRows, photoRows] = await Promise.all([
    db
      .select({ slug: tools.slug, updatedAt: tools.updatedAt })
      .from(tools)
      .where(eq(tools.status, 'published'))
      .limit(PER_VERTICAL_LIMIT),
    db
      .select({ id: eventListings.id, updatedAt: eventListings.updatedAt })
      .from(eventListings)
      .where(eq(eventListings.status, 'published'))
      .limit(PER_VERTICAL_LIMIT),
    db
      .select({ id: practiceFields.id, updatedAt: practiceFields.updatedAt })
      .from(practiceFields)
      .where(eq(practiceFields.status, 'published'))
      .limit(PER_VERTICAL_LIMIT),
    db
      .select({ slug: grants.slug, updatedAt: grants.updatedAt })
      .from(grants)
      .where(eq(grants.status, 'published'))
      .limit(PER_VERTICAL_LIMIT),
    // Photo event pages exist only for events that carry a published album.
    // DISTINCT on the event's TBA key, which is what /photos/event/[code] takes.
    db
      .selectDistinct({ tbaKey: events.tbaKey, updatedAt: events.updatedAt })
      .from(events)
      .innerJoin(albums, eq(albums.eventId, events.id))
      .where(and(eq(albums.status, 'published'), isNotNull(events.tbaKey)))
      .limit(PER_VERTICAL_LIMIT),
  ])

  const listingEntries: MetadataRoute.Sitemap = [
    ...toolRows.map((r) => ({ url: toolUrl(r.slug), lastModified: r.updatedAt ?? undefined })),
    ...eventRows.map((r) => ({ url: eventListingUrl(r.id), lastModified: r.updatedAt ?? undefined })),
    ...fieldRows.map((r) => ({ url: fieldUrl(r.id), lastModified: r.updatedAt ?? undefined })),
    ...grantRows.map((r) => ({ url: grantListingUrl(r.slug), lastModified: r.updatedAt ?? undefined })),
    ...photoRows.map((r) => ({ url: albumEventUrl(r.tbaKey), lastModified: r.updatedAt ?? undefined })),
  ]

  return [...staticEntries, ...listingEntries]
}
