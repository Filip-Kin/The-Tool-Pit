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
