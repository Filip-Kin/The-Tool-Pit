/** Small typed getters for multipart FormData (shared by the submit + edit routes). */
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
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_PHOTOS = 8

export interface ParsedPhoto {
  data: Buffer
  contentType: string
}

/**
 * Read and validate uploaded image files from a multipart form (shared by the
 * submit + edit routes). Returns the decoded photos or a user-facing error.
 */
export async function readPhotoFiles(
  form: FormData,
  key = 'photos',
): Promise<{ photos: ParsedPhoto[] } | { error: string }> {
  const files = form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length > MAX_PHOTOS) return { error: `Please attach at most ${MAX_PHOTOS} photos.` }
  const photos: ParsedPhoto[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) return { error: 'Photos must be images.' }
    if (file.size > MAX_PHOTO_BYTES) return { error: 'Each photo must be under 10 MB.' }
    photos.push({ data: Buffer.from(await file.arrayBuffer()), contentType: file.type })
  }
  return { photos }
}
// #endregion
