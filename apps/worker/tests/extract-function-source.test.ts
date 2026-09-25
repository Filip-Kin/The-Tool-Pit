import { describe, it, expect } from 'bun:test'
import { extractFunctionSource } from '../src/listings/team-list-parser.js'

describe('extractFunctionSource', () => {
  it('finds the end of a function whose regex literals and comments hold quotes', () => {
    const fn = `function extractTeams() {
  // read each team's line
  const out = []
  for (const line of document.body.innerText.split('\\n')) {
    const m = line.match(/(?:Team\\s+)?(\\d{1,5})\\b(.*)/)
    const nm = line.match(/"([^"]+)"/)
    const t = line.replace(/<br\\s*\\/?>/gi, '}')
    if (m) out.push({ number: +m[1], robot: null, name: nm ? nm[1] : undefined })
  }
  return out
}`
    const reply = `Here it is:\n\n${fn}\n\nHow it works: it reads { each } line.`
    expect(extractFunctionSource(reply)).toBe(fn)
  })
  it('returns null for a reply cut off before the function closes', () => {
    expect(extractFunctionSource('function extractTeams() {\n  const out = [];\n  for (const x of y) {')).toBeNull()
  })
})

import { parserIsStale } from '../src/listings/roster-refresh.js'
describe('parserIsStale', () => {
  it('re-proves a parser older than three days, or one with no date', () => {
    const now = new Date('2026-09-25T00:00:00Z')
    expect(parserIsStale(new Date('2026-09-24T00:00:00Z'), now)).toBe(false)
    expect(parserIsStale(new Date('2026-09-20T00:00:00Z'), now)).toBe(true)
    expect(parserIsStale(null, now)).toBe(true)
  })
})
