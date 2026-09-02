/**
 * Guard: the worker's connectors and the admin's idea of them are the same set.
 *
 * They were not. The worker's registry had eight. The admin trigger allowlist
 * had six. The Sources screen had six more, grouped under names that are not
 * connector names at all. A doc comment in the schema had a fourth list naming
 * `github`, `tba` and `official_first`, none of which has ever been written.
 *
 * The two missing everywhere but the worker were spectrum_cad (381 rows) and
 * github_team_code (290), the two LARGEST sources in the catalogue. Neither had
 * a button, and triggerCrawl answered "Unknown connector" for both, while a
 * comment in the worker said github_team_code is triggered by hand from that
 * exact screen.
 *
 * The key is also the value stored in tool_sources.source_type, so a screen
 * that groups by anything else counts nothing. That is checked too.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CRAWL_CONNECTORS, CRAWL_CONNECTOR_KEYS } from '@the-tool-pit/db/crawl-connectors'

const REPO = join(import.meta.dir, '../../../..')

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

/** The keys of the worker's own registry, read out of its object literal. */
function registryKeys(): string[] {
  const source = read('apps/worker/src/jobs/crawl.ts')
  const start = source.indexOf('const CONNECTOR_REGISTRY')
  expect(start).toBeGreaterThan(-1)

  // The opening brace of the VALUE, not of the type annotation. The registry is
  // declared `Record<string, () => { run(): ... }>`, so the first '=' after the
  // name belongs to the arrow inside that type and the first '{' after it opens
  // the return type. Reading from there returns nothing at all, silently, which
  // is how this guard first passed while finding no keys.
  const assignment = source.slice(start).match(/=\s*\{\s*\n/)
  expect(assignment).not.toBeNull()
  const open = start + assignment!.index! + assignment![0].indexOf('{')
  let depth = 0
  let close = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  const body = source.slice(open, close + 1)
  // `key: () => new XConnector(),` at the top level of the object.
  return [...body.matchAll(/(?:^|\n)\s{2}(\w+):\s*\(\)/g)].map((m) => m[1])
}

describe('crawl connector names', () => {
  it('match the worker registry exactly', () => {
    expect(registryKeys().sort()).toEqual([...CRAWL_CONNECTOR_KEYS].sort())
  })

  it('are not retyped in the admin', () => {
    const offenders: string[] = []
    for (const file of ['apps/web/app/admin/crawls/actions.ts', 'apps/web/app/admin/sources/page.tsx']) {
      const source = read(file)
      if (!/CRAWL_CONNECTOR/.test(source)) offenders.push(`${file} does not read the shared list`)
      // A local array of connector names is the shape of the old bug.
      for (const key of CRAWL_CONNECTOR_KEYS) {
        if (source.includes(`'${key}'`)) offenders.push(`${file} names '${key}' by hand`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('include the two that had no button', () => {
    expect(CRAWL_CONNECTOR_KEYS).toContain('spectrum_cad')
    expect(CRAWL_CONNECTOR_KEYS).toContain('github_team_code')
  })

  it('carry a label and a real description each', () => {
    for (const connector of CRAWL_CONNECTORS) {
      expect(connector.label.length).toBeGreaterThan(2)
      expect(connector.description.length).toBeGreaterThan(15)
    }
  })
})
