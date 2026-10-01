/**
 * The shared refresh rules, driven by the real edits of the first field
 * refresh run (2026-10-01): every bad edit must now be refused or seen as no
 * change, and the good ones must still go through.
 */
import { describe, it, expect } from 'bun:test'
import { planFieldRefresh } from '../src/listings/field-refresh.js'
import { planEventRefresh } from '../src/listings/event-refresh-plan.js'
import { planToolUpdate } from '../src/jobs/tool-refresh-rules.js'
import {
  sameMeaningText,
  sameStreet,
  hoursRefusal,
  availabilityRefusal,
  signupLinkRefusal,
  contactRefusal,
  addressRefusal,
  placeRefusal,
  isGenericPageUrl,
  isSiteHomeUrl,
} from '../src/listings/refresh-rules.js'
import type { NamedText } from '../src/model/evidence.js'

const HOME = 'https://www.example-robotics.org/'

/** A published field with one column set, read again with that column changed. */
function refresh(
  key: string,
  from: unknown,
  to: unknown,
  quote: string,
  pages: NamedText<string>[],
  extra: Record<string, unknown> = {},
) {
  return planFieldRefresh({
    current: { status: 'published', name: 'Test field', [key]: from, ...extra },
    claimed: false,
    read: { [key]: to },
    evidence: { [key]: { quote, source: pages[0]!.source } },
    sources: pages,
  })
}

const page = (text: string, source = HOME): NamedText<string> => ({ source, text })

describe('rule 1: same meaning is not a change (fields)', () => {
  it.each([
    ['500 Washington Street', '500 Washington St', 'Visit us at 500 Washington St in town'],
    ['1590 Bill Murdock Road Northeast', '1590 Bill Murdock Rd', 'The shop is at 1590 Bill Murdock Rd, Marietta'],
    ['201 North Douglas Street', '201 N. Douglas Street', 'Find us at 201 N. Douglas Street downtown'],
  ])('address %s -> %s', (from, to, text) => {
    const plan = refresh('address', from, to, text, [page(text)])
    expect(plan.changes).toEqual([])
    expect(plan.refused).toEqual([])
  })

  it('country United States -> US', () => {
    const plan = refresh('country', 'United States', 'US', 'Located in Michigan, US today', [page('Located in Michigan, US today')])
    expect(plan.changes).toEqual([])
  })

  it('hours ";" -> ","', () => {
    const from = 'MONDAY and THURSDAY 6:30 pm to 9:00 pm; SATURDAY 10 am to 2 pm'
    const to = 'MONDAY and THURSDAY 6:30 pm to 9:00 pm, SATURDAY 10 am to 2 pm'
    const plan = refresh('hours', from, to, to, [page(to)])
    expect(plan.changes).toEqual([])
  })

  it('hours "from" added', () => {
    const plan = refresh('hours', 'Sat-Sun, 10am-4pm', 'Sat-Sun, from 10am-4pm', 'Open Sat-Sun, from 10am-4pm', [page('Open Sat-Sun, from 10am-4pm')])
    expect(plan.changes).toEqual([])
  })

  it('a different street is still a change', () => {
    expect(sameStreet('500 Washington Street', '510 Washington St')).toBe(false)
    expect(sameStreet('201 North Douglas Street', '201 South Douglas Street')).toBe(false)
  })

  it('different words are still different', () => {
    expect(sameMeaningText('Open Monday', 'Open Tuesday')).toBe(false)
    expect(sameMeaningText('6:30-9', '6:30 to 9')).toBe(true)
  })
})

