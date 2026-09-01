import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  normaliseImageBuffer,
  normaliseUploadedImage,
  IMAGE_PROFILES,
  MAX_UPLOAD_BYTES,
  NORMALISED_CONTENT_TYPE,
} from '@/lib/images/normalise'

/**
 * The transform every upload goes through before it reaches a bytea column.
 *
 * Fixtures are generated with sharp rather than committed as binaries, so the
 * expectations are readable: "a 4000x3000 JPEG carrying GPS EXIF" is right
 * there in the test instead of being a checksum of a file nobody opens.
 */

/** Noise, not flat colour: a solid image compresses to nothing and proves nothing. */
function noise(width: number, height: number): Buffer {
  const px = Buffer.alloc(width * height * 3)
  let seed = 12345
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    px[i] = (seed >> 16) & 0xff
  }
  return px
}

async function jpeg(
  width: number,
  height: number,
  opts: { exif?: Record<string, Record<string, string>>; orientation?: number } = {},
): Promise<Buffer> {
  let img = sharp(noise(width, height), { raw: { width, height, channels: 3 } })
  if (opts.exif) img = img.withExif(opts.exif)
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation })
  return img.jpeg({ quality: 92 }).toBuffer()
}

function asFile(buf: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buf)], name, { type })
}

/**
 * Write an animated GIF with solid-colour frames.
 *
 * sharp reads animations but cannot author one from raw pixels, and a
 * base64 blob pasted into a test file is a fixture nobody can check, so this
 * emits the format directly. The LZW stream below writes one literal code per
 * pixel and never uses a dictionary entry: a legal encoding, a useless one,
 * and short enough to read against the spec.
 */
function animatedGif(width: number, height: number, frameColours: number[]): Buffer {
  const b: number[] = []
  const u16 = (n: number) => b.push(n & 0xff, (n >> 8) & 0xff)

  b.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) // "GIF89a"
  u16(width)
  u16(height)
  b.push(0x80, 0x00, 0x00) // global colour table of 2, background 0, square pixels
  b.push(0, 0, 0, 255, 255, 255) // the 2 colours
  // NETSCAPE application extension: loop forever.
  b.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00)

  for (const colour of frameColours) {
    b.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00) // graphic control, 100 ms
    b.push(0x2c) // image descriptor
    u16(0)
    u16(0)
    u16(width)
    u16(height)
    b.push(0x00) // no local colour table
    b.push(0x02) // LZW minimum code size
    const data = lzwLiterals(colour, width * height)
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255)
      b.push(chunk.length, ...chunk)
    }
    b.push(0x00) // end of this frame's data
  }
  b.push(0x3b) // trailer
  return Buffer.from(b)
}

/** LZW codes for one solid frame, packed LSB-first, widening exactly as a decoder does. */
function lzwLiterals(colour: number, pixels: number): number[] {
  const CLEAR = 4
  const END = 5
  const out: number[] = []
  let acc = 0
  let accBits = 0
  const emit = (code: number, bits: number) => {
    acc |= code << accBits
    accBits += bits
    while (accBits >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      accBits -= 8
    }
  }

  let bits = 3
  let next = 6
  let firstAfterClear = true
  emit(CLEAR, bits)
  for (let i = 0; i < pixels; i++) {
    emit(colour, bits)
    // A decoder adds one entry for every code except the first after a clear.
    if (firstAfterClear) firstAfterClear = false
    else if (++next === 1 << bits && bits < 12) bits++
    if (next >= 4094) {
      emit(CLEAR, bits)
      bits = 3
      next = 6
      firstAfterClear = true
    }
  }
  emit(END, bits)
  if (accBits > 0) out.push(acc & 0xff)
  return out
}

