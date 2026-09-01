import { eq, inArray, asc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  audienceFunctions,
  audiencePrimaryRoles,
  programs,
  toolAudienceFunctions,
  toolAudiencePrimaryRoles,
  toolPrograms,
} from '@the-tool-pit/db'
import { TOOL_TAG_KEYS, type ToolTagKey } from '@/components/me/listing-fields'

/**
 * The three taxonomies on a tool: reading them, and writing them back.
 *
 * WHY THIS FILE. programs, audience roles and audience functions are the tags
 * that decide where a tool turns up in the directory, and until now only an
 * admin could set them. Giving them to the owner meant a fourth copy of the
 * same delete-and-re-insert triple (app/admin/tools/[id]/actions.ts and
 * lib/admin/publish-candidate.ts already hold one each), so it is written once
 * here instead and the owner save action calls it.
 *
 * THE OPTIONS COME FROM THE DATABASE, not from a constant. The slugs and their
 * labels are seed rows, and the app already carries three hand-written copies
 * of the role and function lists that have drifted apart (the admin editor and
 * the search filters disagree about whether it is "Team Management" or "Team
 * Mgmt", and the filter list is missing three functions outright). A fourth
 * copy would be a fourth thing to keep in step, so the owner form reads the
 * rows and shows what they say.
 *
 * Values are SLUGS everywhere above the database, because that is what the
 * admin editor already posts and what the classifier already emits. Ids never
 * leave this file.
 */

// #region shape

/** One choice in a tag picker. */
export interface TagOption {
  value: string
  label: string
}

/** The choices for every tag field on a form, by field key. */
export type TaxonomyOptions = Partial<Record<ToolTagKey, readonly TagOption[]>>

/** A tool's current tags, by form key. Always all three keys, possibly empty. */
export type ToolTaxonomy = Record<ToolTagKey, string[]>

// #endregion

// #region reading

/**
 * Every choice a tool owner may pick, in the order the rows are stored.
 *
 * `programs` has no label column of its own worth showing: its `name` is the
 * short form people actually say (FRC, FTC, FLL), and its `description` is the
 * long one, so the picker shows the name.
 */
export async function taxonomyOptions(): Promise<TaxonomyOptions> {
  const db = getDb()
  const [programRows, roleRows, functionRows] = await Promise.all([
    db.select({ value: programs.slug, label: programs.name }).from(programs).orderBy(asc(programs.id)),
    db
      .select({ value: audiencePrimaryRoles.slug, label: audiencePrimaryRoles.label })
      .from(audiencePrimaryRoles)
      .orderBy(asc(audiencePrimaryRoles.id)),
    db
      .select({ value: audienceFunctions.slug, label: audienceFunctions.label })
      .from(audienceFunctions)
      .orderBy(asc(audienceFunctions.id)),
  ])
  return { programs: programRows, audienceRoles: roleRows, audienceFunctions: functionRows }
}

/** The slugs a tool currently carries, by form key. */
export async function loadToolTaxonomy(toolId: string): Promise<ToolTaxonomy> {
  const db = getDb()
  const [programRows, roleRows, functionRows] = await Promise.all([
    db
      .select({ slug: programs.slug })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(eq(toolPrograms.toolId, toolId)),
    db
      .select({ slug: audiencePrimaryRoles.slug })
      .from(toolAudiencePrimaryRoles)
      .innerJoin(audiencePrimaryRoles, eq(audiencePrimaryRoles.id, toolAudiencePrimaryRoles.roleId))
      .where(eq(toolAudiencePrimaryRoles.toolId, toolId)),
    db
      .select({ slug: audienceFunctions.slug })
      .from(toolAudienceFunctions)
      .innerJoin(audienceFunctions, eq(audienceFunctions.id, toolAudienceFunctions.functionId))
      .where(eq(toolAudienceFunctions.toolId, toolId)),
  ])
  return {
    programs: programRows.map((r) => r.slug),
    audienceRoles: roleRows.map((r) => r.slug),
    audienceFunctions: functionRows.map((r) => r.slug),
  }
}

// #endregion

// #region writing

/**
 * Store a tool's tags, one taxonomy at a time, touching only what moved.
 *
 * Returns the form keys that actually changed, so the caller can mark them in
 * tools.human_edited_fields. That marker is what stops the worker's re-publish
 * deleting and re-inserting these three join tables on the next crawl and
 * reverting the owner's filing; see packages/db/src/human-edited.ts and
 * apps/worker/src/pipeline/publish.ts.
 *
 * A taxonomy whose set is unchanged is not deleted and re-inserted. Rewriting
 * it would be harmless in the rows it leaves behind, but it would also claim
 * the key on an autosave that changed nothing, and a claim earned by pressing
 * nothing locks the classifier out of a tool forever.
 *
 * Unknown slugs are dropped rather than refused. Everything above this point
 * already validated against the same rows the picker was built from, so a slug
 * that is not in the table came from a hand-posted form, and there is nothing
 * to tell the user about it that is not "stop that".
 */
export async function saveToolTaxonomy(
  toolId: string,
  current: ToolTaxonomy,
  next: Partial<ToolTaxonomy>,
): Promise<ToolTagKey[]> {
  const db = getDb()
  const changed: ToolTagKey[] = []

  for (const key of TOOL_TAG_KEYS) {
    const wanted = next[key]
    if (wanted === undefined || sameSet(current[key], wanted)) continue

    // Written out per taxonomy rather than through a table of tables. Drizzle's
    // insert types are per-table, so a shared loop would need a cast at exactly
    // the point where a wrong column name has to be caught.
    const slugs = [...wanted]
    if (key === 'programs') {
      await db.delete(toolPrograms).where(eq(toolPrograms.toolId, toolId))
      const rows = slugs.length
        ? await db.select({ id: programs.id }).from(programs).where(inArray(programs.slug, slugs))
        : []
      if (rows.length > 0) {
        await db.insert(toolPrograms).values(rows.map((r) => ({ toolId, programId: r.id })))
      }
    } else if (key === 'audienceRoles') {
      await db.delete(toolAudiencePrimaryRoles).where(eq(toolAudiencePrimaryRoles.toolId, toolId))
      const rows = slugs.length
        ? await db
            .select({ id: audiencePrimaryRoles.id })
            .from(audiencePrimaryRoles)
            .where(inArray(audiencePrimaryRoles.slug, slugs))
        : []
      if (rows.length > 0) {
        await db.insert(toolAudiencePrimaryRoles).values(rows.map((r) => ({ toolId, roleId: r.id })))
      }
    } else {
      await db.delete(toolAudienceFunctions).where(eq(toolAudienceFunctions.toolId, toolId))
      const rows = slugs.length
        ? await db
            .select({ id: audienceFunctions.id })
            .from(audienceFunctions)
            .where(inArray(audienceFunctions.slug, slugs))
        : []
      if (rows.length > 0) {
        await db.insert(toolAudienceFunctions).values(rows.map((r) => ({ toolId, functionId: r.id })))
      }
    }
    changed.push(key)
  }

  return changed
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((v, i) => v === right[i])
}

// #endregion
