import { describe, it, expect } from 'bun:test'
import { judgeFormLink } from '../src/listings/form-link.js'
import { planEventRefresh } from '../src/listings/event-refresh-plan.js'

const u = 'https://docs.google.com/forms/d/e/abc/viewform'

describe('judgeFormLink', () => {
  it('calls a 404 gone', () => {
    expect(judgeFormLink(u, { html: '', how: 'gone', status: 404, finalUrl: u }).state).toBe('gone')
  })
  it("calls Google's Page Not Found gone", () => {
    const html = '<html><body><h1>Page Not Found</h1><p>Sorry, unable to open the file at this time.</p></body></html>'
    expect(judgeFormLink(u, { html, how: 'fetch', status: 200, finalUrl: u }).state).toBe('gone')
  })
  it('reads a closed form as closed and keeps its text', () => {
    const html = '<html><body><h1>Week Zero 2026 Team Registration</h1><p>Week Zero 2026 Team Registration is no longer accepting responses.</p></body></html>'
    const r = judgeFormLink(u, { html, how: 'fetch', status: 200, finalUrl: u.replace('viewform', 'closedform') })
    expect(r.state).toBe('closed')
    expect(r.text).toContain('Week Zero 2026')
  })
  it('reads an open form as open', () => {
    const html = '<html><body><h1>Team Registration</h1><p>Registration is $200 if paid by February 13. Team number *</p></body></html>'
    expect(judgeFormLink(u, { html, how: 'fetch', status: 200, finalUrl: u }).state).toBe('open')
  })
  it('does not judge a page that refused the read', () => {
    expect(judgeFormLink(u, { html: '', how: 'walled', status: 0, finalUrl: u }).state).toBe('unreadable')
  })
})

describe('refresh takes a dead link off the listing', () => {
  const current = { id: 'a', name: 'MadTown Throwdown', startDate: '2027-11-06', volunteerUrl: u, registrationUrl: null, humanEditedFields: null }
  it('clears the dead volunteer link', () => {
    const plan = planEventRefresh({ current, fields: {}, evidence: {}, sources: [], today: '2026-11-11', goneLinks: [{ url: u, evidence: 'Page Not Found' }] })
    expect(plan.patch).toEqual({ volunteerUrl: null })
  })
  it('leaves a link a person set', () => {
    const plan = planEventRefresh({ current: { ...current, humanEditedFields: ['volunteerUrl'] }, fields: {}, evidence: {}, sources: [], today: '2026-11-11', goneLinks: [{ url: u, evidence: 'Page Not Found' }] })
    expect(plan.patch).toEqual({})
  })
})
