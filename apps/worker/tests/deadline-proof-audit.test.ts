import { describe, expect, it } from 'vitest'
import { findDeadlineProof } from '../src/grants/deadline-proof.js'

/**
 * The cycles system:deadline-proof invented on the 38 grants published on
 * 2026-09-23 (audit: /tmp/grant-audit/findings.json). Page text is the
 * stripped text of the funder pages as fetched that day.
 */
const TODAY = '2026-09-23'

describe('a date for another fund on the same page', () => {
  // clevelandfoundation.org/grants/other-grant-opportunities, as stripped.
  const cleveland = [
    'Other Grant Opportunities',
    'Families, corporations, individuals and private foundations have established funds at the Cleveland Foundation. These funds have their own grantmaking strategies and application processes. Log in to Grants Gateway to complete applications by the appropriate deadlines.',
    'Black Philanthropy Fund',
    "The Cleveland Foundation's Black Philanthropy Fund is an endowed affinity fund dedicated to advancing healthy communities and long-term prosperity for Greater Cleveland's Black community.",
    'Grant Amount',
    '$10,000-$25,000',
    'Application Deadline',
    'May 11',
    'Equity in the Arts Fund',
    'To strengthen and build the capacity of small and medium arts and cultural organizations led by and serving Black, Indigenous and People of Color (BIPOC) in the city of Cleveland.',
    'Application Deadline',
    'October 2',
  ].join('\n')
  const ctx = { programName: 'Cleveland Foundation Standard Grant', funderName: 'The Cleveland Foundation' }

  it('does not give the standard grant the Black Philanthropy Fund deadline (as published: 2027-05-11)', () => {
    const p = findDeadlineProof([{ url: 'https://www.clevelandfoundation.org/grants/other-grant-opportunities', text: cleveland }], TODAY, ctx)
    expect(p.kind).not.toBe('dated')
    expect(p.kind).not.toBe('recurring')
  })
  it('refuses it by the section heading even when the date carries a year', () => {
    const withYear = cleveland.replace('May 11', 'May 11, 2027')
    expect(findDeadlineProof([{ url: 'https://www.clevelandfoundation.org/x', text: withYear }], TODAY, ctx).kind).not.toBe('dated')
    // The fund's own listing still gets it.
    const own = findDeadlineProof([{ url: 'https://www.clevelandfoundation.org/x', text: withYear }], TODAY, { programName: 'Black Philanthropy Fund', funderName: 'The Cleveland Foundation' })
    expect(own.kind).toBe('dated')
    expect(own.date).toBe('2027-05-11')
  })
  it('refuses a sentence that names another programme and not this one', () => {
    // firstinspires.org/robotics/team-grants carries every sponsor's grant on one page.
    const text = 'This team grant opportunity is available for FIRST teams who have a Boeing employee mentor. Applications for the Boeing Team Grant close on November 14, 2026 at 11:59pm EST.'
    expect(findDeadlineProof([{ url: 'https://www.firstinspires.org/robotics/team-grants', text }], TODAY, { programName: '3M FIRST Team Grant', funderName: '3M' }).kind).not.toBe('dated')
    const own = findDeadlineProof([{ url: 'https://www.firstinspires.org/robotics/team-grants', text }], TODAY, { programName: 'Boeing Team Grant', funderName: 'Boeing' })
    expect(own.date).toBe('2026-11-14')
  })
  it('still reads the programme\'s own sentence on that page', () => {
    const text = "We're excited to once again partner with 3M to support FIRST Robotics Competition and FIRST Tech Challenge teams for the FIRST CANOPY season.\nThe team grant application will open September 17, 2026, and close October 17, 2026."
    const p = findDeadlineProof([{ url: 'https://www.firstinspires.org/robotics/team-grants', text }], TODAY, { programName: '3M FIRST Team Grant', funderName: '3M' })
    expect(p.kind).toBe('dated')
    expect(p.date).toBe('2026-10-17')
  })
})

