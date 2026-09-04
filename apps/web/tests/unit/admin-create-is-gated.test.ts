import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The admin create route is the one door into every vertical with no bot check
 * on it, so the admin check is the only thing holding it shut.
 *
 * The six public forms are behind Turnstile, which is right for a form on the
 * public internet and wrong for staff: a moderator entering something that
 * arrived by email had to solve a bot check to write a row they are allowed to
 * write. The fix was a second door. The risk that comes with it is that the
 * second door is easier to leave open than the first, and an open one takes
 * anonymous writes stamped as staff-entered, which is worse than an anonymous
 * submission because the directory would believe an admin entered it.
 *
 * So: this route checks the session, every public route keeps its bot check,
 * and every vertical is covered rather than the one that got written first.
 */

const WEB_ROOT = process.cwd()
const ROUTE = 'app/admin/api/listings/[vertical]/route.ts'
const REGISTRY = 'lib/admin/create-listing.ts'

function read(path: string): string {
  return readFileSync(join(WEB_ROOT, path), 'utf8')
}

/** The six the passing-along default is keyed by. If that list grows, this fails. */
const VERTICALS = read('lib/listings/passing-along.ts')
  .match(/export type SubmitVertical =([^\n]+)/)![1]
  .match(/'([a-z_]+)'/g)!
  .map((q) => q.replaceAll("'", ''))

describe('the admin create route', () => {
  const src = read(ROUTE)

  it('refuses a request with no admin session', () => {
    expect(src).toMatch(/isAdmin\(\)/)
    expect(src).toMatch(/status:\s*401/)
  })

  it('checks the session before it does anything else', () => {
    // A check that runs after the insert is not a check. Order is the
    // assertion, and it compares call sites, not the import line.
    expect(src.indexOf('await isAdmin()')).toBeLessThan(src.indexOf('spec.create('))
  })

  it('refuses a vertical it does not know', () => {
    expect(src).toMatch(/isSubmitVertical\(/)
    expect(src).toMatch(/status:\s*404/)
  })
})

describe('the create registry', () => {
  const src = read(REGISTRY)

  it('knows about all six verticals', () => {
    expect(VERTICALS).toHaveLength(6)
    for (const vertical of VERTICALS) {
      expect(src).toMatch(new RegExp(`^  ${vertical}: \\{`, 'm'))
    }
  })

  it('never leaves a publish request silently ignored', () => {
    // Each entry either publishes or says why it cannot. A third state, where
    // publish: true does nothing and says nothing, is the one that would have
    // an admin believing an event is on the map when it is not.
    const entries = src.split(/^  (?=[a-z_]+: \{)/m).slice(1)
    expect(entries).toHaveLength(6)
    for (const entry of entries) {
      expect(entry.includes('publish:') || entry.includes('publishNote:')).toBe(true)
    }
  })

  it('publishes through the path each vertical already uses', () => {
    // Not its own UPDATE. The approve actions are where the publish bar and
    // the notifications live, and a second writer would be a second set of
    // rules for the same column.
    expect(src).toMatch(/publish:\s*approveEvent/)
    expect(src).toMatch(/publish:\s*approveField/)
    expect(src).not.toMatch(/status:\s*'published'/)
  })

  it('files what it writes as an admin entry where the table records one', () => {
    expect(src).toMatch(/source:\s*'admin'/)
  })
})

describe('the public submit routes', () => {
  const ROUTES = [
    'app/api/submit/route.ts',
    'app/api/robot-code/submit/route.ts',
    'app/api/albums/submit/route.ts',
    'app/api/fields/submit/route.ts',
    'app/api/events/submit/route.ts',
    'app/api/grants/submit/route.ts',
  ]

  it.each(ROUTES)('%s still verifies Turnstile', (path) => {
    const src = read(path)
    expect(src).toMatch(/TURNSTILE_SECRET_KEY/)
    expect(src).toMatch(/siteverify/)
  })

  it.each(ROUTES)('%s cannot name its own source', (path) => {
    // The default is 'submission'. A public request that could choose could
    // file itself as staff-entered.
    expect(read(path)).not.toMatch(/source:\s*'admin'/)
  })

  it('there is one public route per vertical', () => {
    expect(ROUTES).toHaveLength(VERTICALS.length)
  })
})
