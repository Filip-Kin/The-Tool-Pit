import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards against the single most repeated bug of the path migration.
 *
 * The six verticals used to be six hosts, and middleware rewrote a bare path
 * onto whichever vertical you were already in: on photos.frc.tools, `/event/x`
 * meant `/photos/event/x`. Now they are all paths on one host, so a bare
 * `/event/x` means the tools route tree, which does not have that page, and it
 * 404s.
 *
 * This has now bitten three separate times: every vertical's Submit call to
 * action, every event card and search result in photos, and every grant card.
 * The failure is invisible in review because the link looks perfectly ordinary,
 * and TypeScript cannot help because an href is just a string. So it gets a
 * test instead.
 *
 * The rule: a root-relative link written inside a vertical's own code must
 * either start with that vertical's prefix, or be one of the genuinely shared
 * paths below.
 */

/** Directories owned by each vertical, and the prefix their links must carry. */
const VERTICALS = [
  { prefix: '/photos', dirs: ['components/albums', 'app/photos', 'lib/albums'] },
  { prefix: '/fields', dirs: ['components/fields', 'app/fields', 'lib/fields'] },
  { prefix: '/grants', dirs: ['components/grants', 'app/grants', 'lib/grants'] },
  { prefix: '/events', dirs: ['components/events', 'app/events', 'lib/events'] },
  { prefix: '/robot-code', dirs: ['components/robot-code', 'app/robot-code', 'lib/robot-code'] },
]

/**
 * Paths that are the same on every vertical and so are correct unprefixed.
 * `/tools/...` is here because a tool listing genuinely lives on the tools
 * tree, and the robot code archive links to it on purpose.
 */
const SHARED_PREFIXES = ['/api', '/_next', '/admin', '/me', '/tools/', '/submit-']
const SHARED_EXACT = ['/', '/submit']

/** href="...", router.push('...'), redirect('...'), all with either quote or a backtick. */
const LINK_RE = /(?:href=\{?|router\.(?:push|replace)\(|redirect\()["'`](\/[^"'`\s)]*)/g

function walk(dir: string): string[] {
  let out: string[] = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out // a vertical need not own every directory shape
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('vertical links carry their own prefix', () => {
  for (const { prefix, dirs } of VERTICALS) {
    it(`${prefix} links are never written bare`, () => {
      const offenders: string[] = []

      for (const dir of dirs) {
        for (const file of walk(join(process.cwd(), dir))) {
          const src = readFileSync(file, 'utf8')
          for (const m of src.matchAll(LINK_RE)) {
            const href = m[1]!
            // A template hole in the very first segment (`/${slug}`) cannot be
            // checked by prefix, and is exactly how the grant card broke, so
            // it is always an offender.
            const bare =
              href.startsWith('/${') ||
              // The prefix may be followed by a path, a query or a hash:
              // `/robot-code?program=frc` is correct and must not be flagged.
              (!new RegExp(`^${prefix}([/?#]|$)`).test(href) &&
                !SHARED_EXACT.includes(href) &&
                !SHARED_PREFIXES.some((p) => href.startsWith(p)))
            if (bare) offenders.push(`${file.replace(process.cwd() + '/', '')}: ${href}`)
          }
        }
      }

      expect(offenders, `these need the ${prefix} prefix:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
