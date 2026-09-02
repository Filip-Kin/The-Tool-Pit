/**
 * Guard: a home page row that recommends must not recommend a dead tool.
 *
 * Popular has excluded inactive and archived listings since it was written.
 * Rookie Friendly never did, and shipped with an inactive Java tutorial in
 * first place and an archived RobotPy example in second. The exclusion existed
 * the whole time, three lines of inline SQL inside one query, where the next
 * query could not see it and nobody thought to look.
 *
 * So the predicate is one exported value, and this walks the home page's own
 * imports to find the rows. A section added next month is caught by the same
 * test without anybody registering it here: it either uses the predicate or it
 * names itself in EXEMPT, with the reason written down.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')
const HOME = readFileSync(join(ROOT, 'app/(public)/page.tsx'), 'utf8')
const QUERIES = readFileSync(join(ROOT, 'lib/queries/tools.ts'), 'utf8')

const PREDICATE = 'ALIVE_ENOUGH_TO_RECOMMEND'

/**
 * Rows that are allowed to show a stopped tool, and why. Each of these is
 * answering a question of fact rather than making a recommendation.
 */
const EXEMPT: Record<string, string> = {
  getFavoriteTools:
    'the visitor bookmarked these themselves; hiding one because it went quiet loses their own list',
  getFeaturedTools:
    'hand-picked with a note. A curator who features a deprecated tool meant to, and the chip still says Deprecated',
  getOfficialTools:
    'a factual list of what FIRST ships. Several are archived and that is worth knowing, not worth hiding',
  getRecentlyUpdatedTools:
    'ordered by last activity, so a stopped tool cannot reach the row in the first place',
}

/** Every getX(...) the home page awaits, read off the page rather than listed. */
function homePageQueryCalls(): string[] {
  const imported = HOME.match(/import\s*\{([^}]+)\}\s*from\s*'@\/lib\/queries\/tools'/)
  expect(imported).not.toBeNull()
  const names = imported![1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  // Sanity: the home page really does pull its rows from this module. If the
  // import moves, the guard must fail loudly rather than pass on an empty set.
  expect(names.length).toBeGreaterThanOrEqual(5)
  return names
}

/** The body of an exported async function, brace-matched from its signature. */
function functionBody(source: string, name: string): string {
  const signature = source.indexOf(`export async function ${name}(`)
  expect(signature).toBeGreaterThan(-1)

  // Start at the brace that opens the BODY, not the one that opens a
  // destructured parameter. Skipping to the next '{' after the name reads the
  // parameter list instead, which silently makes this whole guard see nothing.
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

describe('home page rows', () => {
  it('exports the predicate rather than repeating the SQL', () => {
    expect(QUERIES).toContain(`export const ${PREDICATE}`)

    // The inline copy is what let the two rows drift. One spelling of it is the
    // constant's own definition; a second means somebody pasted it again.
    const inline = QUERIES.match(/not in \('inactive', 'archived'\)/g) ?? []
    expect(inline).toHaveLength(1)
  })

  it('excludes inactive and archived tools from every recommending row', () => {
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
    // Without this, the easy way past the guard above is to add a name to
    // EXEMPT, and the list grows until it covers the whole page and the guard
    // checks nothing. Changing the count is deliberate; drifting into it is not.
    expect(Object.keys(EXEMPT)).toHaveLength(4)
    for (const reason of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('keeps unknown freshness visible', () => {
    // 478 of 1094 published listings have no repo to read a commit date from.
    // Treating unknown as dead would empty half the catalogue off the page.
    const definition = QUERIES.slice(QUERIES.indexOf(`export const ${PREDICATE}`))
    expect(definition.slice(0, 200)).toContain("coalesce")
    expect(definition.slice(0, 200)).not.toContain("'unknown',")
  })
})
