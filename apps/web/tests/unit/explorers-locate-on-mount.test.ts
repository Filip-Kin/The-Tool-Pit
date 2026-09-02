/**
 * Guard: both map verticals ask where the visitor is, and sort by it.
 *
 * The practice field map did this from the start. The events explorer had the
 * whole apparatus, a locate() function, a distance sort, a map that zooms to
 * the visitor, and never called locate(), so it always opened on a national
 * view sorted by date. Almost nobody travels out of their region for an
 * off-season event, so a Michigan team scrolled past six states.
 *
 * That is the shape of the bug: not a missing feature, a feature that is built
 * and not switched on. A test that only checked "does it have a locate
 * function" would have passed throughout.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '../../../..')

const EXPLORERS = [
  { name: 'events', file: 'apps/web/components/events/events-explorer.tsx' },
  { name: 'practice fields', file: 'apps/web/components/fields/fields-explorer.tsx' },
]

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

/** The body of the mount effect: useEffect(..., []). */
function mountEffect(source: string): string {
  const at = source.indexOf('useEffect(')
  let best = ''
  let from = at
  while (from > -1) {
    const end = source.indexOf('}, [])', from)
    if (end === -1) break
    const block = source.slice(from, end)
    // The mount effect is the one whose dependency array is empty.
    if (block.split('useEffect(').length === 2) best = block
    from = source.indexOf('useEffect(', from + 1)
  }
  return best
}

describe('map explorers', () => {
  it('ask for the visitor location on mount', () => {
    const offenders = EXPLORERS.filter((e) => !mountEffect(read(e.file)).includes('locate()')).map(
      (e) => `${e.name}: defines locate() but never calls it on mount`,
    )
    expect(offenders).toEqual([])
  })

  it('sort by distance once they have one', () => {
    const offenders: string[] = []
    for (const explorer of EXPLORERS) {
      const source = read(explorer.file)
      if (!/userLoc/.test(source)) offenders.push(`${explorer.name}: no visitor location in the sort`)
      if (!/distanceKm/.test(source)) offenders.push(`${explorer.name}: never measures a distance`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps a past event below an upcoming one, even when it is nearer', () => {
    // Distance alone put an event that ran in July above one happening next
    // weekend. "Nearest" to somebody deciding where to go means nearest of the
    // ones they can still attend.
    const source = read(EXPLORERS[0].file)
    const sort = source.slice(source.indexOf('rows.sort('), source.indexOf('return rows'))
    const distanceBranch = sort.slice(sort.indexOf("sortBy === 'distance'"))
    expect(distanceBranch).toContain('eventTiming')
  })
})
