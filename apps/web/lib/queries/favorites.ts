import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  albums,
  events,
  favorites,
  fieldPhotos,
  grantFunders,
  grants,
  practiceFields,
  tools,
  FAVORITE_ENTITY_TYPES,
  type FavoriteEntityType,
  type Favorite,
} from '@the-tool-pit/db'
import { displayEventName } from './albums'

/**
 * Favourites, shared by all four verticals.
 *
 * The favorites table is polymorphic (entityType + entityId) and deliberately
 * carries no foreign key to the four target tables, so reading is a fan-out:
 * one query per entity TYPE present, never one per favourite. A list of forty
 * saved things costs at most six queries no matter the mix.
 *
 * Targets can vanish (a tool suppressed, an album pulled, a field deleted).
 * There is no FK and no cascade, so a favourite can outlive its target. Those
 * rows are dropped silently from the read path rather than rendered as a dead
 * link, which is also why `getFavoriteCounts` is documented as approximate.
 */

// #region Types

export interface FavoriteItem {
  /** The favorites row id, not the target id. Used as the React key. */
  id: string
  entityType: FavoriteEntityType
  entityId: string
  title: string
  subtitle: string | null
  /**
   * Where clicking the item goes. Root-relative for anything with a page in
   * this app, absolute for an album (albums have no detail page here, they
   * live on the photographer's own host).
   *
   * TRAP: a root-relative href is only correct on the apex host. On
   * photos./fields./grants.* the middleware rewrites every unprefixed path
   * into that vertical's tree, so `/fields/x` on photos.* becomes
   * `/photos/fields/x` and 404s. A page on a vertical subdomain must render
   * these through `absoluteFavoriteUrl`.
   */
  href: string
  /** Cover or gallery image, when the vertical has one. */
  imageUrl?: string
  /** The user's own note on why they saved it, if they left one. */
  note: string | null
  createdAt: Date
}

export type FavoriteCounts = Record<FavoriteEntityType, number> & { total: number }

/** Narrowing guard for the untyped `entity_type` text column and for API input. */
export function isFavoriteEntityType(value: unknown): value is FavoriteEntityType {
  return typeof value === 'string' && (FAVORITE_ENTITY_TYPES as readonly string[]).includes(value)
}

/**
 * Make a FavoriteItem href safe to use from a vertical subdomain. Pass-through
 * for hrefs that are already absolute.
 */
export function absoluteFavoriteUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href
  const origin = (process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools').replace(/\/+$/, '')
  return `${origin}${href}`
}

/** What a per-type resolver returns, keyed by target id. */
type Resolved = Map<string, Pick<FavoriteItem, 'title' | 'subtitle' | 'href' | 'imageUrl'>>

// #endregion

// #region Per-type resolvers
//
// Each takes the ids of one entity type and returns only the rows that are
// still publicly visible. Anything missing from the returned map is dropped by
// the caller, which covers both "deleted" and "no longer published" with one
// mechanism: if the detail page would 404 or hide it, the favourite does not
// render either.

async function resolveTools(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, summary: tools.summary })
    .from(tools)
    // getToolBySlug also requires 'published', so an unpublished tool has no page to link to.
    .where(and(inArray(tools.id, ids), eq(tools.status, 'published')))

  const out: Resolved = new Map()
  for (const r of rows) {
    out.set(r.id, { title: r.name, subtitle: r.summary, href: `/tools/${r.slug}` })
  }
  return out
}

async function resolveAlbums(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: albums.id,
      url: albums.url,
      title: albums.title,
      photographer: albums.photographer,
      coverImageUrl: albums.coverImageUrl,
      eventName: events.name,
      eventType: events.eventType,
      eventYear: events.year,
    })
    .from(albums)
    .innerJoin(events, eq(events.id, albums.eventId))
    .where(and(inArray(albums.id, ids), eq(albums.status, 'published')))

  const out: Resolved = new Map()
  for (const r of rows) {
    const eventLabel = displayEventName({ name: r.eventName, eventType: r.eventType, year: r.eventYear })
    out.set(r.id, {
      // An album with no scraped title is still worth showing, so fall back to
      // the event it came from rather than dropping the row.
      title: r.title || eventLabel,
      subtitle: r.photographer ? `${r.photographer} · ${eventLabel}` : eventLabel,
      // Albums have no detail page in this app; the card links straight out to
      // the photographer's gallery, and so does the saved item.
      href: r.url,
      imageUrl: r.coverImageUrl ?? undefined,
    })
  }
  return out
}

