import { timingSafeEqual } from 'crypto'

/**
 * Shared-secret check for the /api/internal routes. The caller sends
 * INTERNAL_API_SECRET in the x-internal-secret header. Unset on this side means
 * no internal route exists: callers answer 404 rather than accept anything.
 * Compared in constant time.
 */
export function authorised(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim()
  if (!expected) return false
  const given = req.headers.get('x-internal-secret')?.trim() ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
