import type { ExtraLink } from '@/components/me/listing-fields'

/**
 * What a save should do to the owner-written links, worked out before it does
 * anything.
 *
 * PURE, AND ON ITS OWN, for the same reason components/me/listing-fields.ts is:
 * this is the rule that decides which rows survive a save, and it is a rule
 * about data rather than about a database. Kept here it can be tested with a
 * list of rows and a list of posted links, which is the only way to prove the
 * part that matters, and the module beside it stays a thin set of queries.
 *
 * THE RULE. The owner form autosaves on every blur, so it posts constantly.
 * Deleting and re-inserting the list each time would reset last_checked_at and
 * is_broken on links nobody edited, and those two columns are the link
 * checker's memory of where it has already been. So a stored row that is still
 * posted, with the same name and the same address, is left exactly where it is.
 * Only rows nobody asked for any more are removed, and only pairs that are not
 * already stored are inserted.
 *
 * Editing a row therefore comes out as a removal plus an insert, which is
 * right: a row whose URL changed is a different link, and nothing has checked
 * it yet.
 */

export interface StoredExtraLink {
  id: string
  /** NULL in the column means "no label", which the form holds as an empty string. */
  label: string | null
  url: string
}

export interface ExtraLinkPlan {
  /** Row ids to delete. */
  remove: string[]
  /** Pairs with no stored row of their own yet. */
  insert: ExtraLink[]
  /** Row ids that must not be touched. Carried so a test can say so out loud. */
  keep: string[]
}

/** The identity of a link. NUL cannot occur in either half, so nothing collides. */
function pairKey(label: string, url: string): string {
  return `${label}\u0000${url}`
}

export function planExtraLinkWrite(
  rows: readonly StoredExtraLink[],
  next: readonly ExtraLink[],
): ExtraLinkPlan {
  // Each stored row may be claimed by at most one posted row. A tool that
  // somehow holds the same pair twice keeps both only while both are still
  // posted, rather than one row standing in for two.
  const available = new Map<string, string[]>()
  for (const row of rows) {
    const key = pairKey(row.label ?? '', row.url)
    const bucket = available.get(key)
    if (bucket) bucket.push(row.id)
    else available.set(key, [row.id])
  }

  const kept = new Set<string>()
  const insert: ExtraLink[] = []
  for (const link of next) {
    const id = available.get(pairKey(link.label, link.url))?.shift()
    if (id) kept.add(id)
    else insert.push(link)
  }

  return {
    remove: rows.filter((r) => !kept.has(r.id)).map((r) => r.id),
    insert,
    keep: rows.filter((r) => kept.has(r.id)).map((r) => r.id),
  }
}

/** Nothing to do. Worth its own name, because it is the common case. */
export function planIsNoop(plan: ExtraLinkPlan): boolean {
  return plan.remove.length === 0 && plan.insert.length === 0
}