async function resolveEvents(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      tbaKey: events.tbaKey,
      name: events.name,
      eventType: events.eventType,
      year: events.year,
      city: events.city,
      stateProv: events.stateProv,
    })
    .from(events)
    .where(inArray(events.id, ids))

  const out: Resolved = new Map()
  for (const r of rows) {
    const place = [r.city, r.stateProv].filter(Boolean).join(', ')
    out.set(r.id, {
      title: displayEventName(r),
      subtitle: place ? `${place} · ${r.year}` : String(r.year),
      // Not gated on having albums: a saved event is a watch, and the event
      // page renders fine empty. New albums appearing is the whole point.
      href: `/photos/event/${r.tbaKey}`,
    })
  }
  return out
}

async function resolveFields(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: practiceFields.id,
      name: practiceFields.name,
      teamNumber: practiceFields.teamNumber,
      teamName: practiceFields.teamName,
      city: practiceFields.city,
      region: practiceFields.region,
    })
    .from(practiceFields)
    .where(and(inArray(practiceFields.id, ids), eq(practiceFields.status, 'published')))

  // One extra query for every field's photos, then take the first per field.
  // Cheaper than a lateral join and keeps the ordering rule (sortOrder, then
  // createdAt) identical to lib/queries/fields.ts.
  const coverByField = new Map<string, string>()
  if (rows.length > 0) {
    const photoRows = await db
      .select({ id: fieldPhotos.id, fieldId: fieldPhotos.fieldId })
      .from(fieldPhotos)
      .where(inArray(fieldPhotos.fieldId, rows.map((r) => r.id)))
      .orderBy(asc(fieldPhotos.sortOrder), asc(fieldPhotos.createdAt))
    for (const p of photoRows) {
      if (!coverByField.has(p.fieldId)) coverByField.set(p.fieldId, `/api/fields/photo/${p.id}`)
    }
  }

  const out: Resolved = new Map()
  for (const r of rows) {
    const owner = r.teamNumber ? `Team ${r.teamNumber}` : r.teamName
    const place = [r.city, r.region].filter(Boolean).join(', ')
    const subtitle = [owner, place].filter(Boolean).join(' · ')
    out.set(r.id, {
      title: r.name,
      subtitle: subtitle || null,
      href: `/fields/${r.id}`,
      imageUrl: coverByField.get(r.id),
    })
  }
  return out
}

async function resolveGrants(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: grants.id,
      slug: grants.slug,
      name: grants.name,
      summary: grants.summary,
      funderName: grantFunders.name,
    })
    .from(grants)
    .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
    // Only 'published' is public. A grant pulled back to pending because its
    // facts stopped checking out must not keep showing on a home page.
    .where(and(inArray(grants.id, ids), eq(grants.status, 'published')))

  const out: Resolved = new Map()
  for (const r of rows) {
    out.set(r.id, {
      title: r.name,
      // No deadline in the subtitle on purpose. A wrong deadline is worse than
      // no deadline, and this list has no room to show what was human-verified
      // and when. The grant page carries the dates and their provenance.
      subtitle: r.summary ?? r.funderName ?? null,
      href: `/grants/${r.slug}`,
    })
  }
  return out
}

const RESOLVERS: Record<FavoriteEntityType, (ids: string[]) => Promise<Resolved>> = {
  tool: resolveTools,
  album: resolveAlbums,
  event: resolveEvents,
  field: resolveFields,
  grant: resolveGrants,
}

// #endregion

// #region Reads

/**
 * Every favourite the user still has a live target for, newest saved first.
 *
 * Cost is one query for the favourites plus one per distinct entity type
 * present (plus one for field photos), never one per favourite.
 */
