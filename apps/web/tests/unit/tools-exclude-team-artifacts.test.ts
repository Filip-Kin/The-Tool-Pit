/**
 * Guard: the tools vertical must never show robot code or team CAD.
 *
 * Robot code and CAD live in the same `tools` table but are their own vertical
 * (/robot-code). They were only DEMOTED in general search, so they still turned
 * up in browse and search, and the "FRC tools" count read 961 when only 301 were
 * real tools; the other 660 were team artifacts. The rule now is a clean divide:
 * no intermingling.
 *
 * The predicate is one exported value, and this walks the home page's own imports
 * to find the rows, the same way recommendations-exclude-dead-tools does. A
 * section added later is caught by the same test: it uses the predicate or it
 * names itself in EXEMPT with the reason written down.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')
const HOME = readFileSync(join(ROOT, 'app/(public)/page.tsx'), 'utf8')
const QUERIES = readFileSync(join(ROOT, 'lib/queries/tools.ts'), 'utf8')
const SEARCH = readFileSync(join(ROOT, 'lib/search/search.ts'), 'utf8')
const PROGRAM_CARDS = readFileSync(join(ROOT, 'components/program/program-cards.tsx'), 'utf8')

const PREDICATE = 'NOT_TEAM_ARTIFACT'

/**
 * Rows allowed to carry a team artifact, and why. Only one: a visitor's own
 * bookmarks are their list, cross-vertical by nature, and hiding a repo they
 * saved because it is code would lose their own pick.
 */
const EXEMPT: Record<string, string> = {
  getFavoriteTools:
    'the visitor bookmarked these themselves; the list spans every vertical and hiding their saved repo is wrong',
}

/** Every getX(...) the home page awaits, read off the page rather than listed. */
function homePageQueryCalls(): string[] {
  const imported = HOME.match(/import\s*\{([^}]+)\}\s*from\s*'@\/lib\/queries\/tools'/)
  expect(imported).not.toBeNull()
  const names = imported![1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  expect(names.length).toBeGreaterThanOrEqual(5)
  return names
}

/** The body of an exported async function, brace-matched from its signature. */
function functionBody(source: string, name: string): string {
  const signature = source.indexOf(`export async function ${name}(`)
  expect(signature).toBeGreaterThan(-1)
  const paramsEnd = source.indexOf(')', signature)
  const open = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`could not read the body of ${name}`)
}

describe('tools vertical excludes robot code and CAD', () => {
  it('exports the predicate rather than repeating the SQL', () => {
    expect(QUERIES).toContain(`export const ${PREDICATE}`)
  })

  it('excludes team artifacts from every home page tools row', () => {
    const offenders: string[] = []
    for (const name of homePageQueryCalls()) {
      if (name in EXEMPT) continue
      if (!functionBody(QUERIES, name).includes(PREDICATE)) {
        offenders.push(`${name} does not use ${PREDICATE}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the exemption list short and accounted for', () => {
    expect(Object.keys(EXEMPT)).toHaveLength(1)
    for (const reason of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('excludes team artifacts from general search unless the caller asked for them', () => {
    // The exclusion is gated on teamFilterActive so the Robot Code Archive and
    // team searches still run. Both the guard and its gate must be present.
    expect(SEARCH).toContain('teamFilterActive')
    expect(SEARCH).toMatch(/if \(!teamFilterActive\) conditions\.push\(sql`not \(\$\{tools\.isTeamCode\} or \$\{tools\.isTeamCad\}\)`\)/)
  })

  it('excludes team artifacts from the per-program tool count', () => {
    expect(PROGRAM_CARDS).toContain(PREDICATE)
  })
})