describe('a date that is not about applying', () => {
  it('a calendar-year limit is not a deadline (Harbor Freight, published as 2027-01-01)', () => {
    const text = 'Due to the volume of requests, organizations may submit only one donation request and/or receive one donation from Harbor Freight Tools within a calendar year (January 1 – December 31).'
    const p = findDeadlineProof([{ url: 'https://harborfreightgivingback.com/donation-request-information/', text }], TODAY)
    expect(p.kind).toBe('none')
    // Even with a year on it.
    const dated = text.replace('January 1 – December 31', 'January 1, 2027 – December 31, 2027')
    expect(findDeadlineProof([{ url: 'https://harborfreightgivingback.com/x', text: dated }], TODAY).kind).not.toBe('dated')
  })
  it('an impact-report date is not the deadline (Union Pacific, published as 2026-07-31)', () => {
    const text = ['Timeline', 'ACTIVITY', 'DATE', '2025 Grant Impact Reports Due', 'July 31, 2026', '2026 Grant Application Submission Period', 'April 1 – April 30, 2026, 3:00 PM CT', '2026 Grant Award Status Notification', 'August 2026'].join('\n')
    const p = findDeadlineProof([{ url: 'https://www.up.com/communities/philanthropic-giving/local-grants/app-process-timeline', text }], '2026-06-01')
    expect(p.date).not.toBe('2026-07-31')
    expect(p.past?.date).not.toBe('2026-07-31')
  })
  it('a notification date is not the deadline', () => {
    expect(findDeadlineProof([{ url: 'https://f.org', text: 'Applicants will be notified of decisions by December 1, 2026.' }], TODAY).kind).toBe('none')
  })
})

describe('no year is added and none is rolled forward', () => {
  it('"due by April 17" is recurring, not 2027-04-17 (Marion County)', () => {
    const text = [
      'Simple Grant Application',
      'For grant requests of $3,000 or less',
      'Grant applications are due by April 17. Read through the criteria outlined on this page to see if you organization qualifies to apply for a grant from Marion County Community Foundation.',
      'The Marion County Community Foundation Grant Application deadline was April 17, 2026.',
    ].join('\n')
    const p = findDeadlineProof([{ url: 'https://mccfiowa.org/simple-grant-application/', text }], TODAY, { programName: 'Marion County Community Foundation Simple Grant', funderName: 'Marion County Community Foundation' })
    expect(p.kind).toBe('recurring')
    expect(p.monthDay).toBe('04-17')
    expect(p.date).toBeUndefined()
    expect(p.past?.date).toBe('2026-04-17')
  })
  it('"next cycle (2026) are due April 30" is not a 2027 deadline (Union Pacific, published as open 2027)', () => {
    const text = 'Additional timeline narrative: Grant Impact Reports for prior year (2025) grant awards can be submitted anytime before July 31. Applications for the next cycle (2026) are due April 30.'
    const p = findDeadlineProof([{ url: 'https://www.up.com/communities/philanthropic-giving/local-grants/app-process-timeline', text }], TODAY)
    expect(p.kind).not.toBe('dated')
    expect(p.date).toBeUndefined()
  })
})

describe('a third-party page proves nothing', () => {
  // grantable.co's own projection: the funder had posted no 2027 date.
  const grantable = 'Westfield Service League Grant Program WESTFIELD SERVICE LEAGUE INC Foundation Annual Grants for Nonprofits Funding Amount Varies Deadline January 26, 2027'
  it('grantable.co (Westfield Service League, published as 2027-01-26)', () => {
    const p = findDeadlineProof([{ url: 'https://grantable.co/grants/westfield-service-league-grant-program', text: grantable }], TODAY)
    expect(p.kind).toBe('none')
    expect(p.urlsRead).toEqual(['https://grantable.co/grants/westfield-service-league-grant-program'])
  })
  it('the funder\'s own "not out yet" wins over the directory\'s date', () => {
    const p = findDeadlineProof([
      { url: 'https://grantable.co/grants/westfield-service-league-grant-program', text: grantable },
      { url: 'https://www.thewestfieldserviceleague.org/grants', text: '2026-2027 Grant Applications will open on or about October 1, 2026. Please email your request for a grant application to wslgrants@gmail.com' },
    ], TODAY)
    expect(p.kind).toBe('not_public')
  })
  it('an archive copy is not evidence either', () => {
    const p = findDeadlineProof([{ url: 'https://web.archive.org/web/20241013082117/https://www.pec.coop/community-grants/', text: 'Applications are due October 2, 2026.' }], TODAY)
    expect(p.kind).toBe('none')
  })
})

