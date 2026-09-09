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