describe('normaliseImageBuffer', () => {
  it('caps the longest edge at the profile size and keeps the aspect ratio', async () => {
    const res = await normaliseImageBuffer(await jpeg(4000, 3000), 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(IMAGE_PROFILES.cover.maxEdge)
    expect(res.image.height).toBe(1200)
  })

  it('caps the short edge too when the image is portrait', async () => {
    const res = await normaliseImageBuffer(await jpeg(3000, 4000), 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.height).toBe(IMAGE_PROFILES.cover.maxEdge)
    expect(res.image.width).toBe(1200)
  })

  it('uses the larger cap for the field-photo profile', async () => {
    const res = await normaliseImageBuffer(await jpeg(4000, 3000), 'photo')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(IMAGE_PROFILES.photo.maxEdge)
  })

  it('does not enlarge an image that is already small', async () => {
    const res = await normaliseImageBuffer(await jpeg(400, 300), 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(400)
    expect(res.image.height).toBe(300)
  })

  it('converts to WebP and reports that as the stored content type', async () => {
    const res = await normaliseImageBuffer(await jpeg(2000, 1500), 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.contentType).toBe(NORMALISED_CONTENT_TYPE)
    expect((await sharp(res.image.data).metadata()).format).toBe('webp')
  })

  it('converts a PNG to WebP as well', async () => {
    const png = await sharp(noise(1200, 800), { raw: { width: 1200, height: 800, channels: 3 } })
      .png()
      .toBuffer()
    const res = await normaliseImageBuffer(png, 'cover')
    if ('error' in res) throw new Error(res.error)

    expect((await sharp(res.image.data).metadata()).format).toBe('webp')
  })

  it('strips EXIF, including the GPS tags a phone photo carries', async () => {
    const withGps = await jpeg(2000, 1500, {
      exif: {
        IFD0: { Make: 'Google', Model: 'Pixel 8' },
        GPS: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'E' },
      },
    })
    // Guard the fixture: if sharp stopped writing the EXIF, the assertion below
    // would pass for the wrong reason.
    const before = await sharp(withGps).metadata()
    expect(before.exif).toBeDefined()

    const res = await normaliseImageBuffer(withGps, 'cover')
    if ('error' in res) throw new Error(res.error)

    const after = await sharp(res.image.data).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(after.icc).toBeUndefined()
  })

  it('applies EXIF orientation before dropping it, so the photo is not left sideways', async () => {
    // Orientation 6 means "rotate 90 degrees clockwise to display". The stored
    // pixels are 1200x600 but the image is meant to be seen as 600x1200. Both
    // are under the cap, so any change here is the rotation and nothing else.
    const sideways = await jpeg(1200, 600, { orientation: 6 })
    const res = await normaliseImageBuffer(sideways, 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(600)
    expect(res.image.height).toBe(1200)
    expect((await sharp(res.image.data).metadata()).exif).toBeUndefined()
  })

  it('keeps the frames of an animated GIF, and resizes every one of them', async () => {
    const gif = animatedGif(2000, 400, [0, 1, 0])
    expect((await sharp(gif).metadata()).pages).toBe(3)

    const res = await normaliseImageBuffer(gif, 'cover')
    if ('error' in res) throw new Error(res.error)

    const out = await sharp(res.image.data).metadata()
    expect(out.format).toBe('webp')
    expect(out.pages).toBe(3)
    expect(res.image.width).toBe(IMAGE_PROFILES.cover.maxEdge)
    // The reported height is one displayed frame, not the whole frame strip.
    expect(res.image.height).toBe(320)
    // The frames are still distinct, so this is an animation and not the same
    // picture three times.
    const first = await sharp(res.image.data, { page: 0 }).raw().toBuffer()
    const second = await sharp(res.image.data, { page: 1 }).raw().toBuffer()
    expect(first.equals(second)).toBe(false)
  })

  it('shrinks a realistic phone photo by an order of magnitude', async () => {
    const photo = await jpeg(4032, 3024)
    const res = await normaliseImageBuffer(photo, 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.data.length).toBeLessThan(photo.length / 4)
  })

  it('returns an error rather than throwing when the bytes are not an image', async () => {
    const res = await normaliseImageBuffer(Buffer.from('this is a text file, not a photo'), 'cover')

    expect(res).toEqual({ error: 'That file could not be read as an image.' })
  })
})

describe('normaliseUploadedImage', () => {
  it('normalises a File the same way', async () => {
    const file = asFile(await jpeg(3000, 2000), 'photo.jpg', 'image/jpeg')
    const res = await normaliseUploadedImage(file, 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(IMAGE_PROFILES.cover.maxEdge)
    expect(res.image.contentType).toBe(NORMALISED_CONTENT_TYPE)
  })

  it('refuses an oversize file cleanly, without reading it', async () => {
    const huge = asFile(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'huge.jpg', 'image/jpeg')
    const res = await normaliseUploadedImage(huge, 'cover')

    expect(res).toEqual({ error: 'Image is larger than 25 MB.' })
  })

  it('accepts a file right on the ceiling rather than off by one', async () => {
    // Real image bytes padded out to exactly the limit; the size check must let
    // this through and the decode must be what decides.
    const body = await jpeg(800, 600)
    const padded = Buffer.concat([body, Buffer.alloc(MAX_UPLOAD_BYTES - body.length)])
    expect(padded.length).toBe(MAX_UPLOAD_BYTES)

    const res = await normaliseUploadedImage(asFile(padded, 'big.jpg', 'image/jpeg'), 'cover')
    if ('error' in res) throw new Error(res.error)

    expect(res.image.width).toBe(800)
  })

  it('rejects a non-image content type', async () => {
    const res = await normaliseUploadedImage(asFile(Buffer.from('%PDF-1.4'), 'a.pdf', 'application/pdf'), 'cover')

    expect(res).toEqual({ error: 'That file is not an image.' })
  })

  it('rejects an empty file', async () => {
    const res = await normaliseUploadedImage(asFile(Buffer.alloc(0), 'a.jpg', 'image/jpeg'), 'cover')

    expect(res).toEqual({ error: 'That file is empty.' })
  })

  it('does not trust a content type of image/* over the actual bytes', async () => {
    const res = await normaliseUploadedImage(asFile(Buffer.from('not really a jpeg'), 'a.jpg', 'image/jpeg'), 'cover')

    expect(res).toEqual({ error: 'That file could not be read as an image.' })
  })
})
