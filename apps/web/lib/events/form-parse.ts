/** Small typed getters for multipart FormData, shared by the events routes. */
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

/**
 * A list of whole numbers from a field, whether the form sent one comma or
 * space separated string ("254, 1678") or repeated fields of the same name.
 * Used for the host-team list, where an event can be co-hosted.
 */
export function formNumList(form: FormData, key: string): number[] {
  const raw = form.getAll(key).filter((v): v is string => typeof v === 'string')
  const out: number[] = []
  for (const part of raw.join(',').split(/[^0-9]+/)) {
    const n = Number(part)
    if (part && Number.isInteger(n) && n > 0) out.push(n)
  }
  return out
}
