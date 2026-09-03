/**
 * The email categories a signed-in reader can turn off, and which kind falls in
 * which.
 *
 * ZERO node imports, like the rest of this folder: it is pure data and a lookup,
 * imported by the settings page, the worker drain and a test alike. The signing
 * and the suppression store are NOT here, they live in @the-tool-pit/db where
 * the secret and the crypto are; this module only names the categories and maps
 * kinds onto them.
 *
 * WHY CATEGORIES AND NOT ONE SWITCH PER KIND. There are twenty-odd approval
 * kinds and nobody wants a settings page with twenty toggles. A reader thinks in
 * "tell me when my listing changes" and "tell me about claims", not in
 * `event_removed` versus `field_rejected`, so the kinds are grouped into a
 * handful of categories and the toggle is per category.
 *
 * Outreach is deliberately NOT here. It goes to a scraped public contact who has
 * no account and no settings page, so there is nothing for a per-user category
 * to gate: the only control that reaches it is the global unsubscribe, which is
 * accountless by design.
 */
import type { ApprovalEmailKind } from './approvals'

// #region categories

/** A category a reader can switch off in /me/notifications. */
export type ListingEmailCategory = 'listing_outcome' | 'listing_claim' | 'listing_invite'

export interface ListingEmailCategoryMeta {
  id: ListingEmailCategory
  /** The heading on the settings row. */
  label: string
  /** One line under it, saying what turning it off stops. */
  description: string
}

/**
 * The categories the settings page renders, in order.
 *
 * The strings are UI, not a contract: rename freely. The ids ARE persisted (one
 * row per muted category), so treat those like the kind strings: add, never
 * rename.
 */
export const LISTING_EMAIL_CATEGORIES: ListingEmailCategoryMeta[] = [
  {
    id: 'listing_outcome',
    label: 'Listing updates',
    description:
      'When something you submitted is published, an edit you suggested is applied, or a listing is taken down.',
  },
  {
    id: 'listing_claim',
    label: 'Claims',
    description: 'When a claim you filed on a listing is approved or declined.',
  },
  {
    id: 'listing_invite',
    label: 'Invitations',
    description: 'When someone invites you to help manage a listing.',
  },
]

// #endregion

// #region kind -> category

/**
 * Which category an email kind belongs to, or null when nothing gates it.
 *
 * Null means "always send unless the address is globally unsubscribed": that is
 * the outreach kind, which has no account behind it, and any kind this does not
 * recognise (a newer deploy, the yearly renewal ask), because silently dropping
 * an email nobody chose to mute is the wrong default.
 *
 * Takes a plain string, not ApprovalEmailKind, because the drain hands it
 * whatever is on the row, including kinds this package does not define.
 */
export function emailCategoryForKind(kind: string): ListingEmailCategory | null {
  if (kind === 'listing_outreach') return null
  if (kind === 'claim_approved' || kind === 'claim_rejected') return 'listing_claim'
  if (kind === 'listing_invite') return 'listing_invite'

  const outcomeKinds: ApprovalEmailKind[] = [
    'field_published',
    'field_edit_applied',
    'event_published',
    'tool_published',
    'album_published',
    'grant_published',
    'field_rejected',
    'field_removed',
    'event_rejected',
    'event_removed',
    'tool_rejected',
    'tool_removed',
    'album_rejected',
    'album_removed',
    'grant_rejected',
    'grant_removed',
    'submission_rejected',
    'field_edit_rejected',
  ]
  if ((outcomeKinds as string[]).includes(kind)) return 'listing_outcome'

  return null
}

// #endregion
