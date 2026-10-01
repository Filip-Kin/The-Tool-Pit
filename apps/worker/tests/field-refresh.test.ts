import { describe, it, expect } from 'bun:test'
import {
  planFieldRefresh,
  personSetKeys,
  changeFacts,
  sameFieldValue,
  sourcesHash,
  REFRESH_LABELS,
} from '../src/listings/field-refresh.js'

// A published field as it sits in practice_fields, trimmed to the columns that matter.
const lockwood = {
  status: 'published',
  name: 'Lockwood STEM Center',
  teamNumber: 5712,
  teamName: "Hemlock's Gray Matter",
  address: '700 N Pine St',
  city: 'Hemlock',
  region: 'MI',
  hours: 'Mon-Sat during build season',
  availability: 'year_round',
  ceilingHeightFt: null,
  contactInfo: 'Email trombley@hemlockps.com',
  contactUrl: null,
  website: 'https://lockwoodstemcenter.hemlockps.com',
}

const page = {
  source: 'https://lockwoodstemcenter.hemlockps.com',
  text:
    'Lockwood STEM Center\n700 N Pine St, Hemlock MI\n' +
    'The practice field is open Monday to Thursday, 6 to 9 pm, from January through April.\n' +
    'Ceiling height is 24 feet.\n' +
    'Book a slot: https://forms.gle/AbC123xyz',
}

describe('planFieldRefresh', () => {
  it('applies a changed hours value when its quote is on the page', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { hours: 'Monday to Thursday, 6 to 9 pm, from January through April', city: 'Hemlock' },
      evidence: {
        hours: { quote: 'open Monday to Thursday, 6 to 9 pm, from January through April', source: page.source },
        city: { quote: '700 N Pine St, Hemlock MI', source: page.source },
      },
      sources: [page],
    })
    expect(plan.skipped).toBeNull()
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({
      key: 'hours',
      from: 'Mon-Sat during build season',
      to: 'Monday to Thursday, 6 to 9 pm, from January through April',
      source: page.source,
    })
    expect(plan.refused).toEqual([])
  })

  it('fills an empty column and adds a sign-up link the page carries', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { ceilingHeightFt: 24, contactUrl: 'https://forms.gle/AbC123xyz' },
      evidence: {
        ceilingHeightFt: { quote: 'Ceiling height is 24 feet', source: page.source },
        contactUrl: { quote: 'https://forms.gle/AbC123xyz', source: page.source },
      },
      sources: [page],
    })
    expect(plan.changes.map((c) => c.key).sort()).toEqual(['ceilingHeightFt', 'contactUrl'])
  })

  it('skips a claimed field entirely', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: true,
      read: { hours: 'Monday to Thursday, 6 to 9 pm, from January through April' },
      evidence: { hours: { quote: 'open Monday to Thursday, 6 to 9 pm', source: page.source } },
      sources: [page],
    })
    expect(plan.skipped).toBe('claimed')
    expect(plan.changes).toEqual([])
  })

  it('skips a field that is not published', () => {
    const plan = planFieldRefresh({ current: { ...lockwood, status: 'pending' }, claimed: false, read: {}, evidence: {}, sources: [page] })
    expect(plan.skipped).toBe('not-published')
  })

  it('does not apply a value whose quote is not in the fetched text', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { hours: 'Weekends only' },
      evidence: { hours: { quote: 'the field is open on weekends only', source: page.source } },
      sources: [page],
    })
    expect(plan.changes).toEqual([])
    expect(plan.refused).toEqual(['hours: quote not in the fetched text'])
  })

  it('does not apply a sign-up link the page does not carry', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { contactUrl: 'https://forms.gle/SomethingElse' },
      evidence: { contactUrl: { quote: 'https://forms.gle/SomethingElse', source: page.source } },
      sources: [page],
    })
    expect(plan.changes).toEqual([])
  })

  it('never clears a value, and treats unknown availability as empty', () => {
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { hours: '', availability: 'unknown' },
      evidence: {
        hours: { quote: 'Lockwood STEM Center', source: page.source },
        availability: { quote: 'Lockwood STEM Center', source: page.source },
      },
      sources: [page],
    })
    expect(plan.changes).toEqual([])
    expect(plan.refused).toEqual(['hours: would clear the stored value', 'availability: would clear the stored value'])
  })

  it('leaves a value set through an applied community edit alone', () => {
    const personSet = personSetKeys(lockwood, [{ hours: 'Mon-Sat during build season', city: 'Hemlock' }])
    const plan = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { hours: 'Monday to Thursday, 6 to 9 pm, from January through April' },
      evidence: { hours: { quote: 'open Monday to Thursday, 6 to 9 pm', source: page.source } },
      sources: [page],
      personSet,
    })
    expect(plan.changes).toEqual([])
    expect(plan.refused).toEqual(['hours: set by a person'])
  })

  it('unpublishes a field whose page says it closed, only with the quote', () => {
    const closedPage = { source: page.source, text: 'Update: our practice field is no longer available to other teams.' }
    const proven = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { closed: true },
      evidence: { closed: { quote: 'our practice field is no longer available to other teams', source: page.source } },
      sources: [closedPage],
    })
    expect(proven.changes).toEqual([
      expect.objectContaining({ key: 'status', from: 'published', to: 'suppressed' }),
    ])

    const unproven = planFieldRefresh({
      current: lockwood,
      claimed: false,
      read: { closed: true },
      evidence: { closed: { quote: 'the field has closed for good', source: page.source } },
      sources: [closedPage],
    })
    expect(unproven.changes).toEqual([])
  })

  it('ignores a difference of case, spacing or URL form', () => {
    expect(sameFieldValue('hours', 'Mon-Sat  during build season', 'mon-sat during build season')).toBe(true)
    expect(sameFieldValue('website', 'https://www.example.org/', 'http://example.org')).toBe(true)
    expect(sameFieldValue('ceilingHeightFt', 24, 24.0)).toBe(true)
  })
})

describe('changeFacts', () => {
  it('writes one short label and an old → new value per column', () => {
    const facts = changeFacts([
      { key: 'hours', from: 'Mon-Sat during build season', to: 'Mon-Thu 6-9 pm', quote: '', source: '' },
      { key: 'ceilingHeightFt', from: null, to: 24, quote: '', source: '' },
    ])
    expect(facts).toEqual([
      { label: 'Hours', value: 'Mon-Sat during build season → Mon-Thu 6-9 pm' },
      { label: 'Ceiling', value: 'none → 24' },
    ])
  })

  it('keeps every label to three words', () => {
    for (const label of Object.values(REFRESH_LABELS)) expect(label.split(/\s+/).length).toBeLessThanOrEqual(3)
  })
})

describe('sourcesHash', () => {
  it('is stable across order and whitespace, and moves when the text does', () => {
    const a = { source: 'a', text: 'Open  Monday' }
    const b = { source: 'b', text: 'Ceiling 24 ft' }
    expect(sourcesHash([a, b])).toBe(sourcesHash([b, { source: 'a', text: 'Open Monday' }]))
    expect(sourcesHash([a, b])).not.toBe(sourcesHash([a, { source: 'b', text: 'Ceiling 30 ft' }]))
  })
})
