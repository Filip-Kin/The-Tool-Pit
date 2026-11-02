import { describe, it, expect } from 'bun:test'
import {
  isGenericName,
  parkingReason,
  fetchVerdict,
  strikeDecision,
  runFacts,
  pageHash,
  monthKey,
  previousMonthKey,
  type ToolRow,
} from '../src/jobs/tool-refresh-rules.js'
import { extractHtmlMetadata } from '../src/pipeline/extract.js'

describe('isGenericName', () => {
  it('rejects page-state and placeholder titles', () => {
    for (const t of ['Home', 'Login', 'Index', 'Welcome', 'React App', 'Vite + React + TS', 'Coming soon', '', ' ', 'X', '404', '404 Not Found', 'Error', 'Just a moment...', 'example.com', 'Chrome Web Store']) {
      expect(isGenericName(t), t).toBe(true)
    }
  })
  it('rejects hosting and parking titles', () => {
    for (const t of ['Domain for sale', 'example.com is for sale!', 'Site not found · GitHub Pages', 'Site Not Found', 'Account Suspended', 'This domain has expired', 'Buy this domain']) {
      expect(isGenericName(t), t).toBe(true)
    }
  })
  it('keeps real names, including one-word products and team-number names', () => {
    for (const t of ['Choreo', 'CADProps', 'AdvantageScope', 'Statbotics', '254 Scouting', 'The Blue Alliance', 'FRC Gear Calculator']) {
      expect(isGenericName(t), t).toBe(false)
    }
  })
})

describe('parkingReason', () => {
  it('flags a parking title on its own', () => {
    expect(parkingReason({ title: 'mytool.dev - Domain for sale' })).toBe('domain for sale')
    expect(parkingReason({ title: 'Account Suspended' })).toBe('account suspended')
  })
  it('flags a thin parking body and a parking redirect', () => {
    expect(parkingReason({ title: 'mytool.dev', text: 'This domain may be for sale. Inquire about this domain.' })).toBe('domain for sale')
    expect(parkingReason({ title: 'x', text: 'anything', finalUrl: 'https://www.hugedomains.com/domain_profile.cfm?d=mytool' })).toBe('parked domain')
  })
  it('ignores the same words on a long real page', () => {
    const text = `${'Swerve drive calculator for FRC teams. '.repeat(60)} Make an offer on our domain name, it is for sale.`
    expect(parkingReason({ title: 'Swerve Calculator', text })).toBeNull()
  })
})

describe('fetchVerdict', () => {
  it('404, 410 and DNS failure are dead', () => {
    expect(fetchVerdict({ status: 404 }).kind).toBe('dead')
    expect(fetchVerdict({ status: 410 }).kind).toBe('dead')
    expect(fetchVerdict({ dnsFailed: true, error: 'fetch failed' }).kind).toBe('dead')
  })
  it('a wall that survived the relay is alive, not dead', () => {
    for (const status of [401, 403, 429, 503]) expect(fetchVerdict({ status }).kind).toBe('wall')
    expect(fetchVerdict({ status: 200, refusal: 'bot challenge', title: 'Just a moment...' }).kind).toBe('wall')
  })
  it('a timeout or a 500 is no evidence', () => {
    expect(fetchVerdict({ error: 'timeout' }).kind).toBe('unknown')
    expect(fetchVerdict({ status: 500 }).kind).toBe('unknown')
  })
  it('a 200 parking page is dead; a real page is ok', () => {
    expect(fetchVerdict({ status: 200, title: 'Domain for sale' })).toEqual({ kind: 'dead', reason: 'domain for sale' })
    expect(fetchVerdict({ status: 200, title: 'Choreo', text: 'Trajectory optimizer' })).toEqual({ kind: 'ok' })
  })
})

describe('strikeDecision (two consecutive monthly runs)', () => {
  it('months roll over the year', () => {
    expect(monthKey(new Date('2026-10-01T07:00:00Z'))).toBe('2026-10')
    expect(previousMonthKey('2027-01')).toBe('2026-12')
  })
  it('first failure only records a strike', () => {
    expect(strikeDecision(null, '2026-10', 'HTTP 404')).toEqual({ action: 'strike', strike: { month: '2026-10', reason: 'HTTP 404' } })
  })
  it('a failure the month after a strike suppresses', () => {
    expect(strikeDecision({ month: '2026-10', reason: 'HTTP 404' }, '2026-11', 'DNS lookup failed').action).toBe('suppress')
    expect(strikeDecision({ month: '2026-12', reason: 'HTTP 404' }, '2027-01', 'HTTP 404').action).toBe('suppress')
  })
  it('a re-run in the same month does not suppress, and keeps the original strike', () => {
    const prev = { month: '2026-10', reason: 'HTTP 404' }
    expect(strikeDecision(prev, '2026-10', 'HTTP 410')).toEqual({ action: 'strike', strike: prev })
  })
  it('a strike two months old does not count', () => {
    expect(strikeDecision({ month: '2026-09', reason: 'HTTP 404' }, '2026-11', 'HTTP 404')).toEqual({ action: 'strike', strike: { month: '2026-11', reason: 'HTTP 404' } })
  })
})


describe('pageHash', () => {
  it('ignores whitespace, sees content', () => {
    expect(pageHash({ title: 'A', text: 'b  c' })).toBe(pageHash({ title: 'A ', text: 'b c\n' }))
    expect(pageHash({ title: 'A', text: 'b' })).not.toBe(pageHash({ title: 'A', text: 'c' }))
  })
})

describe('runFacts', () => {
  it('lists suppressions first, then changes as old → new, under the Discord field cap', () => {
    const facts = runFacts([
      { name: 'Calc', changes: [{ field: 'name', from: 'Calc', to: 'Calc Pro' }] },
      { name: 'Gone Tool', changes: [], suppressed: { reason: 'HTTP 404' } },
    ])
    expect(facts[0]).toEqual({ label: 'Gone Tool', value: 'Suppressed: site gone' })
    expect(facts[1]).toEqual({ label: 'Calc', value: 'Name: Calc → Calc Pro' })
    const many = runFacts(Array.from({ length: 40 }, (_, i) => ({ name: `T${i}`, changes: [{ field: 'name' as const, from: 'a', to: 'b' }] })))
    expect(many.length).toBe(24)
    expect(many[23]).toEqual({ label: 'More', value: '+17' })
  })
})

describe('extractHtmlMetadata (the intake extractor, without the fetch)', () => {
  it('reads the same title and description the crawler does', () => {
    const html = '<html><head><title>Multi-Format CAD Viewer &amp; Online Measurement Tools | CADProps</title><meta property="og:site_name" content="CADProps"><meta name="description" content="View CAD in the browser"></head><body><p>hi</p></body></html>'
    const meta = extractHtmlMetadata(html, 'https://www.cadprops.com/')
    expect(meta.title).toBe('CADProps')
    expect(meta.description).toBe('View CAD in the browser')
  })
})
