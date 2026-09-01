/** Small typed getters for multipart FormData (shared by the submit + edit routes). */
import {
  normaliseUploadedImage,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_BATCH_LABEL,
} from '@/lib/images/normalise'

export function formStr(form: FormData, key: string): string | undefined {
  const v = form.get(key)
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function formNum(form: FormData, key: string): number | undefined {
  const v = formStr(form, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function formBool(form: FormData, key: string): boolean {
  const v = form.get(key)
  return v === 'true' || v === 'on' || v === '1'
}

/** Read a JSON string field into a string array (e.g. removePhotoIds). */
export function formStringArray(form: FormData, key: string): string[] {
  const v = form.get(key)
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// #region photo uploads
export const MAX_PHOTO_BYTES = MAX_UPLOAD_BYTES
export const MAX_PHOTOS = 8

/**
 * Read the multipart body, turning a body Next refused to buffer into a real
 * message instead of a 500.
 *
 * Next 15.5 caps a route-handler request body at
 * experimental.middlewareClientMaxBodySize and TRUNCATES anything larger rather
 * than rejecting it, so `req.formData()` then throws "Failed to parse body as
 * FormData". next.config.ts sets that cap above MAX_UPLOAD_BATCH_BYTES so the
 * ordinary too-many-megabytes case is caught by readPhotoFiles with a message
 * that says what to do. This is the backstop for a post so large it never gets
 * that far.
 */
export async function readMultipartForm(
  req: Request,
): Promise<{ form: FormData } | { error: string; status: number }> {
  try {
    return { form: await req.formData() }
  } catch {
    return {
      error: `That upload could not be read. It is probably too large: keep the photos under ${MAX_UPLOAD_BATCH_LABEL} in total.`,
      status: 413,
    }
  }
}

export interface ParsedPhoto {
  data: Buffer
  contentType: string
}

/**
 * Read, validate and normalise uploaded image files from a multipart form
 * (shared by the submit + edit routes and the admin add-photo action). Returns
 * the stored-ready photos or a user-facing error.
 *
 * Every photo is downscaled, re-encoded to WebP and stripped of EXIF by
 * lib/images/normalise.ts before it gets anywhere near the database, because
 * these live in a bytea column and are served back through an API route. The
 * contentType returned here is the normalised one, not whatever the browser
 * claimed.
 */
export async function readPhotoFiles(
  form: FormData,
  key = 'photos',
): Promise<{ photos: ParsedPhoto[] } | { error: string }> {
  const files = form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length > MAX_PHOTOS) return { error: `Please attach at most ${MAX_PHOTOS} photos.` }

  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > MAX_UPLOAD_BATCH_BYTES) {
    return { error: `Those photos add up to more than ${MAX_UPLOAD_BATCH_LABEL}. Please upload fewer at a time.` }
  }

  const photos: ParsedPhoto[] = []
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) return { error: `Each photo must be under ${MAX_UPLOAD_LABEL}.` }
    const normalised = await normaliseUploadedImage(file, 'photo')
    if ('error' in normalised) return normalised
    photos.push({ data: normalised.image.data, contentType: normalised.image.contentType })
  }
  return { photos }
}
// #endregion
