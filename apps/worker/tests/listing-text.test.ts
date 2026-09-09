import { describe, expect, it } from 'vitest'
import { scrubNarration, narrationIn } from '@the-tool-pit/db/listing-text'
import { isEntranceUrl } from '@the-tool-pit/db/grant-urls'

describe('scrubNarration', () => {
  it('drops sentences about the page and keeps the grant', () => {
    const s = 'Honda funds STEM programs for youth in 17 states. The page is an application eligibility quiz within the CyberGrants portal. Award amounts are not stated in the available metadata.'
    expect(scrubNarration(s)).toBe('Honda funds STEM programs for youth in 17 states.')
    expect(narrationIn(s)).toHaveLength(2)
  })
  it('returns null when nothing about the grant survives', () => {
    expect(scrubNarration('This page describes the login. It appears to be a portal.')).toBeNull()
  })
  it('leaves a plain description alone', () => {
    const s = 'Grants of $500 to $2,000 for robotics teams in Wyoming. Apply by 15 September.'
    expect(scrubNarration(s)).toBe(s)
  })
})

describe('isEntranceUrl', () => {
  it('knows a portal, a login, a form and a PDF from a programme page', () => {
    expect(isEntranceUrl('https://aauw.fluxx.io/user_sessions/new')).toBe(true)
    expect(isEntranceUrl('https://www.cybergrants.com/pls/cybergrants/quiz.display_question?x_gm_id=2587&x_quiz_id=1338')).toBe(true)
    expect(isEntranceUrl('https://docs.google.com/forms/d/e/1FAIpQLSe/viewform')).toBe(true)
    expect(isEntranceUrl('https://www.ni.com/pdf/forms/us/grant-request-application.pdf')).toBe(true)
    expect(isEntranceUrl('https://www.aauw.org/resources/programs/fellowships-grants/community-action-grant/')).toBe(false)
    expect(isEntranceUrl('https://csr.honda.com/funding')).toBe(false)
    expect(isEntranceUrl('https://docs.google.com/document/d/abc/edit')).toBe(false)
  })
})
