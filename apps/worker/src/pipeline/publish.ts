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
import { isHumanEdited, isHumanEditedLink, popularityScoreSql } from '@the-tool-pit/db'

/** Confidence threshold to auto-publish (0.0–1.0) */
const PUBLISH_THRESHOLD = 0.7

// Imported AND re-exported: the file uses it below, and existing importers and
// tests reach for it here. The function itself moved to packages/db so the
// admin publish button can use the same one instead of re-inlining it, which is
// how that copy lost the trailing-hyphen trim.
import { buildSlug } from '@the-tool-pit/db/slug'
export { buildSlug }

export interface PublishResult {
  toolId: string
  action: 'created' | 'updated' | 'skipped'
  reason?: string
}


/**
 * Whether a candidate carries enough to be a useful listing.
 *
 * Confidence says the classifier believed it. This says there is actually
 * something to show. Both have to hold, and this one is deterministic, so it
 * costs nothing and cannot drift with a prompt.
 *
 * It checks presence, not length. 500 of 1110 published listings had no usable
 * summary because publishing gated on confidence alone, and confidence answers
 * "is this FRC related", which sat around 0.83 for almost everything including
 * Flask. A character count would have been just as arbitrary a proxy.
 *
 * Deliberately NOT a rejection: a thin candidate stays pending for a human
 * rather than being suppressed, because "we could not describe it" is a
 * statement about our scrape, not about the tool.
 */
export function missingForPublish(fields: {
  name: string | null | undefined
  summary: string | null | undefined
  url: string | null | undefined
}): string[] {
  const missing: string[] = []
  const name = fields.name?.trim() ?? ''
  const summary = fields.summary?.trim() ?? ''
  if (!name || name.toLowerCase() === 'untitled tool') missing.push('name')
  if (!summary) missing.push('summary')
  if (!fields.url?.trim()) missing.push('link')
  return missing
}

// #region human edits
//
// A crawl refreshes a listing. It does not get to argue with a person about it.
//
// Until this existed, a re-publish rewrote the whole tool row and both sets of
// join tables, so every owner edit and every admin correction was reverted by
// the next pass over that candidate. The marker is tools.human_edited_fields,
// written by the owner form and by the admin tool editor. See
// packages/db/src/human-edited.ts for the shape and why the links are markers
// in that same array rather than a flag on tool_links.
//
// DELIBERATELY NOT THE WHOLE ROW. A tool with a claimed name still gets a fresh
// star count, a fresh summary if nobody wrote one, and a fresh docs link. The
// unit of ownership is a field, not a listing, because the common case is an
// owner who fixed one wrong line and would still like the rest kept current.

/**
 * Strip the keys a person owns out of an update the crawl wants to make.
 *
 * Pure, and exported, because this is the behaviour that has to hold: a claimed
 * field is not in the returned set at any price, an unclaimed one always is.
 * A key that is not claimable at all (a star count, updatedAt) is never checked
 * against the list, so metrics keep refreshing on a fully claimed listing.
 */
export function withoutHumanEdits<T extends Record<string, unknown>>(
  set: T,
  humanEditedFields: readonly string[] | null | undefined,
): Partial<T> {
  if (!humanEditedFields?.length) return set
  const out: Partial<T> = {}
  for (const key of Object.keys(set) as Array<keyof T & string>) {
    if (isHumanEdited(humanEditedFields, key)) continue
    out[key] = set[key]
  }
  return out
}

/** May the crawl replace this link type, or has someone set it by hand? */
export function crawlOwnsLink(
  linkType: string,
  humanEditedFields: readonly string[] | null | undefined,
): boolean {
  return !isHumanEditedLink(humanEditedFields, linkType)
}