describe('the row a date sits in', () => {
  it('an application row after an announcement row still counts (AMSTI)', () => {
    const text = [
      'Click Here to begin the FY27 Robotics Grant DocuSign Application!',
      'Grant Announcement via Memo: July 2026',
      'Grant Application Submitted online no later than September 30, 2026, at 5:00 p.m.',
      'Funds expended by and Evaluation/Expenditure Report due: September 30, 2027',
    ].join('\n')
    const p = findDeadlineProof([{ url: 'https://www.alabamaachieves.org/amsti/robotics', text }], TODAY, { programName: 'AMSTI Robotics Grant', funderName: 'AMSTI' })
    expect(p.kind).toBe('dated')
    expect(p.date).toBe('2026-09-30')
  })
  it('a reopening date is not a deadline (Midco)', () => {
    const p = findDeadlineProof([{ url: 'https://www.midco.com/about/midco-foundation/', text: 'Grant applications are currently closed and will reopen January 4, 2027.' }], TODAY, { programName: 'Midco Foundation Grants', funderName: 'Midco Foundation' })
    expect(p.kind).not.toBe('dated')
  })
})

describe('a page of several sponsors\' grants (firstinspires.org/robotics/team-grants)', () => {
  const page = [
    'Apply Now',
    'Description',
    "The John Deere grant application for teams in any of the FIRST® programs for the 2026 – 2027 FIRST season are now open. Our commitment to FIRST aligns with the John Deere Foundation's public goal of serving at least one million youth by 2030.",
    'Application Deadline:',
    'FIRST LEGO League Explore: December 18, 2026',
    'Apply Now',
    'Description',
    'Boston Scientific grant funds are intended to help make participation in robotics more affordable and accessible to students from economically disadvantaged schools and communities.',
    'Requirements',
    'Only FIRST Robotics Competition teams within 60 miles of Boston Scientific locations in California, Indiana, Massachusetts, and Minnesota may apply.',
    'Apply Now',
    'Description',
    'The Boeing team grant opportunity is only available for registered teams who have a Boeing employee mentor/retiree. It will close on November 14th at 11:59pm EST, or if funds are exhausted. Boeing Team Grants are reviewed monthly.',
    'Dow Grant Details: This year, Dow updated its grant process.',
    'Apply Now',
    'Description',
    "We're excited to once again partner with 3M to support FIRST Robotics Competition and FIRST Tech Challenge teams for the FIRST CANOPY season.",
    'The team grant application will open September 17, 2026, and close October 17, 2026.',
    'FIRST Tech Challenge team grant applications will be reviewed and awarded on a rolling basis (due to the earlier FIRST Tech Challenge season).',
  ].join('\n')
  const url = 'https://www.firstinspires.org/robotics/team-grants'
  it('gives 3M its own date', () => {
    const p = findDeadlineProof([{ url, text: page }], TODAY, { programName: '3M FIRST Team Grant', funderName: '3M' })
    expect(p.kind).toBe('dated')
    expect(p.date).toBe('2026-10-17')
  })
  it('gives Boston Scientific none of the other sponsors\' dates or timing words', () => {
    const p = findDeadlineProof([{ url, text: page }], TODAY, { programName: 'Boston Scientific FRC Grant', funderName: 'Boston Scientific' })
    expect(p.kind).toBe('none')
  })
})
