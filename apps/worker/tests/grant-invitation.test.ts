import { describe, expect, it } from 'vitest'
import { detectInvitationOnly, detectInvitationOnlyInPages, invitationPatch, invitationQuoteUrl, sentencesOf } from '../src/grants/invitation.js'
import { excludedFromMatching } from '../src/grants/matcher.js'

function onPage(quote: string, text: string): boolean {
  return sentencesOf(text).some((s) => s.includes(quote))
}

describe('detectInvitationOnly: positives', () => {
  const positives: Array<[string, string]> = [
    [
      'Hershey',
      'The Hershey Company supports organizations in our communities. Please note: you may only apply for a grant if you receive an invitation from The Hershey Company. Grants are reviewed quarterly.',
    ],
    ['unsolicited proposals', 'About us\nThe foundation does not accept unsolicited proposals.\nContact us for more information.'],
    ['by invitation only', 'Community Grants\nGrants are by invitation only.\nOur focus areas are education and safety.'],
    ['invitation-only heading', 'State Farm Community Grants\nApplications for this program are invitation-only.'],
    ['unsolicited requests not accepted', 'Unsolicited requests for funding will not be accepted or acknowledged.'],
    ['unless requested', 'Please do not submit a proposal unless requested to do so by a program officer.'],
    ['must be invited', 'Organizations must be invited to apply. Staff identify partners each year.'],
    ['only invited', 'Only organizations invited by the Foundation may submit an application.'],
    ['proposals by invitation', 'Proposals by invitation. The board meets twice a year.'],
    ['no longer accepting unsolicited', 'The Foundation is no longer accepting unsolicited grant requests.'],
  ]
  for (const [label, text] of positives) {
    it(label, () => {
      const r = detectInvitationOnly(text)
      expect(r.invitationOnly).toBe(true)
      expect(r.quote).not.toBeNull()
      expect(onPage(r.quote!, text)).toBe(true)
    })
  }

  it('quotes the Hershey sentence itself', () => {
    const r = detectInvitationOnly('Intro. Please note: you may only apply for a grant if you receive an invitation from The Hershey Company. More.')
    expect(r.quote).toBe('Please note: you may only apply for a grant if you receive an invitation from The Hershey Company.')
  })

  it('treats unsolicited letters of inquiry as closed even with LOI words in the sentence', () => {
    expect(detectInvitationOnly('We do not accept unsolicited letters of inquiry or proposals.').invitationOnly).toBe(true)
  })
})

describe('detectInvitationOnly: negatives', () => {
  const negatives: Array<[string, string]> = [
    [
      'open LOI then invited full proposal',
      'Organizations may submit a letter of intent at any time through our portal. After review, selected applicants will receive an invitation to submit a full proposal.',
    ],
    ['full proposals by invitation after open LOI', 'Submit a letter of intent through the portal. Full proposals are by invitation only.'],
    ['invited full proposal phrased with only', 'Only applicants whose letters of inquiry are approved will be invited to submit a full application.'],
    ['unsolicited proposals with LOI route', 'The foundation does not accept unsolicited proposals. Please submit a letter of inquiry through the online portal.'],
    ['unsolicited proposals with LOI in same sentence', 'We do not accept unsolicited full proposals; instead, submit a letter of inquiry.'],
    ['gala', 'Join us for an invitation-only gala celebrating our grantees.'],
    ['gala without grant words', 'Join us for an invitation-only gala.'],
    ['we invite applications', 'We invite applications from schools and nonprofits across Michigan.'],
    ['negated', 'This grant is not invitation-only; any school may apply.'],
    ['finalists invited to present', 'Applications are open to all teams. Only finalists will be invited to present to the panel.'],
    ['no invitation needed', 'No invitation is needed to apply for a mini-grant.'],
    ['empty', ''],
  ]
  for (const [label, text] of negatives) {
    it(label, () => {
      expect(detectInvitationOnly(text)).toEqual({ invitationOnly: false, quote: null })
    })
  }
})

describe('detectInvitationOnlyInPages', () => {
  it('returns the URL of the page that says it', () => {
    const r = detectInvitationOnlyInPages([
      { url: 'https://example.org/grants', text: 'We fund STEM education.' },
      { url: 'https://example.org/apply', text: 'Grants are by invitation only.' },
    ])
    expect(r).toEqual({ invitationOnly: true, quote: 'Grants are by invitation only.', url: 'https://example.org/apply' })
  })
  it('is false with no URL when no page says it', () => {
    expect(detectInvitationOnlyInPages([{ url: 'u', text: 'Apply online by March 1.' }])).toEqual({ invitationOnly: false, quote: null, url: null })
  })
})

describe('invitationQuoteUrl', () => {
  const page = 'We fund STEM.\n\nApply at: https://example.org/apply\n\nGrants are by invitation only.'
  it('attributes a quote after an Apply at marker to that page', () => {
    expect(invitationQuoteUrl(page, 'Grants are by invitation only.', 'https://example.org/')).toBe('https://example.org/apply')
  })
  it('attributes a quote before every marker to the programme page', () => {
    const p = 'Grants are by invitation only.\n\nApply at: https://example.org/apply\n\nForm.'
    expect(invitationQuoteUrl(p, 'Grants are by invitation only.', 'https://example.org/')).toBe('https://example.org/')
  })
})

describe('invitationPatch (monitor)', () => {
  const page = 'https://example.org/grants'
  const off = { invitationOnly: false, invitationProof: null, invitationProofUrl: null }
  it('sets the marker with the quote and the page when the page says it', () => {
    expect(invitationPatch(off, page, 'Grants are by invitation only.')).toEqual({
      invitationOnly: true,
      invitationProof: 'Grants are by invitation only.',
      invitationProofUrl: page,
    })
  })
  it('leaves an open grant alone', () => {
    expect(invitationPatch(off, page, 'Apply online by March 1.')).toBeNull()
  })
  it('clears the marker when this page was the proof and no longer says it', () => {
    expect(invitationPatch({ invitationOnly: true, invitationProof: 'Grants are by invitation only.', invitationProofUrl: page }, page, 'Apply online by March 1.')).toEqual(off)
  })
  it('keeps a marker proven on another page', () => {
    expect(invitationPatch({ invitationOnly: true, invitationProof: 'q', invitationProofUrl: 'https://example.org/apply' }, page, 'Apply online.')).toBeNull()
  })
  it('keeps a marker an admin set by hand with no proof URL', () => {
    expect(invitationPatch({ invitationOnly: true, invitationProof: null, invitationProofUrl: null }, page, 'Apply online.')).toBeNull()
  })
})

describe('excludedFromMatching', () => {
  it('excludes an invitation-only grant from team matches', () => {
    expect(excludedFromMatching({ invitationOnly: true })).toBe('invitation only')
  })
  it('matches an open grant', () => {
    expect(excludedFromMatching({ invitationOnly: false })).toBeNull()
  })
})