// #endregion

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

  // Completeness, checked separately from confidence. A row that clears the
  // model's bar but has no real summary is exactly the "incomplete entry"
  // problem: it renders as a card with a title and a blank space under it.
  // Held for a human instead of published or suppressed.
  const missing = missingForPublish({
    name: (meta.title as string) ?? null,
    summary: rawSummary,
    url: (meta.canonicalUrl as string) ?? (meta.url as string) ?? candidate.canonicalUrl ?? candidate.sourceUrl,
  })
  if (missing.length > 0 && !candidate.matchedToolId) {
    return {
      toolId: '',
      action: 'skipped',
      reason: `Incomplete, needs a human: missing ${missing.join(', ')}`,
    }
  }

  // If this candidate already maps to a tool, update it rather than creating a duplicate.
  if (candidate.matchedToolId) {
    const existingToolId = candidate.matchedToolId

    // What a person has already claimed on this listing. Read before anything
    // is written, and the only thing standing between an owner's edit and this
    // function's default behaviour of rewriting the row.
    const [claimed] = await db
      .select({ humanEditedFields: tools.humanEditedFields })
      .from(tools)
      .where(eq(tools.id, existingToolId))
      .limit(1)
    const humanEdited = claimed?.humanEditedFields ?? []

    await db.transaction(async (tx) => {
      // Everything the crawl WOULD write, before the human edits are taken out
      // of it. Metrics are listed here too and are never claimable, so a fully
      // claimed listing still gets a fresh star count.
      const crawlSet = {
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
        // NOT chiefDelphiLikes, and NOT popularityScore.
        //
        // This wrote both, from `meta.chiefDelphiLikes`, a metadata key that
        // nothing in the repo has ever written. So a re-publish set the likes
        // to zero and then wrote a score to match. 134 of the 138 listings that
        // carry likes were exposed, 2192 likes between them, and 353
        // re-publishes ran in a single day. It looked harmless only because the
        // 07:20 popularity pass rebuilt the column every morning.
        //
        // The likes belong to jobs/popularity.ts, which reads them from the
        // forum. The score is recomputed below from the row's own columns.
        confidenceScore: confidence,
      }

      await tx
        .update(tools)
        .set({ ...withoutHumanEdits(crawlSet, humanEdited), updatedAt: new Date() })
        .where(eq(tools.id, existingToolId))

      // A second statement, deliberately. Postgres evaluates a SET list against
      // the row as it was before the UPDATE, so folding this into the one above
      // would score the listing on the star count it held a moment ago.
      await tx
        .update(tools)
        .set({ popularityScore: popularityScoreSql })
        .where(eq(tools.id, existingToolId))

      // Sync links: delete auto-managed types and re-insert. A type someone set
      // by hand is skipped entirely, including its DELETE, so an owner who
      // cleared a dead link does not get it back on the next pass.
      const AUTO_LINK_TYPES = ['homepage', 'github', 'forum'] as const
      for (const linkType of AUTO_LINK_TYPES) {
        if (!crawlOwnsLink(linkType, humanEdited)) continue
        await tx.delete(toolLinks).where(
          and(eq(toolLinks.toolId, existingToolId), eq(toolLinks.linkType, linkType)),
        )
      }
      if (candidate.canonicalUrl && crawlOwnsLink('homepage', humanEdited)) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'homepage', url: candidate.canonicalUrl })
      }
      const githubUrlUpd = meta.githubUrl as string | undefined
      if (githubUrlUpd && crawlOwnsLink('github', humanEdited)) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'github', url: githubUrlUpd })
      }
      if (candidate.sourceUrl?.includes('chiefdelphi.com') && crawlOwnsLink('forum', humanEdited)) {
        await tx.insert(toolLinks).values({ toolId: existingToolId, linkType: 'forum', url: candidate.sourceUrl })
      }

      // Sync programs. Skipped whole when an admin filed this tool by hand:
      // the delete and the re-insert are one decision, and honouring half of it
      // would leave the listing with no programs at all.
      if (!isHumanEdited(humanEdited, 'programs')) {
        await tx.delete(toolPrograms).where(eq(toolPrograms.toolId, existingToolId))
        const programSlugsUpd = (classification.programs as string[] | undefined) ?? []
        if (programSlugsUpd.length > 0) {
          const programRows = await tx.select({ id: programs.id }).from(programs).where(inArray(programs.slug, programSlugsUpd))
          if (programRows.length > 0) {
            await tx.insert(toolPrograms).values(programRows.map((p) => ({ toolId: existingToolId, programId: p.id })))
          }
        }
      }

      // Sync audience roles
      if (!isHumanEdited(humanEdited, 'audienceRoles')) {
        await tx.delete(toolAudiencePrimaryRoles).where(eq(toolAudiencePrimaryRoles.toolId, existingToolId))
        const audienceRoleSlugsUpd = (classification.audienceRoles as string[] | undefined) ?? []
        if (audienceRoleSlugsUpd.length > 0) {
          const roleRows = await tx.select({ id: audiencePrimaryRoles.id }).from(audiencePrimaryRoles).where(inArray(audiencePrimaryRoles.slug, audienceRoleSlugsUpd))
          if (roleRows.length > 0) {
            await tx.insert(toolAudiencePrimaryRoles).values(roleRows.map((r) => ({ toolId: existingToolId, roleId: r.id })))
          }
        }
      }

      // Sync audience functions
      if (!isHumanEdited(humanEdited, 'audienceFunctions')) {
        await tx.delete(toolAudienceFunctions).where(eq(toolAudienceFunctions.toolId, existingToolId))
        const audienceFunctionSlugsUpd = (classification.audienceFunctions as string[] | undefined) ?? []
        if (audienceFunctionSlugsUpd.length > 0) {
          const functionRows = await tx.select({ id: audienceFunctions.id }).from(audienceFunctions).where(inArray(audienceFunctions.slug, audienceFunctionSlugsUpd))
          if (functionRows.length > 0) {
            await tx.insert(toolAudienceFunctions).values(functionRows.map((f) => ({ toolId: existingToolId, functionId: f.id })))
          }
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
    // A brand new row has no votes and no forum likes yet, so its score is its
    // stars and the daily pass fills the rest in. chiefDelphiLikes is left at
    // the column default rather than written from `meta.chiefDelphiLikes`,
    // which nothing has ever populated.
    popularityScore: typeof meta.githubStars === 'number' ? meta.githubStars : 0,
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
