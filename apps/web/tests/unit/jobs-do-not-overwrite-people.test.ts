/**
 * Guard: a background job may not quietly overwrite something a person typed.
 *
 * The platform rule. If a human set it, an automated pass leaves it alone. The
 * exception is a value the machine genuinely owns and the human does not: a
 * star count, a commit date, a registered team count. Those refresh freely.
 *
 * tools.human_edited_fields exists for this and was not enough on its own,
 * because a column only protects what somebody remembered to add to it.
 * apps/worker/src/jobs/enrich.ts suppressed a listing on re-classification and
 * replaced adminNotes with its own line, with no check at all. An admin who
 * un-suppressed a tool and wrote down why lost the decision and the reason, in
 * that order, so nothing was left to show it had happened. 215 tools carry a
 * hand-written note.
 *
 * So: every column a worker writes on `tools` is either claimable and guarded,
 * or named here as machine-owned with a reason.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HUMAN_EDITABLE_TOOL_KEYS } from '@the-tool-pit/db'

const REPO = join(import.meta.dir, '../../../..')
const WORKER = join(REPO, 'apps/worker/src')

/**
 * Columns the machine owns outright. A person cannot set these and would not
 * want to: they are measurements, not statements.
 */
const MACHINE_OWNED: Record<string, string> = {
  githubStars: 'a count fetched from GitHub; freezing it would be the bug, not the feature',
  chiefDelphiLikes: 'a count read off the forum thread',
  popularityScore: 'derived from the two counts above plus votes; see popularity-score.ts',
  confidenceScore: "the classifier's own certainty about its answer",
  freshnessState: 'computed from the last commit date',
  lastActivityAt: 'the last commit date itself',
  starsCheckedAt: 'when the star count was last read from GitHub',
  updatedAt: 'a row timestamp, written by every path that touches the row',
  publishedAt: 'when the row went public',
  humanEditedFields: 'the claim list itself',
  slug: 'derived from the name, and a URL that changes under a reader is worse than an ugly one',
}

/** Files that legitimately write a claimable column, because they check first. */
const GUARD_CALLS = ['isHumanEdited', 'withoutHumanEdits']

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.ts$/.test(entry)) out.push(full)
  }
  return out
}

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
 * Property names assigned in every object this file writes to the `tools` table.
 *
 * SCOPED TO THE TABLE, which the first version was not. Taking every `.set()`
 * in any file that also mentions `update(tools)` swept up writes to
 * crawl_candidates sitting a few lines away, and reported `rejectionReason` and
 * `classification` as tool columns somebody was trampling. Neither is a tool
 * column at all.
 *
 * So each `.update(x)` / `.insert(x)` is matched to the `.set(...)` or
 * `.values(...)` chained onto it, and only the ones where x is `tools` count.
 * A named object passed in is followed back to its declaration, because
 * publish.ts builds `crawlSet` and spreads it, and that is where the property
 * actually lives.
 */
function columnsWrittenToTools(source: string): Set<string> {
  const written = new Set<string>()
  const blocks: string[] = []
  const names = new Set<string>()

  for (const m of source.matchAll(/\.(?:update|insert)\(\s*(\w+)\s*\)/g)) {
    if (m[1] !== 'tools') continue

    // The payload is chained onto this call, so look forward from it only.
    const rest = source.slice(m.index! + m[0].length, m.index! + m[0].length + 4000)
    const payload = rest.match(/^\s*\.(?:set|values)\s*\(/)
    if (!payload) continue
    const after = m.index! + m[0].length + payload[0].length

    if (source[after] === '{') {
      const inline = objectAt(source, after)
      if (!inline) continue
      blocks.push(inline)
      for (const spread of inline.matchAll(/\.\.\.(?:\w+\()?(\w+)/g)) names.add(spread[1])
    } else {
      const ident = source.slice(after).match(/^\s*(\w+)\s*\)/)
      if (ident) names.add(ident[1])
    }
  }

  for (const name of names) {
    const declared = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\b[^=]*=\\s*\\{`))
    if (!declared) continue
    const body = objectAt(source, source.indexOf('{', declared.index! + declared[0].length - 1))
    if (body) blocks.push(body)
  }

  for (const block of blocks) {
    for (const m of block.matchAll(/(?:^|[{,\s])(\w+)\s*:/g)) written.add(m[1])
  }
  return written
}

describe('worker writes to tools', () => {
  const files = sourceFiles(WORKER)

  it('finds the jobs that write to tools at all', () => {
    const writers = files.filter((f) => columnsWrittenToTools(readFileSync(f, 'utf8')).size > 0)
    expect(writers.length).toBeGreaterThanOrEqual(2)
  })

  it('either owns the column or checks the claim first', () => {
    // DERIVED, not listed. Asking only "is this column already on the
    // claimable list" is how the original bug survived: status and adminNotes
    // were not on it, so a guard phrased that way skipped the very columns
    // being trampled. What a person can set is read off the admin editor,
    // which is the screen where they set it.
    const humanWritten = columnsWrittenToTools(
      readFileSync(join(REPO, 'apps/web/app/admin/tools/[id]/actions.ts'), 'utf8'),
    )
    expect(humanWritten.size).toBeGreaterThan(5)

    const claimable = new Set<string>(HUMAN_EDITABLE_TOOL_KEYS)
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const columns = columnsWrittenToTools(source)
      if (columns.size === 0) continue

      const guarded = GUARD_CALLS.some((call) => source.includes(call))
      for (const column of columns) {
        if (column in MACHINE_OWNED) continue
        if (!humanWritten.has(column)) continue // no screen sets it, so nobody typed it
        if (!claimable.has(column)) {
          offenders.push(
            `${file.slice(REPO.length + 1)} writes ${column}, which the admin editor also writes, but it is not claimable`,
          )
          continue
        }
        if (!guarded) {
          offenders.push(`${file.slice(REPO.length + 1)} writes ${column} without checking human_edited_fields`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps the machine-owned list pinned and explained', () => {
    // The easy way past the check above is to declare a column machine-owned.
    // Changing this count is a decision; drifting into it is not.
    expect(Object.keys(MACHINE_OWNED)).toHaveLength(Object.keys(MACHINE_OWNED).length)
    expect(Object.keys(MACHINE_OWNED).sort()).toEqual([
      'chiefDelphiLikes',
      'confidenceScore',
      'freshnessState',
      'githubStars',
      'humanEditedFields',
      'lastActivityAt',
      'popularityScore',
      'publishedAt',
      'slug',
      'starsCheckedAt',
      'updatedAt',
    ])
    for (const reason of Object.values(MACHINE_OWNED)) expect(reason.length).toBeGreaterThan(20)
  })

  it('treats a moderator verdict and their reason as claimable', () => {
    // The specific pair that was missing. Both are written by enrich.ts.
    expect(HUMAN_EDITABLE_TOOL_KEYS as readonly string[]).toContain('status')
    expect(HUMAN_EDITABLE_TOOL_KEYS as readonly string[]).toContain('adminNotes')
  })

  it('does not let a metric become claimable', () => {
    // The rule runs both ways. Freezing a star count because somebody opened
    // the editor would be a bug wearing the fix's clothes.
    for (const metric of ['githubStars', 'chiefDelphiLikes', 'popularityScore', 'confidenceScore']) {
      expect(HUMAN_EDITABLE_TOOL_KEYS as readonly string[]).not.toContain(metric)
    }
  })
})
