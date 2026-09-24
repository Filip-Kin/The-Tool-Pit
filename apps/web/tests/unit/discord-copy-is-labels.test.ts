import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The approvals channel is a moderator's inbox. Every string we write into it
 * is a label: a title, a field name, a short value. No sentence explaining the
 * process ("Nothing is public until it is approved"), no narration ("we
 * emailed the organiser"), no "you". Filip raised this three times; this test
 * runs in the web Docker build, so a push that brings a sentence back does not
 * deploy.
 *
 * It reads the source of every sendApprovalNotice call site and the embed
 * builder, and checks the literals WE author. Values that come from a
 * submission (a person's note) are expressions, not literals, so they are not
 * judged here.
 */

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === 'tests') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const files = [...walk(join(ROOT, 'apps/web')), ...walk(join(ROOT, 'apps/worker/src')), ...walk(join(ROOT, 'packages/types/src/discord'))]
  .filter((f) => /sendApprovalNotice\(|buildApprovalEmbed|decideApprovalEmbed/.test(readFileSync(f, 'utf8')))

/** Every sendApprovalNotice({...}) argument, plus the builder file whole. */
function noticeBlocks(file: string): string[] {
  // Comments explain the code to a developer; only what reaches Discord is judged.
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  if (file.includes('packages/types/src/discord')) return [src]
  const out: string[] = []
  let i = src.indexOf('sendApprovalNotice(')
  while (i >= 0) {
    let depth = 0
    let j = src.indexOf('(', i)
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')' && --depth === 0) break
    }
    out.push(src.slice(i, j + 1))
    i = src.indexOf('sendApprovalNotice(', j)
  }
  return out
}

const BANNED = [
  /nothing is public/i,
  /until (it|this) is approved/i,
  /\bwe (sent|emailed|read|found|list)\b/i,
  /\bwaiting in the\b/i,
  /\byou\b/i,
  /\bwhat (they|it|changed)\b/i,
  /\bplease\b/i,
  /\bopen the review\b/i,
]

describe('approval notices are labels, not sentences', () => {
  it('finds the call sites', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1)
    it(rel, () => {
      for (const block of noticeBlocks(file)) {
        for (const re of BANNED) expect(block, `${rel}: ${re}`).not.toMatch(re)
        // A description we write ourselves is a sentence by construction.
        if (!rel.startsWith('packages/')) {
          expect(block, `${rel}: authored description`).not.toMatch(/description:\s*[`'"]/)
        }
        // Field names: one to three words, no sentence punctuation.
        for (const m of block.matchAll(/label:\s*'([^']*)'/g)) {
          const label = m[1]
          if (!label) continue
          expect(label.split(/\s+/).length, `${rel}: label "${label}"`).toBeLessThanOrEqual(3)
          expect(label, `${rel}: label "${label}"`).not.toMatch(/[.!?:]$/)
        }
        // Literal values: short, and not a sentence.
        for (const m of block.matchAll(/value:\s*'([^']*)'/g)) {
          const value = m[1]
          expect(value.split(/\s+/).length, `${rel}: value "${value}"`).toBeLessThanOrEqual(5)
          expect(value, `${rel}: value "${value}"`).not.toMatch(/[.!?]$/)
        }
      }
    })
  }
})
