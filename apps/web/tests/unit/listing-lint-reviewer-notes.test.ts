import { describe, it, expect } from 'vitest'
import { lintListing, isReviewerNote, reviewerNotesIn } from '@/lib/grants/listing-lint'

// Leaked text from published grants, 2026-09-23 audit (/tmp/grant-audit/today.json).
const LEAKED = {
  threeM: "Rookie and veteran FRC and FTC teams. Filip's sheet marks 3M employee involvement as required and an earlier page version said '3M-mentored'; the current page no longer states it, so confirm in the screening questions.",
  cleveland: '501(c)(3) public charities (some government agencies and churches) in Cuyahoga, Lake and Geauga counties, OH. Candidate classification wrongly lists Summit county.',
  clevelandDescription:
    'The Cleveland Foundation funds tax-exempt 501(c)(3) organizations (and some government agencies and churches) operating in Cuyahoga, Lake and Geauga counties. The standard grant application remains open year-round with applications rolling into the next cycle if received after a deadline. The aggregator notes four strategic annual deadlines (March 31, June 30, September 15, December 31) although the funder page states applications are accepted year-round.',
  kellogg: 'Organisations (no individuals, capital or political grants); priority places per sheet row: Michigan, Mississippi, New Mexico, New Orleans (not verified on this page).',
  teamRev:
    'Teams apply through separate FTC and FRC application forms on the REV Robotics website. The aggregator notes indicate the current cycle is closed with no future application window listed.',
  jbHunt: "Applicants must be a 501(c)(3) organization or a school. The funder states to 'Check your eligibility' but does not detail other restrictions on the page.",
  elevation: 'Robotics or drone teams (or their sponsoring organizations) in Colorado; priority to Title I / high free-and-reduced-lunch schools. Programs run are VEX and RECF Aerial Drone, not FIRST.',
}

// Real funder prose from the same published rows, which must stay clean.
const CLEAN = [
  'This grant supports FRC and FTC teams competing in the FIRST CANOPY season. Applications are submitted through Submittable. FTC team grant applications are reviewed and awarded on a rolling basis due to the earlier FTC season start.',
  'The Foundation does not fund individuals, capital investments, political parties, or candidates.',
  "JB Hunt's Company Giving program supports projects across four pillars: health care, veterans' support, education, and crisis management. The funder notes that funds are limited in relation to the number of proposals received.",
  'Elevation Robotics, a Colorado nonprofit, awards team grants of approximately $1,000 to cover registration fees, robot parts, and supplies. The grants support VEX Robotics and RECF Aerial Drone teams.',
  'The program is open to US and international teams that demonstrate excellence on the playing field and are model members of their local FIRST community through outreach and knowledge-sharing.',
  'Organizations must register in the Grants Gateway portal at least two weeks before applying, create or update an organization profile, and complete the application online.',
  'There is a wide range in the dollar amounts of grants awarded',
  'We fund FIRST teams in Michigan and Ohio. We cannot fund every request.',
  'Download the budget sheet and the program fact sheet before you apply.',
  'Phase I awards are announced in May.',
]

// Deadline notes as the pipeline writes them today; the funder's date, not a reviewer's note.
const CLEAN_DEADLINE_NOTES = [
  'Closes 2026-10-17 (the funder gives no time of day). "The team grant application will open September 17, 2026 and close October 17, 2026."',
  'The funder states the date; no time of day given. "The team grant application will open September 17, 2026, and close October 17, 2026."',
  'Closes 2026-12-31 (the funder gives no time of day). All requests and proposals for funding are accepted in December for consideration the following calendar year.',
]

const base = { name: 'Team REV Sponsorship Program', funderName: 'REV Robotics', summary: 'Sponsorship for FTC and FRC teams, US or international, rookie or veteran.' }

describe('reviewer notes in public text', () => {
  it('finds the leaked sentence in each audited grant, and only that sentence', () => {
    expect(reviewerNotesIn(LEAKED.threeM)).toEqual([LEAKED.threeM.slice(LEAKED.threeM.indexOf("Filip's"))])
    expect(reviewerNotesIn(LEAKED.cleveland)).toEqual(['Candidate classification wrongly lists Summit county.'])
    expect(reviewerNotesIn(LEAKED.clevelandDescription)).toHaveLength(1)
    expect(reviewerNotesIn(LEAKED.clevelandDescription)[0]).toMatch(/^The aggregator notes four/)
    expect(reviewerNotesIn(LEAKED.kellogg)).toEqual([LEAKED.kellogg])
    expect(reviewerNotesIn(LEAKED.teamRev)).toEqual(['The aggregator notes indicate the current cycle is closed with no future application window listed.'])
    expect(reviewerNotesIn(LEAKED.jbHunt)).toEqual(["The funder states to 'Check your eligibility' but does not detail other restrictions on the page."])
    expect(reviewerNotesIn(LEAKED.elevation)).toEqual(['Programs run are VEX and RECF Aerial Drone, not FIRST.'])
  })

  it('leaves real funder prose alone', () => {
    for (const text of [...CLEAN, ...CLEAN_DEADLINE_NOTES]) expect(reviewerNotesIn(text), text).toEqual([])
  })

  it('knows first-person reviewer voice from a funder or a testimonial', () => {
    expect(isReviewerNote('I could not find a deadline on the page.')).toBe(true)
    expect(isReviewerNote('We could not verify the award amount.')).toBe(true)
    expect(isReviewerNote('I built my first robot with this grant.')).toBe(false)
    expect(isReviewerNote('We fund FIRST teams.')).toBe(false)
  })
})

describe('lintListing, reviewer notes', () => {
  it('blocks each public field that carries one', () => {
    const issues = lintListing({
      ...base,
      description: LEAKED.teamRev,
      awardNotes: 'Up to $2,500 per team (per sheet row, not verified).',
      deadlineNote: 'Filip says the round closes in October.',
      requirementLabels: [LEAKED.threeM, LEAKED.cleveland, LEAKED.kellogg, LEAKED.jbHunt, LEAKED.elevation],
    })
    const reviewer = issues.filter((i) => i.problem.includes('reviewer'))
    expect(reviewer.map((i) => i.field).sort()).toEqual(['awardNotes', 'deadlineNote', 'description', 'requirement', 'requirement', 'requirement', 'requirement', 'requirement'])
  })

  it('passes the clean text from the same grants', () => {
    const issues = lintListing({
      ...base,
      description: CLEAN.slice(0, 5).join(' '),
      awardNotes: 'There is a wide range in the dollar amounts of grants awarded',
      deadlineNote: CLEAN_DEADLINE_NOTES[1],
      requirementLabels: ['FTC and FRC teams that do well on the field and do outreach in their local FIRST community.', 'Applicant must be a 501(c)(3), a public school or district, or apply through a 501(c)(3)'],
    })
    expect(issues.filter((i) => i.problem.includes('reviewer'))).toEqual([])
  })

  it('checks the name and the funder too', () => {
    const issues = lintListing({ ...base, name: 'Grant (from the sheet, unverified)', funderName: 'Aggregator listing' })
    expect(issues.filter((i) => i.problem.includes('reviewer')).map((i) => i.field).sort()).toEqual(['funder', 'name'])
  })
})
