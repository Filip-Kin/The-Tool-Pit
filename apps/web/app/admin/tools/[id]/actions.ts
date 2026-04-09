'use server'

import { cookies } from 'next/headers'
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
} from '@the-tool-pit/db'
import type { EnrichJobPayload } from '@the-tool-pit/types'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

export async function saveTool(formData: FormData) {
  await assertAdmin()

  const toolId = formData.get('toolId') as string
  if (!toolId) return

  const db = getDb()

  // Core fields
  const name = (formData.get('name') as string)?.trim()
  if (!name) return

  await db
    .update(tools)
    .set({
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
      adminNotes: (formData.get('adminNotes') as string)?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, toolId))

  // Sync programs (delete + re-insert)
  const selectedPrograms = formData.getAll('programs') as string[]
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
  const selectedRoles = formData.getAll('audienceRoles') as string[]
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
  const selectedFunctions = formData.getAll('audienceFunctions') as string[]
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

  // Sync primary link types (homepage, github, docs, forum)
  // Delete existing entries for these types and re-insert non-empty ones
  const PRIMARY_LINK_TYPES = ['homepage', 'github', 'docs', 'forum'] as const
  for (const linkType of PRIMARY_LINK_TYPES) {
    const url = (formData.get(`link_${linkType}`) as string)?.trim()
    await db
      .delete(toolLinks)
      .where(and(eq(toolLinks.toolId, toolId), eq(toolLinks.linkType, linkType)))
    if (url) {
      await db.insert(toolLinks).values({ toolId, linkType, url })
    }
  }

  revalidatePath(`/admin/tools`)
  revalidatePath(`/admin/tools/${toolId}`)
  revalidatePath(`/tools`)
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
