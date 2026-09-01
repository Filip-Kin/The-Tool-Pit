'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import {
  tools,
  toolPrograms,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
  toolLinks,
  programs,
  audiencePrimaryRoles,
  audienceFunctions,
  crawlCandidates,
  addHumanEdits,
  changedKeys,
  linkMarker,
  sameValue,
  HUMAN_EDITABLE_TOOL_KEYS,
} from '@the-tool-pit/db'
import type { EnrichJobPayload } from '@the-tool-pit/types'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

/**
 * The admin tool editor.
 *
 * WHY THIS READS THE ROW BEFORE IT WRITES IT. A crawl re-publish rewrites a
 * matched tool from its candidate, and an admin's correction being reverted by
 * a crawler is the same bug as an owner's edit being reverted. So every part of
 * this form that the re-publish can overwrite is recorded in
 * tools.human_edited_fields, and the worker skips what is in that list.
 *
 * A part is claimed by being CHANGED, not by Save being pressed. Marking the
 * whole form on every save would freeze a classifier's guess the moment anyone
 * opened the page to fix an unrelated typo, and the point of the crawl is that
 * it keeps improving whatever nobody has spoken for.
 */
/**
 * Admin notes, on their own action, because they are on their own form.
 *
 * That form posts toolId and adminNotes and nothing else. It used to post to
 * saveTool, which begins `if (!name) return`, so pressing Save Notes silently
 * did nothing and had done nothing for as long as the form existed. Removing
 * that guard would have been worse: saveTool builds its update from every field
 * on the main form, so a notes-only post would have blanked the lot.
 *
 * Notes are a moderator's private record and no crawl writes them, so there is
 * nothing here about human_edited_fields.
 */
export async function saveAdminNotes(formData: FormData) {
  await assertAdmin()

  const toolId = formData.get('toolId') as string
  if (!toolId) return

  const notes = (formData.get('adminNotes') as string)?.trim() || null

  const db = getDb()
  await db.update(tools).set({ adminNotes: notes, updatedAt: new Date() }).where(eq(tools.id, toolId))

  revalidatePath(`/admin/tools/${toolId}`)
}

