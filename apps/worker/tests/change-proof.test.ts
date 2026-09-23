import { describe, expect, it } from 'vitest'
import { proveChange, reasoningWithProof } from '../src/grants/change-proof.js'

const NOW = new Date('2026-09-23T12:00:00Z')
const page = (pageText: string, extra: Record<string, unknown> = {}) => ({ pageText, now: NOW, ...extra })

describe('proveChange: allowlist and guards', () => {
  const text = 'Grant name here. Applications are due March 1, 2027. Grants of up to $5,000 per team.'

  it('never auto-applies prose, links, programs or geography', () => {
    for (const field of ['name', 'summary', 'description', 'eligibilityText', 'applicationUrl', 'infoUrl', 'programs', 'countries', 'regions', 'geoScope', 'cycle.2027.sourceUrl', 'cycle.2027']) {
      const v = proveChange({ field, oldValue: 'a', newValue: 'Applications are due March 1, 2027.' }, page(text))
      expect(v.proven, field).toBe(false)
    }
  })

  it('never clears a value', () => {
    expect(proveChange({ field: 'awardMax', oldValue: 5000, newValue: null }, page(text)).proven).toBe(false)
    expect(proveChange({ field: 'cycle.2027.deadlineNote', oldValue: 'x', newValue: '  ' }, page(text)).proven).toBe(false)
  })

  it('refuses a deadline pulled more than 60 days earlier', () => {
    const v = proveChange({ field: 'cycle.2027.deadlineAt', oldValue: '2027-06-01T00:00:00.000Z', newValue: '2027-03-01' }, page(text))
    expect(v).toEqual({ proven: false, reason: 'deadline moves more than 60 days earlier' })
    // 30 days earlier is fine, and later by any amount is fine.
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: '2027-03-31T00:00:00.000Z', newValue: '2027-03-01' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: '2026-09-01T00:00:00.000Z', newValue: '2027-03-01' }, page(text)).proven).toBe(true)
  })

  it('refuses an award that moves more than 5x', () => {
    expect(proveChange({ field: 'awardMax', oldValue: 500, newValue: 5000 }, page(text)).proven).toBe(false)
    expect(proveChange({ field: 'awardMax', oldValue: 1000, newValue: 5000 }, page(text)).proven).toBe(true)
  })

  it('refuses an archive copy', () => {
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 5000 }, page(text, { pageUrl: 'https://web.archive.org/web/2025id_/https://x.org' })).proven).toBe(false)
  })

  it('refuses a deadline filed against another cycle year', () => {
    expect(proveChange({ field: 'cycle.2026.deadlineAt', oldValue: null, newValue: '2027-03-01' }, page(text)).proven).toBe(false)
  })
})

