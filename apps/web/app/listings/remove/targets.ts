/**
 * The verticals the accountless outreach "remove" link handles. Kept out of
 * actions.ts because that file is `'use server'`, where every export must be an
 * async server action; this sync type guard is imported by both the action and
 * the page.
 */
export const REMOVE_TARGET_TYPES = ['event', 'field'] as const

export type RemoveTargetType = (typeof REMOVE_TARGET_TYPES)[number]

export function isRemoveTarget(type: string): type is RemoveTargetType {
  return (REMOVE_TARGET_TYPES as readonly string[]).includes(type)
}
