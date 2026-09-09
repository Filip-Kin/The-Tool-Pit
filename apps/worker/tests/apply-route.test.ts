import { describe, expect, it } from 'vitest'
import { judge } from '../src/grants/apply-route.js'

const page = (body: string) => `<html><body>${body}</body></html>`

describe('judge (apply route)', () => {
  it('a closed Google Form is closed, not a portal', () => {
    const r = judge('https://docs.google.com/forms/d/e/abc/viewform', page('<div>2024-25 Season Rookie Grant</div><div>The form Rookie Grant is no longer accepting responses.</div>'), 'fetch')
    expect(r?.status).toBe('closed')
  })
  it('a portal host is the destination', () => {
    const r = judge('https://usfirst.submittable.com/submit/9838/dow', page('<h1>2026-2027 Dow FRC International Grant</h1><button>Continue</button>'), 'fetch')
    expect(r?.status).toBe('portal')
    expect(r?.evidence).toContain('Submittable')
  })
  it('a page with a real form is the form', () => {
    const r = judge('https://kars4kidsgrants.org/', page('<form action="/thanks.php"><input type="text" name="n"><input type="email" name="e"><input type="tel" name="p"><textarea name="m"></textarea><input type="submit" value="Send"></form>'), 'fetch')
    expect(r?.status).toBe('form')
  })
  it('a search box is not a form', () => {
    const r = judge('https://example.org/grants', page('<form class="search"><input type="text" name="q"><input type="submit"></form>'), 'fetch')
    expect(r).toBeNull()
  })
  it("the funder's own gated application system is a portal", () => {
    const r = judge('https://first.dowstem.us/access', page('<h1>Robotics Grants | DoW STEM</h1><p>Submit a Proposal. To continue please provide your access token below.</p><form><input type="text" name="token"><button type="submit">Continue</button></form>'), 'fetch')
    expect(r?.status).toBe('portal')
    expect(r?.evidence).toContain("own application system")
  })
  it('a plain landing page is nothing yet', () => {
    const r = judge('https://stem2hub.org/fpl-sponsorship/', page('<h1>FPL sponsorship</h1><p>Apply for robotics sponsorship here.</p>'), 'fetch')
    expect(r).toBeNull()
  })
})

describe('judge (apply route), second pass rules', () => {
  const page = (body: string) => `<html><body>${body}</body></html>`
  it('a sponsorship form behind a sign-in link is a portal', () => {
    const r = judge('https://www.fabworks.com/sponsorships', page('<h1>Sponsorship request form</h1><p>Sign in to your account or create an account to continue.</p><a href="/login">Sign in</a>'), 'browser')
    expect(r?.status).toBe('portal')
  })
  it('an apply path that lands on a login is a portal', () => {
    const r = judge('https://www.aiaa-awards.org/a/solicitations/1624/home', page('<h1>Login required</h1><form><input type="email" name="u"><input type="password" name="p"><button type="submit">Log in</button></form>'), 'fetch')
    expect(r?.status).toBe('portal')
  })
  it('a PDF that reads like an application is the form', () => {
    const r = judge('http://sdspacegrant.sdsmt.edu/RoboticsMaterialsAward2026.pdf', '<pdf-form>Robotics Materials Award Application. Name of team: ____ Signature: ____</pdf-form>', 'pdf')
    expect(r?.status).toBe('form')
  })
  it("Michigan's MiLogin gateway is a known portal", () => {
    const r = judge('https://milogintp.michigan.gov/eai/tplogin/authenticate?URL=/', page('<h1>MiLogin</h1>'), 'browser')
    expect(r?.status).toBe('portal')
    expect(r?.evidence).toContain('MiLogin')
  })
})

import { embeddedApplyLinks } from '../src/grants/apply-route.js'
describe('embeddedApplyLinks', () => {
  it('finds an embedded form frame and a PDF application', () => {
    const html = '<iframe src="https://forms.example.com/embed/123"></iframe><iframe src="https://www.youtube.com/embed/x"></iframe><a href="/docs/RoboticsMaterialsAward2026.pdf">2026 Application Form (PDF)</a><a href="/report.pdf">Annual report</a>'
    const links = embeddedApplyLinks(html, 'https://sdspacegrant.sdsmt.edu/RoboticsMaterialsAward')
    expect(links.map((l) => l.url)).toEqual(['https://forms.example.com/embed/123', 'https://sdspacegrant.sdsmt.edu/docs/RoboticsMaterialsAward2026.pdf'])
  })
})

describe('judge: a script-mounted form without a <form> element', () => {
  it('counts the page inputs when there is a textarea and a submit', () => {
    const html = '<html><body><h1>Corporate Sponsorship Request</h1><div><input type="text" name="org"><input type="email" name="email"><input type="text" name="city"><input type="text" name="amount"><input type="date" name="when"><textarea name="why"></textarea><button>Submit request</button></div></body></html>'
    const r = judge('https://www.bmwgroup-werke.com/spartanburg/en/our-plant/corporate-sponsorship-request', html, 'browser')
    expect(r?.status).toBe('form')
  })
})

describe('judge: product and catalogue pages are never the application', () => {
  it("TE's application tooling catalogue is not a form", () => {
    const html = '<html><body><h1>Application Tooling</h1><form><input type="text" name="q"><select name="family"><option>a</option></select><input type="text" name="part"><textarea name="notes"></textarea><button type="submit">Submit</button></form></body></html>'
    expect(judge('https://www.te.com/en/products/application-tooling.html', html, 'fetch')).toBeNull()
  })
})
