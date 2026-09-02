/**
 * Guard: accepting a candidate publishes it.
 *
 * A moderator who opens a candidate, reads the quotes behind every value,
 * corrects what is wrong and presses Accept HAS reviewed it. Writing a pending
 * row at that point asks them to review the same thing again on another screen,
 * and the pending queue is for what the public submitted and nobody has looked
 * at yet.
 *
 * Tools, albums and grants already worked this way. Events and practice fields
 * did not, which is the inconsistency this pins shut.
 *
 * The publish BAR still applies, and that is the other half: a candidate that
 * does not clear it is saved as pending with the missing field named. So the
 * check is not "never writes pending", it is "publishes when it can, and says
 * why when it cannot".
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '../../../..')

/** The accept action of each vertical, and the function it accepts through. */
const ACCEPTS = [
  {
    vertical: 'events',
    file: 'apps/web/app/admin/event-listings/candidates/actions.ts',
    fn: 'acceptEventCandidate',
    bar: 'eventPublishBlockers',
  },
  {
    vertical: 'practice fields',
    file: 'apps/web/app/admin/practice-fields/candidates/actions.ts',
    fn: 'acceptFieldCandidate',
    bar: 'fieldPublishBlockers',
  },
  {
    vertical: 'tools',
    file: 'apps/web/lib/admin/publish-candidate.ts',
    fn: 'adminPublishCandidate',
    bar: null,
  },
  {
    vertical: 'albums',
    file: 'apps/web/lib/admin/publish-album.ts',
    fn: 'adminPublishAlbum',
    bar: null,
  },
]

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

/**
 * The body of a named exported function.
 *
 * The parameter list is paren-matched and the body brace is found by skipping
 * the return type, which is the part a naive scan gets wrong: these functions
 * return `Promise<{ error?: string }>`, so "the first { after the signature" is
 * the return type's object and the body is never read at all. That made this
 * guard report all four verticals as broken while all four were fine.
 */
function body(source: string, name: string): string {
  const at = source.indexOf(`export async function ${name}(`)
  expect(at).toBeGreaterThan(-1)

  // Close the parameter list.
  let i = source.indexOf('(', at)
  let depth = 0
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }

  // Skip the return type. Its braces sit inside angle brackets; the body's
  // brace is the first one at angle-depth zero.
  let angle = 0
  let open = -1
  for (i++; i < source.length; i++) {
    const ch = source[i]
    if (ch === '<') angle++
    else if (ch === '>') angle--
    else if (ch === '{' && angle === 0) {
      open = i
      break
    }
  }
  expect(open).toBeGreaterThan(-1)

  depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(open, j + 1)
    }
  }
  throw new Error(`could not read ${name}`)
}

describe('accepting a candidate', () => {
  it('publishes it, in every vertical', () => {
    const offenders: string[] = []
    for (const accept of ACCEPTS) {
      const source = body(read(accept.file), accept.fn)
      if (!source.includes("status: 'published'")) {
        offenders.push(`${accept.vertical}: ${accept.fn} never writes a published row`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('checks the publish bar where the vertical has one', () => {
    // Events and fields both have a bar, because both put a pin on a map and a
    // row with no pin cannot go there. Tools and albums have no equivalent.
    const offenders = ACCEPTS.filter((a) => a.bar && !read(a.file).includes(a.bar)).map(
      (a) => `${a.vertical}: accept does not consult ${a.bar}`,
    )
    expect(offenders).toEqual([])
  })

  it('takes the reviewer edits, not just a name', () => {
    // The other half of the change. Accepting used to take a name string, so
    // every other correction meant finding the listing afterwards on another
    // screen, which on a phone is why nobody did it.
    for (const accept of ACCEPTS.slice(0, 2)) {
      const source = read(accept.file)
      expect(source).toContain(`${accept.fn}(\n  candidateId: string,\n  values: Record<string, string>,\n)`)
    }
  })
})
