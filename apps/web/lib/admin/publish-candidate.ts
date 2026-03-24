/**
 * Admin-initiated publish: promotes a crawl candidate to a tool record.
 * Unlike the worker pipeline version, this skips the confidence threshold
 * since the admin is explicitly approving the candidate.
 */
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  tools,
  toolLinks,
  toolPrograms,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
  toolSources,
  crawlCandidates,
  programs,
  audiencePrimaryRoles,
  audienceFunctions,
} from '@the-tool-pit/db'
import type { NewTool } from '@the-tool-pit/db'

export async function adminPublishCandidate(candidateId: string): Promise<{ toolId: string } | { error: string }> {
  const db = getDb()

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)

  if (!candidate) return { error: `Candidate ${candidateId} not found` }

  const classification = (candidate.classification ?? {}) as Record<string, unknown>
  const meta = (candidate.rawMetadata ?? {}) as Record<string, unknown>

  // Build slug from canonical URL hostname or title
  const titleBase = ((meta.title as string) ?? 'tool')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  let slug = titleBase
  let attempt = 0
  while (true) {
    const [existing] = await db
      .select({ id: tools.id })
      .from(tools)
      .where(eq(tools.slug, slug))
      .limit(1)
    if (!existing) break
    attempt++
    slug = `${titleBase}-${attempt}`
  }

  const toolData: NewTool = {
    slug,
    name: (meta.title as string) ?? 'Untitled Tool',
    summary: ((classification.summary as string) ?? (meta.description as string) ?? '').slice(0, 300) || null,
    toolType: (classification.toolType as string) ?? 'other',
    status: 'published',
    isOfficial: Boolean(classification.isOfficial),
    isVendor: Boolean(classification.isVendor),
    isRookieFriendly: Boolean(classification.isRookieFriendly),
    confidenceScore: candidate.confidenceScore ?? 0,
    freshnessState: 'unknown',
    publishedAt: new Date(),
  }

  const [newTool] = await db.insert(tools).values(toolData).returning({ id: tools.id })
  const toolId = newTool.id

  // Links
  if (candidate.canonicalUrl) {
    await db.insert(toolLinks).values({ toolId, linkType: 'homepage', url: candidate.canonicalUrl })
  }
  const githubUrl = meta.githubUrl as string | undefined
  if (githubUrl) {
    await db.insert(toolLinks).values({ toolId, linkType: 'github', url: githubUrl })
  }

  // Programs
  const programSlugs = (classification.programs as string[] | undefined) ?? []
  if (programSlugs.length > 0) {
    const programRows = await db.select({ id: programs.id }).from(programs).where(inArray(programs.slug, programSlugs))
    if (programRows.length > 0) {
      await db.insert(toolPrograms).values(programRows.map((p) => ({ toolId, programId: p.id })))
    }
  }

  // Audience roles
  const roleSlugs = (classification.audienceRoles as string[] | undefined) ?? []
  if (roleSlugs.length > 0) {
    const roleRows = await db.select({ id: audiencePrimaryRoles.id }).from(audiencePrimaryRoles).where(inArray(audiencePrimaryRoles.slug, roleSlugs))
    if (roleRows.length > 0) {
      await db.insert(toolAudiencePrimaryRoles).values(roleRows.map((r) => ({ toolId, roleId: r.id })))
    }
  }

  // Audience functions
  const fnSlugs = (classification.audienceFunctions as string[] | undefined) ?? []
  if (fnSlugs.length > 0) {
    const fnRows = await db.select({ id: audienceFunctions.id }).from(audienceFunctions).where(inArray(audienceFunctions.slug, fnSlugs))
    if (fnRows.length > 0) {
      await db.insert(toolAudienceFunctions).values(fnRows.map((f) => ({ toolId, functionId: f.id })))
    }
  }

  // Source record
  await db.insert(toolSources).values({
    toolId,
    sourceType: 'manual',
    sourceUrl: candidate.sourceUrl,
    rawMetadata: candidate.rawMetadata,
    notes: 'Admin-approved from candidate review',
  })

  // Update candidate status
  await db
    .update(crawlCandidates)
    .set({ status: 'published', matchedToolId: toolId, updatedAt: new Date() })
    .where(eq(crawlCandidates.id, candidateId))

  return { toolId }
}
