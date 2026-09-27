import { describe, it, expect } from 'vitest'
import { claimAffordance } from '@/lib/listings/claim-affordance'

/**
 * The rule this pins is the one from packages/db/src/schema/listing-ownership.ts:
 * a claim is not proof. Nothing here grants anything, but this function decides
 * what the site OFFERS, and offering "claim this" on a listing somebody else
 * already owns is how a support ticket starts.
 *
 * It is also the only shared piece between the detail page button and the album
 * card menu, which is exactly the kind of thing that drifts back apart. A test
 * costs less than noticing the drift on a card.
 */
describe('claimAffordance', () => {
  // This used to assert null. The rule changed: a signed-out visitor who owns
  // the thing had no way to learn they could say so, so the offer is made and
  // sign-in happens on the way through.
  it('offers a signed out visitor the claim, with sign-in on the way', () => {
    const a = claimAffordance('album', 'a1', 'signed_out')
    expect(a).toEqual({
      kind: 'claim',
      label: 'Claim this listing',
      href: '/me/listings/claim?type=album&id=a1',
      signInFirst: true,
    })
  })

  it('does not ask a signed in claimant to sign in again', () => {
    const a = claimAffordance('album', 'a1', 'claimable')
    expect(a?.kind).toBe('claim')
    expect((a as { signInFirst?: boolean }).signInFirst).toBeUndefined()
  })

  it('sends both signed out and signed in claimants to the same page', () => {
    const out = claimAffordance('field', 'f9', 'signed_out')
    const inn = claimAffordance('field', 'f9', 'claimable')
    expect((out as { href: string }).href).toBe((inn as { href: string }).href)
  })

  it('offers nothing on a listing someone else owns', () => {
    expect(claimAffordance('album', 'a1', 'owned_by_other')).toBeNull()
  })

  it('sends an owner to their edit form, not to a claim they already won', () => {
    expect(claimAffordance('field', 'f1', 'owner')).toEqual({
      kind: 'edit',
      label: 'Edit your listing',
      href: '/me/listings/field/f1',
    })
  })

  it('says a claim is in review rather than asking for a second one', () => {
    expect(claimAffordance('album', 'a1', 'claim_pending')).toEqual({
      kind: 'pending',
      label: 'Claim under review',
    })
  })

  it('links an unowned listing to the claim flow, carrying type and id', () => {
    expect(claimAffordance('album', 'a1', 'claimable')).toEqual({
      kind: 'claim',
      label: 'Claim this listing',
      href: '/me/listings/claim?type=album&id=a1',
    })
  })

  it('keeps the generic label the onboarding copy tells people to look for', () => {
    // /me/listings and /me/listings/claim both say to find a control called
    // "Claim this listing". Renaming it per vertical breaks that instruction.
    for (const type of ['tool', 'album', 'field', 'event', 'grant'] as const) {
      expect(claimAffordance(type, 'x', 'claimable')).toMatchObject({ label: 'Claim this listing' })
    }
  })
})
