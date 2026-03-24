/**
 * Publishing stage: if a candidate has sufficient confidence,
 * create or update a tool record in the database.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import {
  tools,
  toolLinks,
  toolPrograms,
  toolSources,
  crawlCandidates,
  programs,
} from '@the-tool-pit/db'
import type { NewTool } from '@the-tool-pit/db'

/** Confidence threshold to auto-publish (0.0–1.0) */
const PUBLISH_THRESHOLD = 0.7

export interface PublishResult {
  toolId: string
  action: 'created' | 'updated' | 'skipped'
  reason?: string
}

export async function publishCandidate(candidateId: string): Promise<PublishResult> {
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
    // Leave in pending state for admin review
    return {
      toolId: '',
      action: 'skipped',
      reason: `Confidence ${confidence.toFixed(2)} below threshold ${PUBLISH_THRESHOLD}`,
    }
  }

  const meta = (candidate.rawMetadata ?? {}) as Record<string, unknown>

  // Build a URL-safe slug from the title
  const titleBase = ((meta.title as string) ?? 'tool')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  // Ensure uniqueness
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
    summary:
      ((classification.summary as string) ?? (meta.description as string) ?? '').slice(0, 300) || null,
    toolType: (classification.toolType as string) ?? 'other',
    status: 'published',
    isOfficial: Boolean(classification.isOfficial),
    isVendor: Boolean(classification.isVendor),
    isRookieFriendly: Boolean(classification.isRookieFriendly),
    confidenceScore: confidence,
    freshnessState: 'unknown',
    publishedAt: new Date(),
  }

  const [newTool] = await db.insert(tools).values(toolData).returning({ id: tools.id })

  // Insert primary link
  if (candidate.canonicalUrl) {
    await db.insert(toolLinks).values({
      toolId: newTool.id,
      linkType: 'homepage',
      url: candidate.canonicalUrl,
    })
  }

  // Insert GitHub link if present
  const githubUrl = meta.githubUrl as string | undefined
  if (githubUrl) {
    await db.insert(toolLinks).values({
      toolId: newTool.id,
      linkType: 'github',
      url: githubUrl,
    })
  }

  // Link programs
  const programSlugs = (classification.programs as string[]) ?? []
  if (programSlugs.length > 0) {
    const programRows = await db
      .select({ id: programs.id, slug: programs.slug })
      .from(programs)
      .where(sql`${programs.slug} = any(${programSlugs})`)

    if (programRows.length > 0) {
      await db
        .insert(toolPrograms)
        .values(programRows.map((p) => ({ toolId: newTool.id, programId: p.id })))
    }
  }

  // Record source evidence
  await db.insert(toolSources).values({
    toolId: newTool.id,
    sourceType: 'fta_tools', // overridden by enrich job if needed
    sourceUrl: candidate.sourceUrl,
    rawMetadata: candidate.rawMetadata,
  })

  // Mark candidate as published
  await db
    .update(crawlCandidates)
    .set({ status: 'published', matchedToolId: newTool.id, updatedAt: new Date() })
    .where(eq(crawlCandidates.id, candidateId))

  return { toolId: newTool.id, action: 'created' }
}
