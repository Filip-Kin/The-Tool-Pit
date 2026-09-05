import sharp from 'sharp'
import { siteUrl } from '@the-tool-pit/types'

/**
 * An absolute image URL for an OpenGraph card, or undefined.
 *
 * A relative "/api/fields/photo/<id>" becomes a full URL; an already-absolute
 * URL (an album cover hosted on Flickr/SmugMug) passes through unchanged.
 */
export function absoluteOgPhotoUrl(url: string | null | undefined): string | undefined {
  const clean = url?.trim()
  if (!clean) return undefined
  if (/^https?:\/\//i.test(clean)) return clean
  return `${siteUrl()}${clean.startsWith('/') ? '' : '/'}${clean}`
}

/**
 * A cover photo as a PNG data URI sized for the OG card's photo panel, or
 * undefined.
 *
 * WHY TRANSCODE. next/og (Satori) only decodes PNG and JPEG, but every upload
 * here is re-encoded to WebP (lib/images/normalise.ts), so passing the photo's
 * own URL renders a blank panel. So the bytes are fetched, re-encoded to PNG
 * with sharp, and handed to the card inline. Cover-cropped to the panel's 540x630
 * at 2x, which also keeps the data URI small. Best-effort: any failure (bad URL,
 * unreachable host, undecodable bytes) returns undefined and the card falls back
 * to its text-only layout rather than throwing and breaking the whole image.
 *
 * Node runtime only (sharp is a native binary) - the OG routes that call this
 * set `export const runtime = 'nodejs'`.
 */
export async function ogPhotoDataUri(url: string | null | undefined): Promise<string | undefined> {
  const abs = absoluteOgPhotoUrl(url)
  if (!abs) return undefined
  try {
    const res = await fetch(abs, { cache: 'no-store' })
    if (!res.ok) return undefined
    const input = Buffer.from(await res.arrayBuffer())
    const png = await sharp(input).resize(1080, 1260, { fit: 'cover' }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return undefined
  }
}
