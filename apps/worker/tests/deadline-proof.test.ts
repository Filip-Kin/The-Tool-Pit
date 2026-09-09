import { describe, expect, it } from 'vitest'
import { findDeadlineProof } from '../src/grants/deadline-proof.js'

const TODAY = '2026-09-08'

describe('findDeadlineProof', () => {
  it('finds a dated deadline with its sentence', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'Some intro. Completed applications are due to the VDOE Office of STEM on or before 5 p.m. on September 18, 2026. Thanks.' }], TODAY)
    expect(r.kind).toBe('dated')
    expect(r.date).toBe('2026-09-18')
    expect(r.quote).toContain('September 18, 2026')
  })
  it('reports a past date as a past cycle, not a deadline', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'All applications were due by February 9, 2026, at 12 PM. FY27 application timeline is expected to be posted by mid-September.' }], TODAY)
    expect(r.kind).toBe('not_public')
    expect(r.quote).toContain('expected to be posted')
    expect(r.past?.date).toBe('2026-02-09')
  })
  it('recognises the not-yet-announced phrasings', () => {
    for (const t of [
      'Applications for the 2026-2027 academic year will open in early October 2026.',
      'Next application cycle expected to open August 1, 2027.',
      'The 2026 application dates have not been announced.',
      'Application deadline: TBD.',
    ]) expect(findDeadlineProof([{ url: 'u', text: t }], TODAY).kind, t).toBe('not_public')
  })
  it('recognises rolling', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'There are no deadlines for submitting letters of inquiry or grant applications.' }], TODAY)
    expect(r.kind).toBe('rolling')
  })
  it('says none when the pages are silent', () => {
    const r = findDeadlineProof([{ url: 'a', text: 'We love robots and teachers.' }, { url: 'b', text: 'Contact us for details.' }], TODAY)
    expect(r.kind).toBe('none')
    expect(r.urlsRead).toEqual(['a', 'b'])
  })
})
