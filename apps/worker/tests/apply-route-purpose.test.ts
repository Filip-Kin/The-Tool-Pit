import { describe, expect, it, vi } from 'vitest'

// resolveApplyRoute reads pages through these two; serve fixtures instead.
const pages = new Map<string, string>()
vi.mock('../src/connectors/base.js', () => ({
  politeFetch: async (url: string) => {
    const html = pages.get(url)
    return html === undefined
      ? new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
      : new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
}))
vi.mock('../src/connectors/playwright-render.js', () => ({
  withRenderedPage: async () => null,
}))

import { findApplyLinks } from '../src/grants/apply-links.js'
import { judge, offPurposeTitle, programmeChooser, resolveApplyRoute } from '../src/grants/apply-route.js'

/** Fetched pages under 2,500 characters count as JS shells; pad the fixtures past that. */
const pad = `<p>${'Lorem ipsum dolor sit amet. '.repeat(120)}</p>`
const doc = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}${pad}</body></html>`

// Real titles and link texts from the 2026-09 audit (/tmp/grant-audit).
const AMSTI_REPORT = 'https://docs.google.com/forms/d/e/1FAIpQLSepXqMfQvdHQmhr2vdIS1q7nWt4ZO7XY96q8smQs8fUnIdS4g/viewform?usp=header'
const AMSTI_DOCUSIGN = 'https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=f2d45235-f350-4022-ae9f-55d80c8e1726&env=na4&acct=0d0d5396-2e0a-4ad5-97e4-e591b723344b'
const AMSTI_INFO = 'https://www.amsti.org/robotics'
const REV_INFO = 'https://www.revrobotics.com/team-sponsorship/'
const REV_FTC_FORM = 'https://form.jotform.com/262436653502152'
const revChooser = doc('Team REV Sponsorship Program', '<h1>Team REV Sponsorship Program</h1><a href="/ftc-sponsorship-application/"><img src="ftc.png"></a><a href="/ftc-sponsorship-application/">FTC Team Application</a><a href="/frc-sponsorship-application/"><img src="frc.png"></a><a href="/frc-sponsorship-application/">FRC Team Application</a><a href="/sponsorship/">Event &amp; Team Sponsorship</a>')

describe('off-purpose forms are not the application', () => {
  it("AMSTI's expenditure report Google Form is rejected by its title", () => {
    const html = doc('FY27 Alabama Robotics Grant Expenditure Report ', '<div>Expenditure report</div>')
    expect(offPurposeTitle(html)).toContain('Expenditure Report')
    expect(judge(AMSTI_REPORT, html, 'fetch')).toBeNull()
  })
  it("Daniels Fund's meeting-space request form is rejected by its title", () => {
    const html = doc('Meeting Space Request Form - Daniels Fund', '<form><input name="organization"><input name="email"><input name="date"><textarea name="purpose"></textarea><button type="submit">Submit request</button></form>')
    expect(judge('https://danielsfund.org/meeting-space/request-form/', html, 'fetch')).toBeNull()
  })
  it('a bug-report form and a donate-to-us page are rejected', () => {
    expect(offPurposeTitle(doc('Website Bug Report', ''))).not.toBeNull()
    expect(offPurposeTitle(doc('Donate Now | Example Robotics', ''))).not.toBeNull()
    expect(offPurposeTitle(doc('Make a Donation', ''))).not.toBeNull()
  })
  it('donation REQUEST pages stay applications (Harbor Freight, Costco)', () => {
    expect(offPurposeTitle(doc('Donation Request Information – Harbor Freight Giving Back', ''))).toBeNull()
    expect(offPurposeTitle(doc('Charitable Giving | Costco', '<h1>Donation Requests</h1>'))).toBeNull()
    expect(offPurposeTitle(doc('FTC Team Sponsorship Application', ''))).toBeNull()
  })
})

describe('apply links: off-purpose links are dropped', () => {
  it("Daniels Fund: 'Book Now' to the meeting-space form is not an apply link, the eligibility quiz is", () => {
    const html = '<a href="https://danielsfund.org/meeting-space/request-form/">Book Now Book Now</a><a href="https://danielsfund.org/meeting-space/">Book Our Meeting Space</a><a href="https://grants.danielsfund.org/s/eligibility-quiz">Grants Eligibility Quiz</a><a href="https://grants.danielsfund.org/">Grants Portal</a>'
    const urls = findApplyLinks(html, 'https://danielsfund.org/our-work/grants/').map((l) => l.url)
    expect(urls).not.toContain('https://danielsfund.org/meeting-space/request-form/')
    expect(urls).toContain('https://grants.danielsfund.org/s/eligibility-quiz')
  })
  it('AMSTI: the DocuSign PowerForm outranks the bare Google Form link, the bug report is dropped', () => {
    const html = `<a href="${AMSTI_DOCUSIGN.replace(/&/g, '&amp;')}">Click Here to begin the FY27 Robotics Grant DocuSign Application!</a><a href="${AMSTI_REPORT}">Click Here</a><a href="https://forms.monday.com/forms/42f1236806196cc4fcdd694b771fa10f?r=use1">🐞 Website Bug Report 🐞</a>`
    const links = findApplyLinks(html, AMSTI_INFO)
    expect(links[0].url).toBe(AMSTI_DOCUSIGN)
    expect(links.map((l) => l.url)).not.toContain('https://forms.monday.com/forms/42f1236806196cc4fcdd694b771fa10f?r=use1')
  })
  it('a volunteer or newsletter link is dropped even when it says request', () => {
    const html = '<a href="/volunteer-request">Volunteer request form</a><a href="/news-signup">Newsletter sign-up form</a><a href="/apply">Apply</a>'
    expect(findApplyLinks(html, 'https://example.org/grants').map((l) => l.url)).toEqual(['https://example.org/apply'])
  })
})

describe('programme chooser pages', () => {
  it('REV: one FTC form and one FRC form make the page a chooser', () => {
    expect(programmeChooser(revChooser, REV_INFO)).toEqual(['FTC', 'FRC'])
  })
  it('a single application form is not a chooser', () => {
    expect(programmeChooser(doc('Grants', '<a href="/apply">Apply for a FIRST team grant</a>'), 'https://example.org/grants')).toBeNull()
  })
  it('a community-giving form next to a robotics form is not a chooser (the team form wins, as before)', () => {
    const html = doc('Giving', '<a href="https://x.submittable.com/submit/1">Community Grant Application</a><a href="https://x.submittable.com/submit/2">FIRST Robotics Competition Grant Application</a>')
    expect(programmeChooser(html, 'https://example.org/giving')).toBeNull()
  })
  it('several fund-specific forms make a chooser', () => {
    const html = doc('Grants', '<a href="https://x.submittable.com/submit/1">Rookie Grant Application</a><a href="https://x.submittable.com/submit/2">Veteran Grant Application</a>')
    expect(programmeChooser(html, 'https://example.org/grants')).toEqual(['rookie grant', 'veteran grant'])
  })
})

describe('resolveApplyRoute over the audit cases', () => {
  it('AMSTI: the stored expenditure-report form is skipped and the DocuSign application wins', async () => {
    pages.clear()
    pages.set(AMSTI_REPORT, doc('FY27 Alabama Robotics Grant Expenditure Report ', '<div>FY27 Alabama Robotics Grant Expenditure Report</div>'))
    pages.set(AMSTI_INFO, doc('Robotics Grant 2027| AMSTI | ALSDE', `<a href="${AMSTI_DOCUSIGN.replace(/&/g, '&amp;')}">Click Here to begin the FY27 Robotics Grant DocuSign Application!</a><p>Expenditure report:</p><a href="${AMSTI_REPORT}">Click Here</a>`))
    pages.set(AMSTI_DOCUSIGN, doc('DocuSign', '<div>PowerForm</div>'))
    const r = await resolveApplyRoute([AMSTI_REPORT, AMSTI_INFO])
    expect(r.status).toBe('portal')
    expect(r.url).toBe(AMSTI_DOCUSIGN)
  })
  it('REV: the stored FTC form gives way to the chooser page', async () => {
    pages.clear()
    pages.set(REV_FTC_FORM, doc('FTC Team Sponsorship Application', '<h1>FTC Team Sponsorship Application</h1>'))
    pages.set(REV_INFO, revChooser)
    const r = await resolveApplyRoute([REV_FTC_FORM, REV_INFO])
    expect(r.status).toBe('portal')
    expect(r.url).toBe(REV_INFO)
    expect(r.evidence).toContain('FTC, FRC')
  })
  it('REV: starting from the chooser page returns the chooser', async () => {
    pages.clear()
    pages.set(REV_INFO, revChooser)
    const r = await resolveApplyRoute([REV_INFO])
    expect(r.url).toBe(REV_INFO)
    expect(r.evidence).toContain('several application forms')
  })
  it('a single-programme form whose info page has one form stays the form', async () => {
    pages.clear()
    const form = 'https://form.jotform.com/1'
    const info = 'https://example.org/sponsorship'
    pages.set(form, doc('FTC Team Sponsorship Application', '<h1>FTC Team Sponsorship Application</h1>'))
    pages.set(info, doc('Sponsorship', `<a href="${form}">FTC Team Application</a>`))
    const r = await resolveApplyRoute([form, info])
    expect(r.url).toBe(form)
    expect(r.evidence).toContain('Jotform')
  })
})
