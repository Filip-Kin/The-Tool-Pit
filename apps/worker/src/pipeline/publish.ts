/**
 * Publishing stage: if a candidate has sufficient confidence,
 * create or update a tool record in the database.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
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

/** Confidence threshold to auto-publish (0.0–1.0) */
const PUBLISH_THRESHOLD = 0.7

/** Build a URL-safe slug from a raw title string. Pure function — does not check uniqueness. */
export function buildSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
}

export interface PublishResult {
  toolId: string
  action: 'created' | 'updated' | 'skipped'
  reason?: string
}

export async function publishCandidate(candidateId: string, sourceType = 'manual'): Promise<PublishResult> {
  const db = getDb()

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)

  if (!candidate) throw new Error(`Candidate ${candidateId} not found`)

  const confidence = candidate.confidenceScore ?? 0
  const classification = (candidate.classification ?? {}) as Record<string, unknown>

  if (confidence < PUBLISH_THRESHOLD) {
    return {
      toolId: '',
      action: 'skipped',
      reason: `Confidence ${confidence.toFixed(2)} below threshold ${PUBLISH_THRESHOLD}`,
    }
  }

  const meta = (candidate.rawMetadata ?? {}) as Record<string, unknown>

  // summary ≤ 300 chars; description gets the full text when longer
  const rawSummary = (classification.summary as string) ?? (meta.description as string) ?? ''
  const rawDescription = (meta.description as string) ?? ''
  const summary = rawSummary.slice(0, 300) || null
  const description = rawDescription.length > 300 ? rawDescription : null

  // If this candidate already maps to a tool, update it rather than creating a duplicate.
  if (candidate.matchedToolId) {
    const existingToolId = candidate.matchedToolId
    await db.transaction(async (tx) => {
      await tx
        .update(tools)
        .set({
          name: (meta.title as string) ?? 'Untitled Tool',
          summary,
          description,
          toolType: (classification.toolType as string) ?? 'other',
          isOfficial: Boolean(classification.isOfficial),
          isVendor: Boolean(classification.isVendor),
          isRookieFriendly: Boolean(classification.isRookieFriendly),
          isTeamCode: Boolean(classification.isTeamCode),
          isTeamCad: Boolean(classification.isTeamCad),
          teamNumber: typeof classification.teamNumber === 'number' ? classification.teamNumber : null,
          seasonYear: typeof classification.seasonYear === 'number' ? classification.seasonYear : null,
          githubStars: typeof meta.githubStars === 'number' ? meta.githubStars : 0,
          chiefDelphiLikes: typeof meta.chiefDelphiLikes === 'number' ? meta.chiefDelphiLikes : 0,
          popularityScore: (typeof meta.githubStars === 'number' ? meta.githubStars : 0) +
                           (typeof meta.chiefDelphiLikes === 'number' ? meta.chiefDelphiLikes : 0),
          confidenceScore: confidence,
          updatedAt: new Date(),
        })
        .where(eq(tools.id, existingToolId))

      // Sync links: delete auto-managed types and re-insert
      const AUTO_LINK_TYPES = ['homepage', 'github', 'forum'] as const
      for (const linkType of AUTO_LINK_TYPES) {
        await tx.delete(toolLinks).where(
          and(eq(toolLinks.toolId, existingToolId), eq(toolLinks.linkType, linkType)),
        )
      }
      if (candidate.canonicalUrl) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'homepage', url: candidate.canonicalUrl })
      }
      const githubUrlUpd = meta.githubUrl as string | undefined
      if (githubUrlUpd) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'github', url: githubUrlUpd })
      }
      if (candidate.sourceUrl?.includes('chiefdelphi.com')) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'forum', url: candidate.sourceUrl })
      }

      // Sync programs
      await tx.delete(toolPrograms).where(eq(toolPrograms.toolId, existingToolId))
      const programSlugsUpd = (classification.programs as string[] | undefined) ?? []
      if (programSlugsUpd.length > 0) {
        const programRows = await tx.select({ id: programs.id }).from(programs).where(inArray(programs.slug, programSlugsUpd))
        if (programRows.length > 0) {
          await tx.insert(toolPrograms).values(programRows.map((p) => ({ toolId: existingToolId, programId: p.id })))
        }
      }

      // Sync audience roles
      await tx.delete(toolAudiencePrimaryRoles).where(eq(toolAudiencePrimaryRoles.toolId, existingToolId))
      const audienceRoleSlugsUpd = (classification.audienceRoles as string[] | undefined) ?? []
      if (audienceRoleSlugsUpd.length > 0) {
        const roleRows = await tx.select({ id: audiencePrimaryRoles.id }).from(audiencePrimaryRoles).where(inArray(audiencePrimaryRoles.slug, audienceRoleSlugsUpd))
        if (roleRows.length > 0) {
          await tx.insert(toolAudiencePrimaryRoles).values(roleRows.map((r) => ({ toolId: existingToolId, roleId: r.id })))
        }
      }

      // Sync audience functions
      await tx.delete(toolAudienceFunctions).where(eq(toolAudienceFunctions.toolId, existingToolId))
      const audienceFunctionSlugsUpd = (classification.audienceFunctions as string[] | undefined) ?? []
      if (audienceFunctionSlugsUpd.length > 0) {
        const functionRows = await tx.select({ id: audienceFunctions.id }).from(audienceFunctions).where(inArray(audienceFunctions.slug, audienceFunctionSlugsUpd))
        if (functionRows.length > 0) {
          await tx.insert(toolAudienceFunctions).values(functionRows.map((f) => ({ toolId: existingToolId, functionId: f.id })))
        }
      }

      // Mark candidate as published
      await tx
        .update(crawlCandidates)
        .set({ status: 'published', updatedAt: new Date() })
        .where(eq(crawlCandidates.id, candidateId))
    })

    return { toolId: existingToolId, action: 'updated' }
  }

  // --- New tool path ---

  // Build a URL-safe slug from the title
  const titleBase = buildSlug((meta.title as string) ?? 'tool')

  // Ensure uniqueness (checked outside transaction to avoid long locks)
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
    summary,
    description,
    toolType: (classification.toolType as string) ?? 'other',
    status: 'published',
    isOfficial: Boolean(classification.isOfficial),
    isVendor: Boolean(classification.isVendor),
    isRookieFriendly: Boolean(classification.isRookieFriendly),
    isTeamCode: Boolean(classification.isTeamCode),
    isTeamCad: Boolean(classification.isTeamCad),
    teamNumber: typeof classification.teamNumber === 'number' ? classification.teamNumber : null,
    seasonYear: typeof classification.seasonYear === 'number' ? classification.seasonYear : null,
    githubStars: typeof meta.githubStars === 'number' ? meta.githubStars : 0,
    chiefDelphiLikes: typeof meta.chiefDelphiLikes === 'number' ? meta.chiefDelphiLikes : 0,
    popularityScore: (typeof meta.githubStars === 'number' ? meta.githubStars : 0) +
                     (typeof meta.chiefDelphiLikes === 'number' ? meta.chiefDelphiLikes : 0),
    confidenceScore: confidence,
    freshnessState: 'unknown',
    publishedAt: new Date(),
  }

  const toolId = await db.transaction(async (tx) => {
    const [newTool] = await tx.insert(tools).values(toolData).returning({ id: tools.id })

    // Insert primary link
    if (candidate.canonicalUrl) {
      await tx.insert(toolLinks).values({
        toolId: newTool.id,
        linkType: 'homepage',
        url: candidate.canonicalUrl,
      })
    }

    // Insert GitHub link if present
    const githubUrl = meta.githubUrl as string | undefined
    if (githubUrl) {
      await tx.insert(toolLinks).values({
        toolId: newTool.id,
        linkType: 'github',
        url: githubUrl,
      })
    }

    // Insert Chief Delphi thread link if this candidate was discovered via a CD post
    if (candidate.sourceUrl?.includes('chiefdelphi.com')) {
      await tx.insert(toolLinks).values({
        toolId: newTool.id,
        linkType: 'forum',
        url: candidate.sourceUrl,
      })
    }

    // Link programs
    const programSlugs = (classification.programs as string[] | undefined) ?? []
    if (programSlugs.length > 0) {
      const programRows = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(inArray(programs.slug, programSlugs))

      if (programRows.length > 0) {
        await tx
          .insert(toolPrograms)
          .values(programRows.map((p) => ({ toolId: newTool.id, programId: p.id })))
      }
    }

    // Link audience primary roles
    const audienceRoleSlugs = (classification.audienceRoles as string[] | undefined) ?? []
    if (audienceRoleSlugs.length > 0) {
      const roleRows = await tx
        .select({ id: audiencePrimaryRoles.id })
        .from(audiencePrimaryRoles)
        .where(inArray(audiencePrimaryRoles.slug, audienceRoleSlugs))

      if (roleRows.length > 0) {
        await tx
          .insert(toolAudiencePrimaryRoles)
          .values(roleRows.map((r) => ({ toolId: newTool.id, roleId: r.id })))
      }
    }

    // Link audience functions
    const audienceFunctionSlugs = (classification.audienceFunctions as string[] | undefined) ?? []
    if (audienceFunctionSlugs.length > 0) {
      const functionRows = await tx
        .select({ id: audienceFunctions.id })
        .from(audienceFunctions)
        .where(inArray(audienceFunctions.slug, audienceFunctionSlugs))

      if (functionRows.length > 0) {
        await tx
          .insert(toolAudienceFunctions)
          .values(functionRows.map((f) => ({ toolId: newTool.id, functionId: f.id })))
      }
    }

    // Record source evidence with the real connector name
    await tx.insert(toolSources).values({
      toolId: newTool.id,
      sourceType,
      sourceUrl: candidate.sourceUrl,
      rawMetadata: candidate.rawMetadata,
    })

    // Mark candidate as published
    await tx
      .update(crawlCandidates)
      .set({ status: 'published', matchedToolId: newTool.id, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))

    return newTool.id
  })

  return { toolId, action: 'created' }
}