describe('proveChange: dates', () => {
  it('proves a deadline from the funder sentence and quotes it', () => {
    const v = proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-03-01T00:00:00.000Z' }, page('Intro text. Applications are due March 1, 2027. Thanks.'))
    expect(v.proven).toBe(true)
    if (v.proven) {
      expect(v.quote).toContain('due March 1, 2027')
      expect('Intro text. Applications are due March 1, 2027. Thanks.').toContain(v.quote)
    }
  })

  it('does not prove a date that is on the page as something else', () => {
    const text = 'Applications open January 5, 2027. The deadline is March 1, 2027.'
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-01-05' }, page(text)).proven).toBe(false)
    expect(proveChange({ field: 'cycle.2027.opensAt', oldValue: null, newValue: '2027-01-05' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.opensAt', oldValue: null, newValue: '2027-03-01' }, page(text)).proven).toBe(false)
  })

  it('does not prove a date the page does not state', () => {
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-03-02' }, page('Applications are due March 1, 2027.')).proven).toBe(false)
  })

  it('does not take a yearless date as proof', () => {
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-03-01' }, page('Applications are due March 1 each year.')).proven).toBe(false)
  })

  it('ignores a scholarship or report deadline', () => {
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-03-01' }, page('The scholarship deadline is March 1, 2027.')).proven).toBe(false)
  })

  it('proves both ends of a window', () => {
    const text = 'Application Period: 5/18/2027 - 6/29/2027. Apply online.'
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-06-29' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.opensAt', oldValue: null, newValue: '2027-05-18' }, page(text)).proven).toBe(true)
  })

  it('needs the stated time when the value carries one', () => {
    const text = 'Proposals must be submitted by 5:00 p.m. ET on January 15, 2027.'
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-01-15T17:00:00-05:00' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.deadlineAt', oldValue: null, newValue: '2027-01-15T23:59:00-05:00' }, page(text)).proven).toBe(false)
  })

  it('proves a decision date', () => {
    const text = 'Applications are due March 1, 2027. Applicants will be notified by May 15, 2027.'
    expect(proveChange({ field: 'cycle.2027.decisionAt', oldValue: null, newValue: '2027-05-15' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.decisionAt', oldValue: null, newValue: '2027-03-01' }, page(text)).proven).toBe(false)
  })
})

describe('proveChange: notes, status, amounts', () => {
  it('proves a note only when it is verbatim on the page', () => {
    const text = 'Deadline March 1, 2027. Applications close at 5:00 pm Eastern on the deadline day.'
    expect(proveChange({ field: 'cycle.2027.deadlineNote', oldValue: null, newValue: 'Applications close at 5:00 pm Eastern on the deadline day.' }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.deadlineNote', oldValue: null, newValue: 'Applications close at 5 pm ET.' }, page(text)).proven).toBe(false)
    expect(proveChange({ field: 'awardNotes', oldValue: null, newValue: 'Grants of up to $5,000 per team' }, page('We offer Grants of up to $5,000 per team.')).proven).toBe(true)
  })

  it('proves closed from the funder saying so', () => {
    expect(proveChange({ field: 'cycle.2026.status', oldValue: 'open', newValue: 'closed' }, page('The 2026 application period is now closed. Check back.')).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2026.status', oldValue: 'open', newValue: 'closed' }, page('Our office is closed on Mondays.')).proven).toBe(false)
  })

  it('proves a derived status only from proven dates', () => {
    const text = 'Applications open January 5, 2027. The deadline is March 1, 2027.'
    const extracted = { deadlineAt: '2027-03-01', opensAt: '2027-01-05' }
    expect(proveChange({ field: 'cycle.2027.status', oldValue: 'unknown', newValue: 'upcoming' }, page(text, { extracted })).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.status', oldValue: 'unknown', newValue: 'open' }, page(text, { extracted })).proven).toBe(false)
    expect(proveChange({ field: 'cycle.2027.status', oldValue: 'unknown', newValue: 'open' }, page(text, { extracted: { deadlineAt: '2027-03-01', opensAt: '2026-09-01' } })).proven).toBe(false)
    expect(proveChange({ field: 'cycle.2027.status', oldValue: 'unknown', newValue: 'open' }, page('The deadline is March 1, 2027.', { extracted: { deadlineAt: '2027-03-01' } })).proven).toBe(true)
    expect(proveChange({ field: 'cycle.2027.status', oldValue: 'open', newValue: 'unknown' }, page(text, { extracted })).proven).toBe(false)
  })

  it('reads the ends of a range the right way round', () => {
    const text = 'Grants range from $1,000 to $5,000 per team.'
    expect(proveChange({ field: 'awardMin', oldValue: null, newValue: 1000 }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 5000 }, page(text)).proven).toBe(true)
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 1000 }, page(text)).proven).toBe(false)
    expect(proveChange({ field: 'awardMin', oldValue: null, newValue: 5000 }, page(text)).proven).toBe(false)
  })

  it('does not take "up to" as a minimum, a total as an award, or k-units wrongly', () => {
    expect(proveChange({ field: 'awardMin', oldValue: null, newValue: 5000 }, page('Teams may request up to $5,000.')).proven).toBe(false)
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 5000 }, page('Teams may request up to $5,000.')).proven).toBe(true)
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 2000000 }, page('We have awarded $2 million in grants since 2010.')).proven).toBe(false)
    expect(proveChange({ field: 'awardMax', oldValue: null, newValue: 10000 }, page('Awards of up to $10k are available.')).proven).toBe(true)
  })

  it('proves a currency by its code or mark', () => {
    expect(proveChange({ field: 'awardCurrency', oldValue: 'USD', newValue: 'CAD' }, page('Grants up to C$5,000.')).proven).toBe(true)
    expect(proveChange({ field: 'awardCurrency', oldValue: 'USD', newValue: 'AUD' }, page('Grants up to CA$5,000.')).proven).toBe(false)
  })

  it('puts the quote first in the stored reasoning', () => {
    expect(reasoningWithProof('ai extraction (confidence 0.90): read the deadline', 'due March 1, 2027')).toBe(
      'Proof on the funder\'s page: "due March 1, 2027"\nai extraction (confidence 0.90): read the deadline',
    )
  })
})