describe('rule 2: team names are never refreshed', () => {
  it.each([
    ['Slice', 'SLICE Robotics'],
    ['Rutland Area Robotics', 'The IBOTS'],
    ['Robototes / Bellevue Alliance', 'The Bellevue Alliance'],
    ['Mean Machine', 'Team Mean Machine'],
  ])('%s -> %s', (from, to) => {
    const text = `Welcome to ${to}, a FIRST team`
    const plan = refresh('teamName', from, to, text, [page(text)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('teamName')
  })
})

describe('rule 3: address only from a page about the place', () => {
  it('refuses a mailing address off /contact-us', () => {
    const contact = page('Rutland Area Robotics, 8 Stratton Road, Rutland VT 05701', 'https://rutlandrobotics.org/contact-us')
    const plan = refresh('address', '112 Quality Lane', '8 Stratton Road', '8 Stratton Road, Rutland VT', [contact])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('contact')
  })

  it('refuses when the quote does not hold the new street', () => {
    expect(addressRefusal('8 Stratton Road', 'Rutland VT 05701', [page('Rutland VT 05701')])).toContain('street')
  })

  it('applies a moved field quoted on its own page', () => {
    const text = 'Our practice field has moved to 42 Industrial Drive, Rutland'
    const plan = refresh('address', '112 Quality Lane', '42 Industrial Drive', text, [page(text, 'https://rutlandrobotics.org/practice-field')])
    expect(plan.changes.map((c) => c.key)).toEqual(['address'])
  })

  it('knows contact, about, donate and get-involved pages', () => {
    for (const p of ['/contact', '/contact-us/', '/about', '/donate', '/get-involved', '/team/about-us.html']) {
      expect(isGenericPageUrl(`https://x.org${p}`)).toBe(true)
    }
    expect(isGenericPageUrl('https://x.org/practice-field')).toBe(false)
  })
})

describe('rule 4: hours are a recurring schedule', () => {
  it('refuses specific sign-up dates (4201)', () => {
    const to = 'Sun, Aug 23, 2:30 PM - 6:30 PM; Sun, Aug 30, 2:30 PM - 6:30 PM'
    const plan = refresh('hours', null, to, to, [page(to)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('dates')
  })

  it.each(['Sat 8/23 10-4', '2026-08-23 from 2 pm', '23 August, 10am-2pm', 'September 5th evening'])('refuses %s', (v) => {
    expect(hoursRefusal(v)).not.toBeNull()
  })

  it.each(['Open 6:30-9 every Monday and Thursday; Jan-Apr: Open daily', 'Open 24/7', 'Mon-Thu 6-9 pm, May through August'])(
    'accepts %s',
    (v) => {
      expect(hoursRefusal(v)).toBeNull()
    },
  )

  it('applies the good 2471 hours change', () => {
    const to = 'Open 6:30-9 every Monday and Thursday; Jan-Apr: Open daily'
    const plan = refresh('hours', 'Whenever 2471 has open shop', to, to, [page(`Practice field. ${to}.`)])
    expect(plan.changes.map((c) => c.key)).toEqual(['hours'])
  })
})

describe('rule 5: availability only on explicit words', () => {
  it('refuses in_season from a season heading', () => {
    const text = '2026-2027 Vitruvian Bots Field Sign-Up'
    const plan = refresh('availability', 'year_round', 'in_season', text, [page(text)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('availability')
  })

  it('applies an explicit "in season only"', () => {
    expect(availabilityRefusal('in_season', 'The field is open in season only')).toBeNull()
    expect(availabilityRefusal('year_round', 'Open year-round by appointment')).toBeNull()
    expect(availabilityRefusal('year_round', '2026 Field Sign-Up')).not.toBeNull()
  })
})

describe('rule 6: a sign-up link is not a contact page', () => {
  it.each(['https://www.chelsearobotics.org/contact', 'https://www.slicerobotics.org/contact/'])('refuses %s', (url) => {
    const plan = refresh('contactUrl', null, url, url, [page(`Reach us: ${url}`)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('contactUrl')
  })

  it('refuses the site home page', () => {
    expect(signupLinkRefusal('https://www.slicerobotics.org/')).not.toBeNull()
    expect(isSiteHomeUrl('https://x.org/index.html')).toBe(true)
    expect(isSiteHomeUrl('https://x.org/?form=field')).toBe(false)
  })

  it('applies a real request form', () => {
    const url = 'https://forms.gle/HfKxRAJK7Up7VYYX6'
    const plan = refresh('contactUrl', null, url, url, [page(`Request field time: ${url}`)])
    expect(plan.changes.map((c) => c.key)).toEqual(['contactUrl'])
  })

  it('event registration links follow the same rule', () => {
    const src = page('Register at https://example.org/contact and see you there')
    const plan = planEventRefresh({
      current: { registrationUrl: null, humanEditedFields: [] },
      fields: { registrationUrl: 'https://example.org/contact' },
      evidence: { registrationUrl: { quote: 'https://example.org/contact' } },
      sources: [src],
      today: '2026-10-01',
    })
    expect(plan.applied).toEqual([])
    expect(plan.held[0]).toMatchObject({ key: 'registrationUrl', reason: 'refresh_rule' })
  })
})

describe('rule 7: contact text', () => {
  it('keeps "for access" while the old email is still on the page', () => {
    const text = 'Practice field: contact info@rutlandrobotics.org for access. Email info@rutlandrobotics.org'
    const plan = refresh('contactInfo', 'Contact info@rutlandrobotics.org for access', 'info@rutlandrobotics.org', 'Email info@rutlandrobotics.org', [page(text)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toContain('contactInfo')
  })

  it('keeps the district veto condition while the page still states it', () => {
    const from = 'Email us through the link on our website. Our school district may veto your access.'
    const text = 'Contact robotics@example.org. Our school district may veto your access to the building.'
    const plan = refresh('contactInfo', from, 'robotics@example.org', 'Contact robotics@example.org', [page(text)])
    expect(plan.changes).toEqual([])
    expect(plan.refused[0]).toMatch(/veto|district/)
  })

  it('applies the good 2412 change', () => {
    const text = 'Want to use the field? Email bsdsteamnasium@gmail.com to book.'
    const plan = refresh('contactInfo', 'Reach out to a 2412 mentor', 'bsdsteamnasium@gmail.com', 'Email bsdsteamnasium@gmail.com to book', [page(text)])
    expect(plan.changes.map((c) => c.key)).toEqual(['contactInfo'])
  })

  it('replaces an email that is gone from the page', () => {
    expect(contactRefusal('old@team.org', 'new@team.org', [page('Write to new@team.org')])).toBeNull()
  })

  it('event contact email follows the same rule', () => {
    const src = page('Questions: director@event.org or volunteers@event.org')
    const plan = planEventRefresh({
      current: { contactEmail: 'director@event.org', humanEditedFields: [] },
      fields: { contactEmail: 'volunteers@event.org' },
      evidence: { contactEmail: { quote: 'Questions: director@event.org or volunteers@event.org' } },
      sources: [src],
      today: '2026-10-01',
    })
    expect(plan.applied).toEqual([])
  })
})

describe('events reuse rule 1', () => {
  it('a trailing direction dropped is the same address', () => {
    const src = page('Held at 1590 Bill Murdock Rd, Marietta GA')
    const plan = planEventRefresh({
      current: { address: '1590 Bill Murdock Road Northeast', humanEditedFields: [] },
      fields: { address: '1590 Bill Murdock Rd' },
      evidence: { address: { quote: 'Held at 1590 Bill Murdock Rd, Marietta GA' } },
      sources: [src],
      today: '2026-10-01',
    })
    expect(plan.applied).toEqual([])
    expect(plan.held).toEqual([])
  })

  it('country spellings are one country', () => {
    const plan = planEventRefresh({
      current: { country: 'United States', humanEditedFields: [] },
      fields: { country: 'USA' },
      evidence: { country: { quote: 'Detroit, MI, USA 48201' } },
      sources: [page('Detroit, MI, USA 48201')],
      today: '2026-10-01',
    })
    expect(plan.applied).toEqual([])
  })
})

describe('tools reuse rule 1', () => {
  it('a name that only changed case or punctuation is not applied', () => {
    const row = { name: 'Choreo', summary: 'Path planner.', description: null, humanEditedFields: [] }
    const plan = planToolUpdate(row, { name: 'Choreo', description: 'Path planner.' }, { name: 'CHOREO', description: 'Path planner' })
    expect(plan.changes).toEqual([])
  })
})

// The dry run of these rules against production (2026-10-01) still let four
// wrong edits through. Each one is a case here.
describe('second dry run', () => {
  it('refuses a city taken from a team name (Asheville)', () => {
    expect(placeRefusal('Asheville', "ASHEVILLE HIGH SCHOOL'S STUDENT-LED ROBOTICS TEAM")).not.toBeNull()
    expect(placeRefusal('Asheville', '419 McDowell St, Asheville, NC 28803')).toBeNull()
    expect(placeRefusal('Novi', 'Novi, MI')).toBeNull()
  })
  it('refuses booking rules as hours (Walton)', () => {
    expect(hoursRefusal('Please sign up for a maximum of one session per week. You may sign up for additional slots one week in advance')).not.toBeNull()
  })
  it('refuses hours summarised from dated sessions (4201)', () => {
    expect(
      hoursRefusal('Various Sunday afternoons (typically 2:30 PM - 6:30 PM) plus Saturday scrimmages', 'Sun, Aug 23, 2:30 PM - 6:30 PM'),
    ).not.toBeNull()
  })
  it('refuses the time choices on a request form (STEAMnasium)', () => {
    expect(
      hoursRefusal('3-6pm, 6-9pm (weekdays); 9am-12pm (weekends)', 'Requested Time (weekdays) Monday Tuesday 3-6pm', 'https://forms.gle/HfKxRAJK7Up7VYYX6'),
    ).not.toBeNull()
  })
  it('keeps the good 2471 hours', () => {
    expect(
      hoursRefusal('Open 6:30-9 every Monday and Thursday; Jan-Apr: Open daily', 'Open 6:30-9 every Monday and Thursday', 'https://team2471.org/facilities-map/'),
    ).toBeNull()
  })
})
