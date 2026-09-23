import { describe, it, expect } from 'vitest'
import { scrubReviewerNotes, scrubListingText } from '@the-tool-pit/db/listing-text'
import { limitEvidence, validateGrantExtraction, verifyQuote, type GrantEvidence } from '../src/grants/candidate-extract.js'
import { validateGrantClassification } from '../src/grants/classify.js'
import { describeRow } from '../src/grants/connectors/sheet.js'

const FUNDER_PAGE = 'The team grant application will open September 17, 2026, and close October 17, 2026. Team Status: rookie veteran. Programs: FRC, FTC.'
const SHEET_ROW = describeRow({ name: '3M', link: 'https://www.firstinspires.org/robotics/team-grants', isOpen: 'Open', employee: 'Yes', notes: 'Must be 3M-mentored' }, "Filip's grant sheet")

function evidence(): GrantEvidence {
  return { funderPage: FUNDER_PAGE, aggregator: '', privateContext: SHEET_ROW }
}

describe('scrubReviewerNotes', () => {
  it('drops the leaked sentence and keeps the funder fact (3M, 2026-09-23 audit)', () => {
    const leaked = "Rookie and veteran FRC and FTC teams. Filip's sheet marks 3M employee involvement as required and an earlier page version said '3M-mentored'; the current page no longer states it, so confirm in the screening questions."
    expect(scrubReviewerNotes(leaked)).toBe('Rookie and veteran FRC and FTC teams.')
  })
  it('nulls a field that was only a note (W.K. Kellogg)', () => {
    expect(scrubReviewerNotes('Organisations (no individuals, capital or political grants); priority places per sheet row: Michigan, Mississippi, New Mexico, New Orleans (not verified on this page).')).toBeNull()
  })
  it('scrubListingText drops the aggregator narration (Team REV)', () => {
    const d = 'REV Robotics offers sponsorship to both rookie and veteran FTC and FRC teams. The aggregator notes indicate the current cycle is closed with no future application window listed.'
    expect(scrubListingText(d)).toBe('REV Robotics offers sponsorship to both rookie and veteran FTC and FRC teams.')
  })
  it('leaves funder prose alone', () => {
    const d = 'The Foundation does not fund individuals, capital investments, political parties, or candidates. We fund FIRST teams.'
    expect(scrubReviewerNotes(d)).toBe(d)
  })
})

describe('extraction output', () => {
  it('scrubs reviewer notes out of every public text field', () => {
    const q = 'Team Status: rookie veteran'
    const out = validateGrantExtraction(
      {
        fields: {
          summary: { value: '3M grant for rookie and veteran FRC and FTC teams. Status on the sheet: Open.' },
          description: { value: 'Supports FRC and FTC teams in the FIRST season, rookie and veteran alike. The aggregator notes four annual deadlines.' },
          eligibilityText: { value: "Rookie and veteran FRC and FTC teams. Filip's sheet marks 3M employee involvement as required.", quote: q, source: 'funder_page' },
          geographyRestriction: { value: 'Candidate classification wrongly lists Summit county.', quote: q, source: 'funder_page' },
          deadlineNote: { value: 'Per sheet row, not verified.', quote: q, source: 'funder_page' },
        },
      },
      evidence(),
    )
    expect(out.fields.summary.value).toBe('3M grant for rookie and veteran FRC and FTC teams.')
    expect(out.fields.description.value).toBe('Supports FRC and FTC teams in the FIRST season, rookie and veteran alike.')
    expect(out.fields.eligibilityText.value).toBe('Rookie and veteran FRC and FTC teams.')
    expect(out.fields.geographyRestriction.value).toBeNull()
    expect(out.fields.deadlineNote.value).toBeNull()
  })

  it('never verifies a quote against the private sheet row', () => {
    expect(verifyQuote('Must be 3M-mentored', evidence())).toBeNull()
    const out = validateGrantExtraction({ fields: { requiresEmployeeMentor: { value: 'yes', quote: 'Must be 3M-mentored', source: 'aggregator' } } }, evidence())
    expect(out.fields.requiresEmployeeMentor.value).toBe('unknown')
  })

  it('keeps the private context through the evidence limit', () => {
    expect(limitEvidence(evidence()).evidence.privateContext).toBe(SHEET_ROW)
  })
})

describe('classification output', () => {
  it('scrubs the sheet row out of the summary a reader may see', () => {
    const c = validateGrantClassification({ isGrant: true, summary: 'Grant for FRC and FTC teams from 3M, rookie or veteran. Status on the sheet: Open.' })
    expect(c.summary).toBe('Grant for FRC and FTC teams from 3M, rookie or veteran.')
  })
})
