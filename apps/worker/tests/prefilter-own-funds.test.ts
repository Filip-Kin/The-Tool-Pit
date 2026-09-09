import { describe, expect, it } from 'vitest'
import { deterministicGrantPrefilter } from '../src/grants/prefilter.js'

describe('prefilter: a team\'s own money is not a grant', () => {
  it('rejects the FIRST regrant process', () => {
    const v = deterministicGrantPrefilter({ url: 'https://www.firstinspires.org/regrant-process-procedures-and-w9', title: 'Regrant Process, Procedures and W-9', body: 'Any unused funds remaining in team accounts after the current fiscal year. Teams must submit a formal regrant request by June 30.', discoveredVia: 'seed:x' })
    expect(v.keep).toBe(false)
    expect(v.reason).toContain('already has')
  })
  it('keeps a real grant that mentions reimbursement in passing', () => {
    const v = deterministicGrantPrefilter({ url: 'https://example.org/grants/robotics-team-grant', title: 'Robotics Team Grant', body: 'Grants of up to $5,000. Apply by October 1. Eligibility: FRC teams. Funds are paid as a reimbursement after receipts are submitted.', discoveredVia: 'seed:x' })
    expect(v.keep).toBe(true)
  })
})