export async function getFavoritesForUser(
  userId: string,
  opts: { entityType?: FavoriteEntityType } = {},
): Promise<FavoriteItem[]> {
  const db = getDb()

  const rows = await db
    .select()
    .from(favorites)
    .where(
      opts.entityType
        ? and(eq(favorites.userId, userId), eq(favorites.entityType, opts.entityType))
        : eq(favorites.userId, userId),
    )
    .orderBy(desc(favorites.createdAt))

  if (rows.length === 0) return []

  // Group ids by type. Rows with an entityType we no longer recognise (an old
  // vertical, a bad write) are skipped here rather than crashing the page.
  const idsByType = new Map<FavoriteEntityType, string[]>()
  for (const row of rows) {
    if (!isFavoriteEntityType(row.entityType)) continue
    const list = idsByType.get(row.entityType)
    if (list) list.push(row.entityId)
    else idsByType.set(row.entityType, [row.entityId])
  }

  const present = [...idsByType.entries()]
  const resolvedPerType = await Promise.all(
    present.map(async ([type, ids]) => [type, await RESOLVERS[type]([...new Set(ids)])] as const),
  )
  const byType = new Map<FavoriteEntityType, Resolved>(resolvedPerType)

  const items: FavoriteItem[] = []
  for (const row of rows) {
    if (!isFavoriteEntityType(row.entityType)) continue
    const target = byType.get(row.entityType)?.get(row.entityId)
    if (!target) continue // target deleted or no longer public
    items.push({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      title: target.title,
      subtitle: target.subtitle,
      href: target.href,
      imageUrl: target.imageUrl,
      note: row.note,
      createdAt: row.createdAt,
    })
  }
  return items
}

/** Has this user saved this exact thing? One indexed lookup. */
export async function isFavorited(
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(
      and(
        eq(favorites.userId, userId),
        eq(favorites.entityType, entityType),
        eq(favorites.entityId, entityId),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Saved count per type, for nav badges.
 *
 * APPROXIMATE by design: it counts favourite ROWS without resolving targets,
 * so it can be higher than what getFavoritesForUser renders when a target has
 * been deleted or unpublished. Anywhere the number sits next to the list
 * itself, derive it from the list instead.
 */
export async function getFavoriteCounts(userId: string): Promise<FavoriteCounts> {
  const db = getDb()
  const rows = await db
    .select({ entityType: favorites.entityType, count: sql<number>`count(*)::int` })
    .from(favorites)
    .where(eq(favorites.userId, userId))
    .groupBy(favorites.entityType)

  const counts = Object.fromEntries(FAVORITE_ENTITY_TYPES.map((t) => [t, 0])) as FavoriteCounts
  counts.total = 0
  for (const r of rows) {
    if (!isFavoriteEntityType(r.entityType)) continue
    counts[r.entityType] = r.count
    counts.total += r.count
  }
  return counts
}

/**
 * Does the target of a would-be favourite actually exist and is it public?
 *
 * Called before an insert so the table does not fill with rows pointing at
 * nothing. Reuses the read resolvers, so "exists" here means exactly the same
 * thing as "will render in the list".
 */
export async function favoriteTargetExists(
  entityType: FavoriteEntityType,
  entityId: string,
): Promise<boolean> {
  const resolved = await RESOLVERS[entityType]([entityId])
  return resolved.has(entityId)
}

// #endregion

// #region Writes

/**
 * Save something. Idempotent: saving twice is not an error, it just returns
 * the existing row. A note is only written when one is supplied, so a second
 * save from a card (which sends no note) cannot wipe a note typed elsewhere.
 */
export async function addFavorite(
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
  note?: string | null,
): Promise<Favorite> {
  const db = getDb()
  const values = { userId, entityType, entityId, note: note ?? null }
  const conflictTarget = [favorites.userId, favorites.entityType, favorites.entityId]

  const [row] = await db
    .insert(favorites)
    .values(values)
    .onConflictDoUpdate({
      target: conflictTarget,
      // No-op update on conflict when there is no note, purely so RETURNING
      // gives us the existing row instead of nothing.
      set: note === undefined ? { entityId } : { note: note ?? null },
    })
    .returning()

  return row
}

/** Unsave. Returns false when there was nothing to remove, so the API can 404. */
export async function removeFavorite(
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.userId, userId),
        eq(favorites.entityType, entityType),
        eq(favorites.entityId, entityId),
      ),
    )
    .returning({ id: favorites.id })
  return deleted.length > 0
}

// #endregion
