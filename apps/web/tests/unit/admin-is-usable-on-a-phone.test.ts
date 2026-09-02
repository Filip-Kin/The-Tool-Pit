/**
 * Guard: nothing in the admin hides itself off the right edge of a phone.
 *
 * Two shapes caused this, and both were reported from an actual phone rather
 * than found by looking.
 *
 * A row of tabs that neither wraps nor scrolls: at 390px the last two statuses
 * sat past the edge with nothing on screen to say they existed, and a queue you
 * cannot see is a queue nobody works.
 *
 * A table with no scrolling wrapper: 16 of the 19 admin tables either squashed
 * their columns to nothing or pushed the whole page sideways.
 *
 * A table is allowed to scroll, because a dense table genuinely does not fit.
 * Tabs are not: six short words wrap onto two lines.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '../../../..')
const ADMIN = join(REPO, 'apps/web/app/admin')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** The opening tag of the element that encloses `at`, walking backwards. */
function enclosingTags(source: string, at: number, within = 600): string {
  return source.slice(Math.max(0, at - within), at)
}

describe('the admin on a phone', () => {
  const files = sourceFiles(ADMIN)

  it('finds the screens', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('wraps every row of tabs rather than cutting it off', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // A tab strip is a flex row of LINKS under a bottom border, spaced with a
      // small gap. The first version of this matched any flex row with a
      // border and reported six card headers and a badge, which is how a guard
      // becomes something people switch off.
      for (const m of source.matchAll(/className="([^"]*)"/g)) {
        const classes = m[1].split(/\s+/)
        const isRow = classes.includes('flex') && !classes.includes('flex-col')
        const isStrip = isRow && classes.some((c) => c === 'gap-1' || c === 'gap-x-1')
        const underline = classes.includes('border-b') && classes.includes('border-border-subtle')
        // A header row lays its two ends out; a tab strip does not.
        const isHeader = classes.includes('justify-between') || classes.includes('items-center')
        if (!isStrip || !underline || isHeader) continue
        if (classes.includes('flex-wrap') || classes.includes('overflow-x-auto')) continue
        offenders.push(`${file.slice(REPO.length + 1)}: "${m[1]}" neither wraps nor scrolls`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('lets every table scroll sideways', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/<table\b/g)) {
        if (!enclosingTags(source, m.index!).includes('overflow-x-auto')) {
          offenders.push(`${file.slice(REPO.length + 1)}: a table with no scrolling wrapper`)
          break
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not pad a phone screen like a desktop', () => {
    // p-8 is 32px each side, which on a 390px screen spends a sixth of the
    // width on nothing.
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/className="([^"]*)"/g)) {
        const classes = m[1].split(/\s+/)
        if (classes.includes('p-8') && !classes.some((c) => c.startsWith('md:p-') || c.startsWith('sm:p-'))) {
          offenders.push(`${file.slice(REPO.length + 1)}: p-8 at every width`)
          break
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
