/**
 * Guard: one vocabulary of tool types, and nothing lists a type that is gone.
 *
 * The list was written out by hand in four places: the schema, the admin
 * editor, the classifier's validator and the search filter row. Removing
 * 'offseason_event' from the schema would have left the classifier still
 * offering it to Claude and the filter row still showing a chip for it, which
 * is how a retired value survives its own deletion.
 *
 * The schema is the vocabulary. Everywhere else may hold a SUBSET, because a
 * filter row is allowed to be shorter than the full list, but nothing may hold
 * a value the schema does not have.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_TYPES } from '@the-tool-pit/db'

const REPO = join(import.meta.dir, '../../../..')
const ROOTS = ['apps/web', 'apps/worker', 'packages/db/src'].map((r) => join(REPO, r))
const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo', '.git'])

/** A value in an array literal that reads like an enum member, not prose. */
const ENUM_LIKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Every array literal in the file that mentions a tool type, with the enum-like
 * strings it contains. Brace-matched from the opening bracket, so an array of
 * objects (the filter row) comes back whole rather than cut at the first '}'.
 */
function toolTypeArrays(source: string): string[][] {
  const found: string[][] = []
  const marker = "'web_app'"

  let from = 0
  for (;;) {
    const hit = source.indexOf(marker, from)
    if (hit === -1) break
    from = hit + marker.length

    // Walk back to the '[' that opens the array holding this value.
    let open = -1
    let depth = 0
    for (let i = hit; i >= 0; i--) {
      if (source[i] === ']') depth++
      else if (source[i] === '[') {
        if (depth === 0) {
          open = i
          break
        }
        depth--
      }
    }
    if (open === -1) continue

    let close = -1
    depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '[') depth++
      else if (source[i] === ']') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close === -1) continue

    const body = source.slice(open, close + 1)
    found.push((body.match(/'([^']+)'/g) ?? []).map((q) => q.slice(1, -1)).filter((v) => ENUM_LIKE.test(v)))
    from = close
  }

  return found
}

describe('tool type vocabulary', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root))

  it('finds the files that list tool types at all', () => {
    // Without this the whole guard passes when the scan breaks or the marker
    // value is renamed, and it would say nothing while drifting freely.
    const listing = files.filter((f) => toolTypeArrays(readFileSync(f, 'utf8')).length > 0)
    expect(listing.length).toBeGreaterThanOrEqual(2)
  })

  it('never lists a type the schema does not have', () => {
    const valid = new Set<string>(TOOL_TYPES)
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith('tool-type-vocabulary.test.ts')) continue
      for (const values of toolTypeArrays(readFileSync(file, 'utf8'))) {
        // Tell a VOCABULARY from a table of DATA. Both contain tool types:
        // packages/db/src/seed-tools.ts is an array of whole tool records, so
        // it carries programs, roles and functions in the same brackets and
        // every one of them would read as a stray type here.
        //
        // A vocabulary is nearly all tool types. A data table is nearly not.
        const known = values.filter((v) => valid.has(v))
        if (known.length < 2) continue
        if (known.length / values.length < 0.6) continue

        for (const value of values) {
          // A near-miss: enum-like, sitting in a list of tool types, and not
          // one. That is either a typo or a value the schema retired.
          if (!valid.has(value) && !ENUM_ALLOWED.has(value)) {
            offenders.push(`${file.slice(REPO.length + 1)} lists "${value}"`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('has actually retired offseason_event', () => {
    // The specific value this guard was written for. An off-season competition
    // belongs in event_listings, with its date, venue, cost and registration
    // state. A tool row about one has none of those.
    expect(TOOL_TYPES as readonly string[]).not.toContain('offseason_event')
  })
})

/**
 * Enum-like strings that legitimately sit beside tool types in the same array.
 * Kept explicit so the guard stays noisy rather than being widened by a regex.
 */
const ENUM_ALLOWED = new Set<string>([])
