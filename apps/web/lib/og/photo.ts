import { siteUrl } from '@the-tool-pit/types'

/**
 * An absolute image URL for an OpenGraph card, or undefined.
 *
 * The card renderer (next/og ImageResponse) fetches the photo server-side while
 * building the PNG, so a relative "/api/fields/photo/<id>" has to become a full
 * URL first. An already-absolute URL (an album cover hosted on Flickr/SmugMug)
 * is passed through unchanged.
 */
export function absoluteOgPhotoUrl(url: string | null | undefined): string | undefined {
  const clean = url?.trim()
  if (!clean) return undefined
  if (/^https?:\/\//i.test(clean)) return clean
  return `${siteUrl()}${clean.startsWith('/') ? '' : '/'}${clean}`
}