export async function saveTool(formData: FormData) {
  await assertAdmin()

  const toolId = formData.get('toolId') as string
  if (!toolId) return

  const db = getDb()

  // Core fields
  const name = (formData.get('name') as string)?.trim()
  if (!name) return

  const set = {
    name,
    summary: (formData.get('summary') as string)?.trim() || null,
    description: (formData.get('description') as string)?.trim() || null,
    toolType: formData.get('toolType') as string,
    status: formData.get('status') as string,
    isOfficial: formData.get('isOfficial') === 'on',
    isVendor: formData.get('isVendor') === 'on',
    isRookieFriendly: formData.get('isRookieFriendly') === 'on',
    isTeamCode: formData.get('isTeamCode') === 'on',
    isTeamCad: formData.get('isTeamCad') === 'on',
    teamNumber: formData.get('teamNumber') ? parseInt(formData.get('teamNumber') as string, 10) : null,
    seasonYear: formData.get('seasonYear') ? parseInt(formData.get('seasonYear') as string, 10) : null,
    vendorName: (formData.get('vendorName') as string)?.trim() || null,
    freshnessState: (formData.get('freshnessState') as string) || 'unknown',
    // Editorial, not extracted. No crawl writes either of these, so neither is
    // claimable in human_edited_fields the way the fields above it are.
    isFeatured: formData.get('isFeatured') === 'on',
    featuredNote: (formData.get('featuredNote') as string)?.trim() || null,
    adminNotes: (formData.get('adminNotes') as string)?.trim() || null,
  }

  const selectedPrograms = formData.getAll('programs') as string[]
  const selectedRoles = formData.getAll('audienceRoles') as string[]
  const selectedFunctions = formData.getAll('audienceFunctions') as string[]

  // The before-state, read once. Everything below compares against it to work
  // out what this admin actually changed.
  const [before] = await db.select().from(tools).where(eq(tools.id, toolId)).limit(1)
  const beforeTaxonomy = await loadToolTaxonomy(toolId)
  const beforeLinks = await loadAdminLinks(toolId)

  const claimed = [
    ...changedKeys(set, (before ?? {}) as Record<string, unknown>, HUMAN_EDITABLE_TOOL_KEYS),
    ...changedKeys(
      { programs: selectedPrograms, audienceRoles: selectedRoles, audienceFunctions: selectedFunctions },
      beforeTaxonomy,
      ['programs', 'audienceRoles', 'audienceFunctions'],
    ),
  ]

  // Sync primary link types (homepage, github, docs, forum)
  // Delete existing entries for these types and re-insert non-empty ones
  const PRIMARY_LINK_TYPES = ['homepage', 'github', 'docs', 'forum'] as const
  for (const linkType of PRIMARY_LINK_TYPES) {
    const url = (formData.get(`link_${linkType}`) as string)?.trim() || null
    if (!sameValue(url, beforeLinks[linkType] ?? null)) claimed.push(linkMarker(linkType))
    await db
      .delete(toolLinks)
      .where(and(eq(toolLinks.toolId, toolId), eq(toolLinks.linkType, linkType)))
    if (url) {
      await db.insert(toolLinks).values({ toolId, linkType, url })
    }
  }

  const humanEditedFields = addHumanEdits(before?.humanEditedFields, claimed)

  await db
    .update(tools)
    .set({
      ...set,
      ...(humanEditedFields ? { humanEditedFields } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tools.id, toolId))

  // Sync programs (delete + re-insert)
  await db.delete(toolPrograms).where(eq(toolPrograms.toolId, toolId))
  if (selectedPrograms.length > 0) {
    const programRows = await db
      .select({ id: programs.id })
      .from(programs)
      .where(inArray(programs.slug, selectedPrograms))
    if (programRows.length > 0) {
      await db
        .insert(toolPrograms)
        .values(programRows.map((p) => ({ toolId, programId: p.id })))
    }
  }

  // Sync audience roles (delete + re-insert)
  await db.delete(toolAudiencePrimaryRoles).where(eq(toolAudiencePrimaryRoles.toolId, toolId))
  if (selectedRoles.length > 0) {
    const roleRows = await db
      .select({ id: audiencePrimaryRoles.id })
      .from(audiencePrimaryRoles)
      .where(inArray(audiencePrimaryRoles.slug, selectedRoles))
    if (roleRows.length > 0) {
      await db
        .insert(toolAudiencePrimaryRoles)
        .values(roleRows.map((r) => ({ toolId, roleId: r.id })))
    }
  }

  // Sync audience functions (delete + re-insert)
  await db.delete(toolAudienceFunctions).where(eq(toolAudienceFunctions.toolId, toolId))
  if (selectedFunctions.length > 0) {
    const fnRows = await db
      .select({ id: audienceFunctions.id })
      .from(audienceFunctions)
      .where(inArray(audienceFunctions.slug, selectedFunctions))
    if (fnRows.length > 0) {
      await db
        .insert(toolAudienceFunctions)
        .values(fnRows.map((f) => ({ toolId, functionId: f.id })))
    }
  }

  revalidatePath(`/admin/tools`)
  revalidatePath(`/admin/tools/${toolId}`)
  revalidatePath(`/tools`)
  // The home page reads tool rows now that Featured is on it, and a curator who
  // just featured something should not have to wait out its revalidate window
  // to see whether the row looks right.
  revalidatePath('/')
}

/** The slugs a tool is currently filed under, keyed the way the form posts them. */
async function loadToolTaxonomy(toolId: string): Promise<Record<string, string[]>> {
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

/**
 * One URL per link type this form owns. Newest wins, matching what the editor
 * itself shows, because tool_links has no uniqueness on (tool_id, link_type)
 * and a crawl can leave two rows of the same type behind.
 */
async function loadAdminLinks(toolId: string): Promise<Record<string, string>> {
  const db = getDb()
  const rows = await db
    .select({ linkType: toolLinks.linkType, url: toolLinks.url })
    .from(toolLinks)
    .where(eq(toolLinks.toolId, toolId))
    .orderBy(toolLinks.createdAt)
  const out: Record<string, string> = {}
  for (const r of rows) out[r.linkType] = r.url
  return out
}

export async function setToolStatus(toolId: string, status: 'published' | 'suppressed' | 'draft') {
  await assertAdmin()
  const db = getDb()
  await db
    .update(tools)
    .set({
      status,
      publishedAt: status === 'published' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, toolId))
  revalidatePath(`/admin/tools`)
  revalidatePath(`/admin/tools/${toolId}`)
}

/** Re-queue the most recent candidate for this tool through the full pipeline (rescrape + re-classify). */
export async function reClassifyTool(toolId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()

  const [candidate] = await db
    .select({ id: crawlCandidates.id })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.matchedToolId, toolId))
    .orderBy(desc(crawlCandidates.updatedAt))
    .limit(1)

  if (!candidate) {
    return { error: 'No linked candidate found for this tool' }
  }

  await db
    .update(crawlCandidates)
    .set({
      status: 'pending',
      classification: null,
      confidenceScore: null,
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(crawlCandidates.id, candidate.id))

  const queue = new Queue<EnrichJobPayload>('enrich', {
    connection: getRedis(),
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
  })
  await queue.add('enrich', { candidateId: candidate.id, rescrape: true })

  revalidatePath(`/admin/tools/${toolId}`)
  revalidatePath('/admin/candidates')
  return {}
}
