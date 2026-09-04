import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The admin create route is the one door into event_listings with no bot check
 * on it, so the admin check is the only thing holding it shut.
 *
 * /events/submit is behind Turnstile, which is right for a form on the public
 * internet and wrong for staff: a moderator entering an event somebody emailed
 * over had to solve a bot check to write a row they are allowed to write. The
 * fix was a second door under /admin. The risk that comes with it is that the
 * second door is easier to leave open than the first, and an open one takes
 * anonymous writes with source 'admin' on them, which is worse than an
 * anonymous submission because the directory would believe staff entered it.
 *
 * So: this route checks the session, and the public one keeps its bot check.
 * Both halves, because deleting either is the same bug from a different side.
 */

const WEB_ROOT = process.cwd()
const ADMIN_ROUTE = 'app/admin/api/event-listings/route.ts'
const PUBLIC_ROUTE = 'app/api/events/submit/route.ts'

function read(path: string): string {
  return readFileSync(join(WEB_ROOT, path), 'utf8')
}

describe('the admin create route', () => {
  const src = read(ADMIN_ROUTE)

  it('refuses a request with no admin session', () => {
    expect(src).toMatch(/isAdmin\(\)/)
    expect(src).toMatch(/status:\s*401/)
  })

  it('checks the session before it reads the body', () => {
    // A check that runs after the insert is not a check. Order is the
    // assertion, and it compares the call sites, not the import line.
    expect(src.indexOf('await isAdmin()')).toBeLessThan(src.indexOf('await createEventSubmission('))
  })

  it('files what it writes as an admin entry, not as a public submission', () => {
    expect(src).toMatch(/source:\s*'admin'/)
  })

  it('publishes through the same path the Publish button uses', () => {
    // Not its own UPDATE. approveEvent is where the publish bar lives, and a
    // second writer would be a second set of rules for the same column.
    expect(src).toMatch(/approveEvent\(/)
    expect(src).not.toMatch(/status:\s*'published'\s*,\s*publishedAt/)
  })
})

describe('the public submit route', () => {
  const src = read(PUBLIC_ROUTE)

  it('still verifies Turnstile', () => {
    expect(src).toMatch(/TURNSTILE_SECRET_KEY/)
    expect(src).toMatch(/siteverify/)
  })

  it('does not choose its own source', () => {
    // The default is 'submission'. A public request that could name its own
    // source could file itself as staff-entered.
    expect(src).not.toMatch(/source:\s*'admin'/)
  })
})
