/**
 * Guard: one number decides whether two listings are the same.
 *
 * There were two. Ingest auto-skipped above 0.7, the admin duplicate panel
 * displayed above 0.85, so between them the crawler discarded candidates the
 * screen built to review duplicates would never show anyone. 252 of 309
 * published team-code listings sat in that band.
 *
 * Also checks the two things that made the false positives dangerous rather
 * than merely wrong: the pipeline query had no status filter, so suppressed
 * spam blocked real listings, and neither side compared the team or the season,
 * which is the only part of "1511 2023 Robot Code" that carries meaning.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DUPLICATE_NAME_SIMILARITY } from '@the-tool-pit/db'

const REPO = join(import.meta.dir, '../../../..')

const SITES = [
  {
    file: 'apps/worker/src/pipeline/deduplicate.ts',
    what: 'the ingest pipeline',
    // Drizzle, so the filter reads as a condition on the column.
    publishedOnly: /eq\(tools\.status, 'published'\)/,
  },
  {
    file: 'apps/web/app/admin/maintenance/actions.ts',
    what: 'the admin duplicate panel',
    // Raw SQL, so it reads as one predicate per side of the self-join.
    publishedOnly: /a\.status = 'published'[\s\S]{0,80}b\.status = 'published'/,
  },
]

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

describe('duplicate name similarity', () => {
  it('is a shared constant, not a literal at either site', () => {
    const offenders: string[] = []
    for (const site of SITES) {
      const source = read(site.file)
      // A bare decimal next to a similarity() call is the shape of the bug.
      const inline = source.match(/similarity\([^)]*\)\s*>\s*0\.\d+/g)
      if (inline) offenders.push(`${site.file} hardcodes ${inline.join(', ')}`)
      if (!source.includes('DUPLICATE_NAME_SIMILARITY')) {
        offenders.push(`${site.file} does not use DUPLICATE_NAME_SIMILARITY`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('compares only published rows at both sites', () => {
    // 22 published names were blocked by suppressed rows: spam rejected once
    // went on rejecting real listings from behind the curtain.
    const offenders = SITES.filter((site) => !site.publishedOnly.test(read(site.file))).map(
      (site) => `${site.what} does not restrict the comparison to published rows`,
    )
    expect(offenders).toEqual([])
  })

  it('lets a different team or season overrule the score at both sites', () => {
    const offenders: string[] = []
    // The worker calls the shared rule; the SQL in the panel spells the same
    // rule out in its join, because it compares whole tables to each other.
    if (!read(SITES[0].file).includes('definitelyDifferentListings')) {
      offenders.push('the ingest pipeline does not check team and season')
    }
    const panel = read(SITES[1].file)
    for (const column of ['team_number', 'season_year']) {
      if (!panel.includes(column)) offenders.push(`the admin panel does not compare ${column}`)
    }
    expect(offenders).toEqual([])
  })

  it('is set above the score that was eating seasons', () => {
    expect(DUPLICATE_NAME_SIMILARITY).toBeGreaterThan(0.826)
    // And below 1, or nothing is ever a duplicate and the panel goes quiet.
    expect(DUPLICATE_NAME_SIMILARITY).toBeLessThan(1)
  })
})
