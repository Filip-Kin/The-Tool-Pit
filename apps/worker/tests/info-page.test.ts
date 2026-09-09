import { describe, expect, it } from 'vitest'
import { scoreInfoResult } from '../src/grants/info-page.js'

describe('scoreInfoResult', () => {
  it('prefers the funder programme page over a homepage or a portal', () => {
    const page = scoreInfoResult({ url: 'https://www.aauw.org/resources/programs/fellowships-grants/community-action-grant/', title: 'Community Action Grants - AAUW', description: 'AAUW Community Action Grants fund projects...' }, 'American Association of University Women (AAUW)', 'Community Action Grant')
    const home = scoreInfoResult({ url: 'https://www.aauw.org/', title: 'AAUW', description: 'Empowering women since 1881' }, 'AAUW', 'Community Action Grant')
    const portal = scoreInfoResult({ url: 'https://aauw.fluxx.io/user_sessions/new', title: 'Login', description: '' }, 'AAUW', 'Community Action Grant')
    expect(page).toBeGreaterThanOrEqual(4)
    expect(home).toBe(0)
    expect(portal).toBe(0)
  })
  it('does not take a list on firstinspires.org as the funder page', () => {
    expect(scoreInfoResult({ url: 'https://www.firstinspires.org/programs/team-grant-opportunities', title: 'Team Grant Opportunities', description: 'John Deere FIRST Team Grant...' }, 'John Deere', 'John Deere FIRST Team Grant')).toBe(0)
  })
})
