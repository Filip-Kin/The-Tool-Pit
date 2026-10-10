import { describe, expect, it } from 'vitest'
import {
  confirmInvitationOnly,
  detectInvitationOnly,
  detectInvitationOnlyInPages,
  findInvitationCandidates,
  invitationPatch,
  invitationQuoteUrl,
  readInvitationForIntake,
  sentencesOf,
  type InvitationConfirmation,
  type InvitationModel,
} from '../src/grants/invitation.js'
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
      expect(detectInvitationOnly(text)).toEqual({ invitationOnly: false, quote: null, context: null })
    })
  }
})

describe('detectInvitationOnlyInPages', () => {
  it('returns the URL of the page that says it', () => {
    const r = detectInvitationOnlyInPages([
      { url: 'https://example.org/grants', text: 'We fund STEM education.' },
      { url: 'https://example.org/apply', text: 'Grants are by invitation only.' },
    ])
    expect(r).toMatchObject({ invitationOnly: true, quote: 'Grants are by invitation only.', url: 'https://example.org/apply' })
  })
  it('is false with no URL when no page says it', () => {
    expect(detectInvitationOnlyInPages([{ url: 'u', text: 'Apply online by March 1.' }])).toEqual({ invitationOnly: false, quote: null, context: null, url: null })
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

describe('invitationPatch (monitor, stubbed model)', () => {
  const page = 'https://example.org/grants'
  const off = { invitationOnly: false, invitationProof: null, invitationProofUrl: null }
  const yes = (quote: string): InvitationConfirmation => ({ invitationOnly: true, quote, url: page, reason: 'covers it' })
  const no: InvitationConfirmation = { invitationOnly: false, quote: null, url: null, reason: 'another focus area' }
  function confirmer(verdict: InvitationConfirmation) {
    const calls: number[] = []
    return { calls, fn: async (c: unknown[]) => (calls.push(c.length), verdict) }
  }

  it('sets the marker on a confirmed yes, with the quote and the page', async () => {
    const c = confirmer(yes('Grants are by invitation only.'))
    expect(await invitationPatch(off, page, 'Grants are by invitation only.', c.fn)).toEqual({
      invitationOnly: true,
      invitationProof: 'Grants are by invitation only.',
      invitationProofUrl: page,
    })
    expect(c.calls).toEqual([1])
  })
  it('does not set the marker when the model says the sentence is about something else', async () => {
    const c = confirmer(no)
    expect(await invitationPatch(off, page, 'Other types of funding is by invitation only.', c.fn)).toBeNull()
    expect(c.calls).toEqual([1])
  })
  it('makes no model call on a page with no candidate', async () => {
    const c = confirmer(yes('x'))
    expect(await invitationPatch(off, page, 'Apply online by March 1.', c.fn)).toBeNull()
    expect(c.calls).toEqual([])
  })
  it('clears a marker proven on this page when the page no longer has a candidate, without a model call', async () => {
    const c = confirmer(yes('x'))
    expect(await invitationPatch({ invitationOnly: true, invitationProof: 'q', invitationProofUrl: page }, page, 'Apply online by March 1.', c.fn)).toEqual(off)
    expect(c.calls).toEqual([])
  })
  it('clears a marker proven on this page when the model says it no longer applies', async () => {
    const c = confirmer(no)
    expect(await invitationPatch({ invitationOnly: true, invitationProof: 'q', invitationProofUrl: page }, page, 'Other types of funding is by invitation only.', c.fn)).toEqual(off)
  })
  it('keeps a marker proven on another page, without a model call', async () => {
    const c = confirmer(no)
    expect(await invitationPatch({ invitationOnly: true, invitationProof: 'q', invitationProofUrl: 'https://example.org/apply' }, page, 'Grants are by invitation only.', c.fn)).toBeNull()
    expect(c.calls).toEqual([])
  })
  it('keeps a marker an admin set by hand, without a model call', async () => {
    const c = confirmer(no)
    expect(await invitationPatch({ invitationOnly: true, invitationProof: null, invitationProofUrl: null }, page, 'Grants are by invitation only.', c.fn)).toBeNull()
    expect(c.calls).toEqual([])
  })
  it('leaves the marker alone when the model call throws', async () => {
    const boom = async () => {
      throw new Error('rate limited')
    }
    await expect(invitationPatch(off, page, 'Grants are by invitation only.', boom)).rejects.toThrow('rate limited')
  })
})

describe('confirmInvitationOnly (stubbed model)', () => {
  const candidates = findInvitationCandidates([
    {
      url: 'https://example.org/grants',
      text: 'Grant applications for two of our Focus Areas (Strong Nonprofit Community and Building Community & Opportunity) are by invitation only. Grants are by invitation only.',
    },
  ])
  const base = { grantName: 'Education Grants', funderName: 'Example Foundation', applicationUrl: null, infoUrl: 'https://example.org/grants' }

  it('makes no model call with no candidates', async () => {
    let called = false
    const model: InvitationModel = async () => ((called = true), '{}')
    const r = await confirmInvitationOnly({ ...base, candidates: [] }, model)
    expect(r.invitationOnly).toBe(false)
    expect(called).toBe(false)
  })
  it('quotes the sentence the model names, verbatim from the page', async () => {
    let prompt = ''
    const model: InvitationModel = async (_s, u) => ((prompt = u), '{"invitationOnly": true, "sentence": 2, "reason": "covers the whole programme"}')
    const r = await confirmInvitationOnly({ ...base, candidates }, model)
    expect(r).toEqual({ invitationOnly: true, quote: 'Grants are by invitation only.', url: 'https://example.org/grants', reason: 'covers the whole programme' })
    expect(prompt).toContain('Sentence 1')
    expect(prompt).toContain('Sentence 2')
    expect(prompt).toContain('Listed programme: Education Grants')
  })
  it('is false when the model says so', async () => {
    const model: InvitationModel = async () => '{"invitationOnly": false, "sentence": 1, "reason": "other focus areas"}'
    expect(await confirmInvitationOnly({ ...base, candidates }, model)).toEqual({ invitationOnly: false, quote: null, url: null, reason: 'other focus areas' })
  })
  it('is false when the model says yes but names no sentence it was shown', async () => {
    const model: InvitationModel = async () => '{"invitationOnly": true, "sentence": 9, "reason": "x"}'
    expect((await confirmInvitationOnly({ ...base, candidates }, model)).invitationOnly).toBe(false)
  })
  it('throws on a reply with no JSON', async () => {
    const model: InvitationModel = async () => 'I think so'
    await expect(confirmInvitationOnly({ ...base, candidates }, model)).rejects.toThrow('no JSON')
  })
})

describe('readInvitationForIntake (stubbed model)', () => {
  it('attributes the confirmed sentence to the followed apply page', async () => {
    const model: InvitationModel = async () => '{"invitationOnly": true, "sentence": 1, "reason": "covers it"}'
    const r = await readInvitationForIntake(
      {
        grantName: 'G',
        funderName: 'F',
        applicationUrl: 'https://example.org/apply',
        infoUrl: 'https://example.org/',
        funderPage: 'We fund STEM.\n\nApply at: https://example.org/apply\n\nGrants are by invitation only.',
        firstUrl: 'https://example.org/',
      },
      model,
      new Date('2026-10-10T00:00:00Z'),
    )
    expect(r).toEqual({ invitationOnly: true, quote: 'Grants are by invitation only.', url: 'https://example.org/apply', reason: 'covers it', checkedAt: '2026-10-10T00:00:00.000Z' })
  })
})

describe('detector: the 12 dry-run sentences are all candidates', () => {
  // Verbatim where the 2026-10 dry run quoted them; toyota, arconic and te
  // were described, not quoted, so those three are written in the same shape.
  const sentences: Array<[string, string]> = [
    ['rockwell (correct)', 'Grants are by invitation only.'],
    ['hershey (correct)', 'Please note: you may only apply for a grant if you receive an invitation from The Hershey Company.'],
    ['state farm (correct)', 'State Farm charitable funding is offered through an invitation only process each year.'],
    ['broward', 'Grant applications for two of our Focus Areas (Strong Nonprofit Community and Building Community & Opportunity) are by invitation only.'],
    ['les paul', 'Other types of funding is by invitation only.'],
    ['daniels', 'The Daniels Fund also supports select programs with a nationwide focus by invitation only.'],
    ['honda', 'In some cases, Honda may extend invitation-only opportunities to select community partners.'],
    ['american savings', '* with very few exceptions considered by invitation only'],
    ['rtx', 'Our standard grants are larger, invite-only donations to long-standing partners.'],
    ['toyota (paraphrase)', 'Grants to Plano-area entities and PEMC are now by invitation only.'],
    ['arconic (paraphrase)', 'Arconic Foundation general grants are by invitation only.'],
    ['te (paraphrase)', 'TE Connectivity corporate partnership grants are by invitation only.'],
  ]
  for (const [label, sentence] of sentences) {
    it(label, () => {
      const r = detectInvitationOnly(`Some intro text about the funder.\n${sentence}\nMore text follows here.`)
      expect(r.invitationOnly).toBe(true)
      expect(r.quote).toBe(sentence)
      expect(r.context).toContain('Some intro text')
      expect(r.context).toContain('More text follows')
    })
  }
})

describe('excludedFromMatching', () => {
  it('excludes an invitation-only grant from team matches', () => {
    expect(excludedFromMatching({ invitationOnly: true })).toBe('invitation only')
  })
  it('matches an open grant', () => {
    expect(excludedFromMatching({ invitationOnly: false })).toBeNull()
  })
})
