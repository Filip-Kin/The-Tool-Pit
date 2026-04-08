import { describe, it, expect } from 'vitest'
import type { NextRequest } from 'next/server'
import { resolveVoterIdentity, VOTE_COOKIE_NAME } from '@/lib/voting/fingerprint'

/** Build a minimal NextRequest-like mock with the given cookie value (or none). */
function mockRequest(cookieValue?: string): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        name === VOTE_COOKIE_NAME && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    },
  } as unknown as NextRequest
}

describe('resolveVoterIdentity', () => {
  it('returns isNewCookie=true when no cookie exists', () => {
    const { isNewCookie } = resolveVoterIdentity(mockRequest())
    expect(isNewCookie).toBe(true)
  })

  it('returns isNewCookie=false when cookie already exists', () => {
    const { isNewCookie } = resolveVoterIdentity(mockRequest('existing-uuid'))
    expect(isNewCookie).toBe(false)
  })

  it('generates a non-empty cookieValue when no cookie present', () => {
    const { cookieValue } = resolveVoterIdentity(mockRequest())
    expect(cookieValue).toBeTruthy()
    expect(cookieValue.length).toBeGreaterThan(0)
  })

  it('reuses the existing cookieValue when cookie present', () => {
    const { cookieValue } = resolveVoterIdentity(mockRequest('my-existing-id'))
    expect(cookieValue).toBe('my-existing-id')
  })

  it('fingerprint is a 48-character hex string', () => {
    const { fingerprint } = resolveVoterIdentity(mockRequest('some-value'))
    expect(fingerprint).toMatch(/^[0-9a-f]{48}$/)
  })

  it('fingerprint is stable for the same cookie value', () => {
    const a = resolveVoterIdentity(mockRequest('stable-input')).fingerprint
    const b = resolveVoterIdentity(mockRequest('stable-input')).fingerprint
    expect(a).toBe(b)
  })

  it('fingerprint differs for different cookie values', () => {
    const a = resolveVoterIdentity(mockRequest('value-one')).fingerprint
    const b = resolveVoterIdentity(mockRequest('value-two')).fingerprint
    expect(a).not.toBe(b)
  })

  it('fingerprint differs from the raw cookie value (i.e. it is hashed)', () => {
    const cookieValue = 'my-raw-cookie'
    const { fingerprint } = resolveVoterIdentity(mockRequest(cookieValue))
    expect(fingerprint).not.toBe(cookieValue)
  })

  it('two calls without a cookie return different cookieValues (fresh UUIDs)', () => {
    const a = resolveVoterIdentity(mockRequest()).cookieValue
    const b = resolveVoterIdentity(mockRequest()).cookieValue
    expect(a).not.toBe(b)
  })
})
