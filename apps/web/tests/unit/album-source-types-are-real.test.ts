/**
 * Guard: an album's source type is a source type, not a provider.
 *
 * ALBUM_PROVIDERS answers who hosts the photos. ALBUM_SOURCE_TYPES answers how
 * we found them. They share six values, so a publish path that fell back to the
 * provider whenever it had no mapping for the connector looked right almost
 * always, and occasionally wrote something no tuple contains. Production held
 * one album with source_type 'google_drive' with 30 more candidates queued
 * behind it, plus a dropbox and four 'other'.
 *
 * Two rules. Every album connector maps to a real source type, and the fallback
 * cannot write a value outside the tuple.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALBUM_SOURCE_TYPES, ALBUM_PROVIDERS } from '@the-tool-pit/db'

const REPO = join(import.meta.dir, '../../../..')

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

/**
 * The code with its comments taken out.
 *
 * A doc comment that quotes the old broken line is not the old broken line, and
 * checking the raw text made this guard fail on the very comment explaining the
 * fix.
 */
function code(file: string): string {
  return read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Keys of an object literal declared with `const NAME... = {`. */
function objectKeys(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`)
  if (start === -1) return []
  const assignment = source.slice(start).match(/=\s*\{\s*\n/)
  if (!assignment) return []
  const open = start + assignment.index! + assignment[0].indexOf('{')
  let depth = 0
  let close = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) { close = i; break }
    }
  }
  const body = source.slice(open, close + 1)
  return [...body.matchAll(/(?:^|\n)\s{2}(\w+)\s*:/g)].map((m) => m[1])
}

describe('album source types', () => {
  it('cover every album connector the worker runs', () => {
    const registry = objectKeys(read('apps/worker/src/jobs/album-ingest.ts'), 'ALBUM_CONNECTOR_REGISTRY')
    expect(registry.length).toBeGreaterThan(3)

    const mapped = objectKeys(read('apps/web/lib/admin/publish-album.ts'), 'CONNECTOR_SOURCE_TYPE')
    const missing = registry.filter((c) => !mapped.includes(c))
    expect(missing).toEqual([])
  })

  it('map only to values in the tuple', () => {
    const source = read('apps/web/lib/admin/publish-album.ts')
    const start = source.indexOf('const CONNECTOR_SOURCE_TYPE')
    const body = source.slice(start, source.indexOf('}', start))
    const valid = new Set<string>(ALBUM_SOURCE_TYPES)
    const offenders = [...body.matchAll(/:\s*'([^']+)'/g)]
      .map((m) => m[1])
      .filter((v) => !valid.has(v))
    expect(offenders).toEqual([])
  })

  it('never take a provider that is not also a source type', () => {
    // The specific hole. `candidate.provider || 'manual'` with no check is how
    // google_drive got onto a published album.
    const source = code('apps/web/lib/admin/publish-album.ts')
    expect(source).not.toContain("candidate.provider || 'manual'")
    expect(source).toContain('sourceTypeFromProvider')
  })

  it('still overlap the providers, which is why this was easy to miss', () => {
    const shared = ALBUM_PROVIDERS.filter((p) => (ALBUM_SOURCE_TYPES as readonly string[]).includes(p))
    expect(shared.length).toBeGreaterThanOrEqual(6)
    // And these are providers only. Writing one into source_type is the bug.
    for (const providerOnly of ['google_drive', 'dropbox', 'other']) {
      expect(ALBUM_SOURCE_TYPES as readonly string[]).not.toContain(providerOnly)
    }
  })
})
