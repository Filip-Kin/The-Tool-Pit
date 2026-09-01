import type { ClaimStatus, ListingEntityType, ListingOwnerRole } from '@the-tool-pit/db'

/**
 * User-facing wording for the listing-ownership UI. Kept in one place so the
 * /me pages and the edit forms never drift on what a "field" or a "pending"
 * claim is called.
 */

const ENTITY_NOUNS: Record<ListingEntityType, string> = {
  tool: 'Tool',
  album: 'Photo album',
  field: 'Practice field',
  event: 'Off-season event',
  grant: 'Grant',
}

export function entityNoun(type: ListingEntityType): string {
  return ENTITY_NOUNS[type]
}

const ROLE_LABELS: Record<ListingOwnerRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export function roleLabel(role: ListingOwnerRole): string {
  return ROLE_LABELS[role]
}

/** How a pending claim is being (or was) checked, in plain words. */
export function methodLabel(method: string): string {
  switch (method) {
    case 'self_submitted':
      return 'Your own submission'
    case 'repo_file':
      return 'Repository file check'
    case 'domain_email':
      return 'Email domain'
    case 'invite':
      return 'Invite link'
    case 'admin':
      return 'Admin decision'
    case 'manual_review':
      return 'Waiting for review'
    default:
      return method
  }
}

export function claimStatusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting for review'
    case 'verified':
      return 'Verified'
    case 'rejected':
      return 'Not approved'
    default:
      return status
  }
}
