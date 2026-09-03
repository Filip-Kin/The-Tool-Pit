/**
 * Guards for the listing-ownership role model.
 *
 * Two rules that are easy to break from a distance:
 *
 *   1. There are exactly two listing roles, owner and editor. 'viewer' was
 *      dropped because everything on a listing is public, so a read-only role
 *      granted nothing. A row that still reads 'viewer' must read as an editor,
 *      never crash and never be trusted as an owner.
 *   2. Only an OWNER may invite, and an invite is by email at owner or editor.
 *      An editor can change the listing but not widen who can.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { LISTING_OWNER_ROLES, LISTING_WRITE_ROLES, coerceOwnerRole } from '@the-tool-pit/db'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../../..')
const actionsSrc = readFileSync(join(REPO, 'apps/web/app/me/listings/actions.ts'), 'utf8')

describe('listing role vocabulary', () => {
  it('is exactly owner and editor, with no viewer', () => {
    expect([...LISTING_OWNER_ROLES]).toEqual(['owner', 'editor'])
    expect(LISTING_OWNER_ROLES as readonly string[]).not.toContain('viewer')
  })

  it('lets both roles write', () => {
    expect([...LISTING_WRITE_ROLES].sort()).toEqual(['editor', 'owner'])
  })

  it('coerces a legacy viewer, an unknown value, and null to editor', () => {
    expect(coerceOwnerRole('owner')).toBe('owner')
    expect(coerceOwnerRole('editor')).toBe('editor')
    expect(coerceOwnerRole('viewer')).toBe('editor')
    expect(coerceOwnerRole('whatever')).toBe('editor')
    expect(coerceOwnerRole(null)).toBe('editor')
    expect(coerceOwnerRole(undefined)).toBe('editor')
  })
})

describe('invite rules', () => {
  it('lets only an owner invite others', () => {
    expect(actionsSrc).toContain('Only an owner of this listing can invite others.')
  })

  it('mints invites at owner or editor, never viewer', () => {
    expect(actionsSrc).toContain("roleRaw === 'owner' ? 'owner' : 'editor'")
    expect(actionsSrc).not.toMatch(/'viewer'\s*\?\s*'viewer'/)
  })

  it('invites by email through the shared notification outbox', () => {
    expect(actionsSrc).toContain('export async function inviteToListing')
    expect(actionsSrc).toContain("kind: 'listing_invite'")
    expect(actionsSrc).toContain('queueNotification')
  })
})
