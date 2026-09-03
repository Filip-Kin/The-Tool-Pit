/**
 * Junk gate for album candidates.
 *
 * Crawls drop three kinds of thing into the queue that are never an event photo
 * album: Open Alliance build threads, single videos / non-album links, and a
 * team's general photo gallery. This module recognises only the CLEAR cases from
 * the signals the pipeline already has (title, thread title, blurb, URL, host,
 * the connector's event hint), so ingest can auto-suppress them to a distinct,
 * filterable reason instead of leaving a moderator to reject each one by hand.
 *
 * Conservative on purpose. Every rule here removes a row from the actionable
 * queue, so each one fires only on an unambiguous signal and a real event album
 * must never match. Dead-link detection is NOT here: it needs the page fetch the
 * enrich job already does, so it lives in album-enrich.
 */

/** Distinct, filterable rejection reasons the junk gate assigns. */
export const ALBUM_JUNK_REASONS = {
  /** An Open Alliance build thread/album, not event photos. */
  openAlliance: 'open_alliance',
  /** A single video or other non-album link (YouTube/Vimeo). */
  notPhotoAlbum: 'not_a_photo_album',
  /** A team's general photo gallery rather than one event's photos. */
  notEventPhotos: 'not_event_photos',
} as const

/** Reason a candidate whose URL 404s is retired. Assigned by enrich, not here. */
export const DEAD_LINK_REASON = 'dead_link'

export interface AlbumJunkInput {
  canonicalUrl: string | null
  sourceUrl: string
  /** The connector's event hint. Present means "this crawl tied it to an event". */
  targetEventCode?: string | null
  title?: string | null
  threadTitle?: string | null
  blurb?: string | null
}

/** Video hosts. We list photo albums; a link on one of these is never one. */
const VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
])

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * A general-gallery title: a team/club's whole photo collection, not one event.
 * Kept tight - "Full Event Gallery" and the like must NOT match, so the marker
 * word sits immediately before the photos/gallery noun.
 */
const GENERAL_GALLERY_RE =
  /\b(?:team|club|our|all\s+our)\s+(?:photos|pics|pictures|gallery|galleries)\b|\bphoto\s+(?:archive|gallery)\b|\bmedia\s+gallery\b/i

/**
 * Classify a candidate as junk from the signals ingest already has, or return
 * null to let it through. Pure - no I/O - so ingest, enrich and the tests share
 * exactly one definition of what counts as junk.
 */
export function classifyAlbumJunk(input: AlbumJunkInput): { reason: string } | null {
  const text = `${input.title ?? ''} ${input.threadTitle ?? ''} ${input.blurb ?? ''}`.toLowerCase()
  const urls = `${input.canonicalUrl ?? ''} ${input.sourceUrl}`.toLowerCase()

  // 1. Open Alliance build threads/albums are not event photos. The phrase rides
  //    in the thread title / blurb; a CD Open Alliance thread slug uses
  //    "open-alliance" in the URL.
  if (/\bopen alliance\b/.test(text) || /open-alliance/.test(urls)) {
    return { reason: ALBUM_JUNK_REASONS.openAlliance }
  }

  // 2. A single video / non-album link. A YouTube or Vimeo URL is never a photo
  //    album, whatever its item count, so the host alone is enough.
  const host = hostOf(input.canonicalUrl) ?? hostOf(input.sourceUrl)
  if (host && VIDEO_HOSTS.has(host)) {
    return { reason: ALBUM_JUNK_REASONS.notPhotoAlbum }
  }

  // 3. A team's general gallery rather than event photos. Only the unambiguous
  //    case: a general-gallery title with NO event the connector could name AND
  //    no year anywhere in the text. A real event album carries one or the other
  //    (a code from the crawl, or a year in its title), so this cannot drop one.
  const hasYear = /\b(?:19|20)\d{2}\b/.test(text)
  if (!input.targetEventCode && !hasYear && GENERAL_GALLERY_RE.test(text)) {
    return { reason: ALBUM_JUNK_REASONS.notEventPhotos }
  }

  return null
}
