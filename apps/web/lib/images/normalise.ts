/**
 * One place where every uploaded image is made safe to store and cheap to serve.
 *
 * Everything the site accepts as an upload goes through here: album covers
 * (app/admin/album-candidates/actions.ts) and practice-field photos
 * (lib/fields/form-parse.ts, which feeds the public submit route, the public
 * edit-proposal route and the admin add-photo action). All of them land in a
 * Postgres bytea column and come back out through an API route, so every
 * megabyte we do not need is database size, backup size and response time.
 *
 * The client half of this (a canvas downscale before upload) is a bandwidth
 * optimisation and nothing more. A browser without canvas, a curl POST, or
 * anyone who reads the network tab can send whatever they like, so the server
 * does the work again and does not trust the result it is handed.
 *
 * What the transform does, and why:
 *
 *   - Auto-orients from the EXIF orientation tag first, so a phone photo that
 *     was "rotated" only by metadata comes out the right way up once that
 *     metadata is gone.
 *   - Caps the longest edge. Nothing on the site displays these bigger than
 *     the profile sizes below, so the extra pixels were pure storage cost.
 *   - Re-encodes to WebP. Measured on three real 12 to 28 MP photos, resized to
 *     1600px: WebP q80 came out 11 to 31 percent smaller than plain JPEG q82,
 *     and about level with mozjpeg q82 (smaller on two, 12 percent larger on
 *     one). So the size win over JPEG is real but modest, and the actual reason
 *     to pick it is that one format covers photos, alpha and animation. That
 *     means one output content_type, one code path, and no "is this a PNG"
 *     branching in the serving route.
 *
 *     AVIF was measured too: 37 to 47 percent smaller, which is a genuinely
 *     better ratio, but it took 4 to 8 seconds per image against WebP's 0.5 to
 *     0.9. Seconds of CPU inside an upload request is the wrong trade, and
 *     Safari only reached AVIF in 16.4 against WebP's 14.
 *   - Drops all metadata. sharp only copies EXIF/XMP/ICC when you ask it to
 *     with withMetadata(), and we never ask. That matters because a phone photo
 *     carries GPS coordinates, a camera serial and a timestamp, none of which
 *     has any business on a public cover image.
 *   - Rasterises SVG, which also removes it as a script-injection vector.
 *
 * Animated GIF and animated WebP keep their frames; they are re-encoded as
 * animated WebP rather than being flattened to frame one.
 */

// #region loading sharp

type SharpModule = (typeof import('sharp'))['default']

let loading: Promise<SharpModule> | null = null

/**
 * Load sharp on first use, never at module scope.
 *
 * This is not a micro-optimisation, it is what makes the Docker build work.
 * `next build` runs under bun in docker/web.Dockerfile (the builder stage is
 * oven/bun:1.3-alpine), and its "Collecting page data" step imports every route
 * module to read the config off it. With a top-level `import sharp from 'sharp'`
 * that import runs, and sharp's ESM entry under bun resolves its native binary
 * with an empty base path:
 *
 *     Cannot find module '@img/sharp-linuxmusl-x64/sharp.node' from ''
 *
 * The binary is installed and correct. Requiring the same package under bun by
 * hand works. It is only sharp's ESM entry, loaded by a bun build worker, that
 * loses its resolution base, and the build dies on the first route that touches
 * this file. Deferring the import means page-data collection never evaluates it.
 *
 * The runtime is node:22-alpine, not bun, and resolves it the normal way. The
 * promise is cached, so this costs one resolution for the life of the process.
 */
function getSharp(): Promise<SharpModule> {
  loading ??= import('sharp').then((mod) => mod.default ?? (mod as unknown as SharpModule))
  return loading
}

// #endregion

// #region limits

/**
 * Hard server-side ceiling on a single uploaded file, checked before we read
 * the bytes so an absurd upload is refused without allocating it. 25 MB clears
 * a phone photo (8 to 12 MB) with room for a full-frame DSLR JPEG, which runs
 * to 20 MB.
 *
 * next.config.ts sets the server-action body limit above this on purpose: the
 * limit has to leave headroom over the ceiling, otherwise Next rejects the
 * request before the action runs and the browser shows "An unexpected response
 * was received from the server" instead of a real message.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '25 MB'

/**
 * Combined ceiling for one multi-file request. Eight photos at the per-file
 * limit would otherwise be a 200 MB POST to a form that does not require
 * sign-in, and Next buffers the whole body before the route sees it.
 *
 * 50 MB is a large increase on what the field routes could actually accept
 * before this change: next.config.ts had left
 * experimental.middlewareClientMaxBodySize at its 10 MB default, so any
 * multi-photo submission over 10 MB had its body truncated and died as
 * "Failed to parse body as FormData" with a 500. The form has always claimed
 * eight photos were allowed. This is the first time that is close to true.
 *
 * Whatever gets through here shrinks to a few hundred KB before it is stored,
 * so the number bounds the request, not the database.
 */
