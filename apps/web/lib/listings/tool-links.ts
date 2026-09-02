import { and, asc, eq, inArray } from 'drizzle-orm'
import { toolLinks } from '@the-tool-pit/db'
import { getDb } from '@/lib/db'
import { EXTRA_LINK_TYPE, type ExtraLink } from '@/components/me/listing-fields'
import { planExtraLinkWrite, planIsNoop } from './extra-link-plan'

/**
 * The links an owner writes themselves: read and write, in one place.
 *
 * Shared by the owner editor (app/me/listings/actions.ts) and the admin tool
 * editor (app/admin/tools/[id]/actions.ts), because both of them now offer the
 * same repeatable list and neither is allowed to write it differently.
 *
 * They are tool_links rows with link_type 'other' and the owner's words in
 * `label`. No new table and no new column: `label` has been on tool_links since
 * the table existed and nothing had ever written it.
 *
 * The rule about which rows a save may touch is next door in
 * extra-link-plan.ts, where it is pure and tested. This file is the queries.
 */

/**
 * Every owner-written link on a tool, oldest first.
 *
 * Creation order IS the owner's order. There is no position column on
 * tool_links, and adding one to carry a hand-sorted order would mean an UPDATE
 * on rows whose URL never moved, which is the one thing the planner exists to
 * avoid. So the editor has no drag handle and does not pretend to: rows come
 * back in the order they were added.
 */
export async function loadExtraToolLinks(toolId: string): Promise<ExtraLink[]> {
  const rows = await selectExtraRows(toolId)
  return rows.map((r) => ({ label: r.label ?? '', url: r.url }))
}

function selectExtraRows(toolId: string) {
  const db = getDb()
  return db
    .select({ id: toolLinks.id, label: toolLinks.label, url: toolLinks.url })
    .from(toolLinks)
    .where(and(eq(toolLinks.toolId, toolId), eq(toolLinks.linkType, EXTRA_LINK_TYPE)))
    .orderBy(asc(toolLinks.createdAt))
}

/**
 * Write the owner-written links, touching only the rows that actually moved.
 *
 * Returns whether anything moved, so the caller can mark the link type as
 * human-edited. Removing the last link counts, which is why the marker lives on
 * tools and not on tool_links: a deletion leaves no row behind to carry a flag.
 */
export async function saveExtraToolLinks(
  toolId: string,
  next: readonly ExtraLink[],
): Promise<boolean> {
  const rows = await selectExtraRows(toolId)
  const plan = planExtraLinkWrite(rows, next)
  if (planIsNoop(plan)) return false

  const db = getDb()
  if (plan.remove.length > 0) {
    await db.delete(toolLinks).where(inArray(toolLinks.id, plan.remove))
  }
  if (plan.insert.length > 0) {
    await db.insert(toolLinks).values(
      plan.insert.map((link) => ({
        toolId,
        linkType: EXTRA_LINK_TYPE,
        url: link.url,
        // Empty is stored as NULL, not as "". The detail page falls back to the
        // generic word for the type when a row has no label, and it reads that
        // fallback off `label ?? cfg.label`.
        label: link.label || null,
      })),
    )
  }
  return true
}
