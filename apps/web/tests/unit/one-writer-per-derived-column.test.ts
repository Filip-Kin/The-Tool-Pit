/**
 * Guard: a denormalised column has one formula, wherever it is written.
 *
 * popularity_score had three writers with three different sums, and two of them
 * left the votes out. Every upvote a visitor cast was erased by the next crawl
 * that re-published that listing. Nothing looked broken, because the 07:20 pass
 * rebuilt the column each morning and the damage only showed between the two.
 *
 * Two of the three were fixed by hand. The third, apps/worker/src/pipeline/
 * publish.ts, was missed and went on zeroing 2192 Chief Delphi likes across 134
 * listings for weeks, because nothing checked and nobody thought to look again.
 *
 * So: every write of the column names the shared expression, or it is exempt
 * with a reason, and the exemption list is pinned so it cannot grow quietly.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '../../../..')
const ROOTS = ['apps/web', 'apps/worker'].map((r) => join(REPO, r))
const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'tests'])

/** The shared expression every writer is supposed to use. */
const SHARED = 'popularityScoreSql'

/** The column, and the file that owns its definition. */
const COLUMN = 'popularityScore'
const DEFINITION = 'packages/db/src/popularity-score.ts'

/**
 * Writes that legitimately assign something other than the shared expression.
 * Pinned below, so adding one is a decision rather than a side effect.
 */
const EXEMPT: Record<string, string> = {
  'apps/worker/src/pipeline/publish.ts':
    'a brand new row has no votes and no forum likes yet, so its first score is its star count; the re-publish path in the same file uses the shared expression',
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Brace-match an object literal starting at the `{` at `open`. */
function objectAt(source: string, open: number): string | null {
  if (source[open] !== '{') return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/**
 * The object literals a file actually WRITES to the database.
 *
 * Reading `popularityScore:` anywhere in a file is not enough: a select
 * projection, an interface and a mapped result all spell it the same way, and
 * scanning for the bare property flagged five files that only read it.
 *
 * Scanning `.set({ ... })` is not enough either, and that is the version of
 * this guard that passed while the bug was still in the tree. publish.ts builds
 * a NAMED object and spreads it in:
 *
 *     const crawlSet = { ..., chiefDelphiLikes: 0, popularityScore: stars }
 *     await tx.update(tools).set({ ...withoutHumanEdits(crawlSet, edits) })
 *
 * so the property is nowhere near the parentheses. This follows the name back
 * to its declaration, which is where the value is actually decided.
 */
function writtenObjects(source: string): string[] {
  const blocks: string[] = []
  const names = new Set<string>()

  for (const m of source.matchAll(/\.(set|values)\s*\(/g)) {
    const after = m.index! + m[0].length
    const inline = objectAt(source, source.indexOf('{', after) === after ? after : -1)
    if (inline) {
      blocks.push(inline)
      // Names spread into it, e.g. `.set({ ...crawlSet, updatedAt })`.
      for (const spread of inline.matchAll(/\.\.\.(?:\w+\()?(\w+)/g)) names.add(spread[1])
      continue
    }
    // `.values(toolData)` — an identifier rather than a literal.
    const ident = source.slice(after).match(/^\s*(\w+)\s*\)/)
    if (ident) names.add(ident[1])
  }

  for (const name of names) {
    const declared = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\b[^=]*=\\s*\\{`))
    if (!declared) continue
    const body = objectAt(source, source.indexOf('{', declared.index! + declared[0].length - 1))
    if (body) blocks.push(body)
  }

  return blocks
}

/** What a written object assigns to `property`, if anything. */
function writes(source: string, property: string): string[] {
  const out: string[] = []
  for (const block of writtenObjects(source)) {
    for (const m of block.matchAll(new RegExp(`\\b${property}\\s*:([^,\n]*(?:\n(?!\\s*\\w+\\s*:)[^,\n]*)*)`, 'g'))) {
      out.push(`${property}:${m[1]}`)
    }
  }
  return out
}

describe('popularity score', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root))

  it('has a definition to share', () => {
    const definition = readFileSync(join(REPO, DEFINITION), 'utf8')
    expect(definition).toContain(`export const ${SHARED}`)
    // The sum itself: stars, likes and the vote count. A definition that stops
    // counting votes is the original bug wearing the fix's clothes.
    expect(definition).toContain('githubStars')
    expect(definition).toContain('chiefDelphiLikes')
    expect(definition).toContain('toolVotes')
  })

  it('finds the writers at all', () => {
    const writers = files.filter((f) => writes(readFileSync(f, 'utf8'), COLUMN).length > 0)
    // Three today: the daily pass, the vote handler and the publish path. If
    // this drops to zero the scan has broken and the guard means nothing.
    expect(writers.length).toBeGreaterThanOrEqual(2)
  })

  it('writes the column through the shared expression everywhere else', () => {
    const offenders: string[] = []

    for (const file of files) {
      const relative = file.slice(REPO.length + 1)
      if (relative in EXEMPT) continue

      for (const written of writes(readFileSync(file, 'utf8'), COLUMN)) {
        if (!written.includes(SHARED)) offenders.push(`${relative} sets ${written.trim().slice(0, 60)}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps the exemption list pinned', () => {
    expect(Object.keys(EXEMPT)).toHaveLength(1)
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20)
  })

  it('does not let the crawl write forum likes', () => {
    // The specific bug. publish.ts set chiefDelphiLikes from a metadata key
    // that nothing has ever written, so a re-publish wrote a zero over a real
    // count. The forum likes belong to the popularity job alone.
    const publish = readFileSync(join(REPO, 'apps/worker/src/pipeline/publish.ts'), 'utf8')
    expect(writes(publish, 'chiefDelphiLikes')).toEqual([])
  })
})