export const MAX_UPLOAD_BATCH_BYTES = 50 * 1024 * 1024
export const MAX_UPLOAD_BATCH_LABEL = '50 MB'

/**
 * Decoded-pixel ceiling. File size alone does not bound the work: a few
 * hundred KB of PNG can decompress to gigapixels. 100 MP is far above any real
 * camera and far below anything that hurts.
 */
const MAX_INPUT_PIXELS = 100_000_000

// #endregion

// #region profiles

/**
 * Longest-edge caps, chosen from what the site actually renders:
 *
 *   cover: album cards are a 3:2 tile in a responsive grid, never wider than
 *     about 700 CSS px. 1600 covers that at 2x on a retina display with room
 *     to spare, and matches what the client-side shrink already targets.
 *   photo: field photos open in a full-screen lightbox
 *     (components/fields/field-gallery.tsx), so they need to hold up at full
 *     viewport width. 2000 covers a 1080p-wide lightbox at 2x and a 4K desktop
 *     at 1x.
 *
 * Quality 80 is the usual knee in the WebP curve. Dropping to 75 saved another
 * 14 to 23 percent on the same three photos, which is tempting, but these open
 * in a full-screen lightbox and 80 is the safer place to sit.
 */
export const IMAGE_PROFILES = {
  cover: { maxEdge: 1600, quality: 80 },
  photo: { maxEdge: 2000, quality: 80 },
} as const

export type ImageProfileName = keyof typeof IMAGE_PROFILES

/**
 * libwebp effort. 6 rather than the default 4 costs about 200 ms more per photo
 * and gives back 4 to 9 percent. An upload is encoded once and served many
 * times, so buying permanent bytes with one-off CPU is the right way round.
 */
const WEBP_EFFORT = 6

// #endregion

/** The stored form of an upload. `contentType` is what the serving route sends back. */
export interface NormalisedImage {
  data: Buffer
  contentType: string
  width: number
  height: number
}

export type NormaliseResult = { image: NormalisedImage } | { error: string }

/** Output content type. Every stored upload is this, whatever came in. */
export const NORMALISED_CONTENT_TYPE = 'image/webp'

/**
 * Downscale, re-encode and strip metadata from raw image bytes.
 *
 * Never throws on bad input: a buffer that is not a decodable image comes back
 * as an `error` string suitable for showing to whoever uploaded it.
 */
export async function normaliseImageBuffer(
  input: Buffer,
  profileName: ImageProfileName,
): Promise<NormaliseResult> {
  const { maxEdge, quality } = IMAGE_PROFILES[profileName]

  let sharp: SharpModule
  try {
    sharp = await getSharp()
  } catch (err) {
    // A native module that will not load is a deploy problem, not a bad
    // upload. Do not blame the file for it.
    console.error('[images] sharp failed to load', err)
    return { error: 'Image processing is unavailable right now. Please tell an admin.' }
  }

  try {
    // Header-only read, so this is cheap. It tells us whether the input has
    // more than one frame, which decides whether we open it as an animation.
    const probe = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    const animated = (probe.pages ?? 1) > 1

    let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated })

    // Auto-orient. Skipped for animations, which carry no EXIF orientation and
    // which sharp cannot rotate frame-wise anyway.
    if (!animated) pipeline = pipeline.rotate()

    const { data, info } = await pipeline
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: WEBP_EFFORT })
      .toBuffer({ resolveWithObject: true })

    // For an animation sharp reports the whole frame strip as `height`; the
    // displayed height is one page.
    const height = info.pageHeight ?? info.height

    return {
      image: { data, contentType: NORMALISED_CONTENT_TYPE, width: info.width, height },
    }
  } catch {
    return { error: 'That file could not be read as an image.' }
  }
}

/**
 * Validate an uploaded File and normalise it.
 *
 * The size check runs against `File.size` before `arrayBuffer()`, so an
 * oversize upload is refused with a real message rather than being read into
 * memory first.
 */
export async function normaliseUploadedImage(
  file: File,
  profileName: ImageProfileName,
): Promise<NormaliseResult> {
  if (file.size === 0) return { error: 'That file is empty.' }
  // The declared type is a hint only; normaliseImageBuffer is what actually
  // decides whether the bytes are an image.
  if (file.type && !file.type.startsWith('image/')) return { error: 'That file is not an image.' }
  if (file.size > MAX_UPLOAD_BYTES) return { error: `Image is larger than ${MAX_UPLOAD_LABEL}.` }

  return normaliseImageBuffer(Buffer.from(await file.arrayBuffer()), profileName)
}
