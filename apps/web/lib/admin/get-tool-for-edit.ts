import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  tools,
  toolPrograms,
  toolLinks,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
  programs,
  audiencePrimaryRoles,
  audienceFunctions,
} from '@the-tool-pit/db'

export interface ToolForEdit {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  toolType: string
  status: string
  isOfficial: boolean
  isVendor: boolean
  isRookieFriendly: boolean
  isTeamCode: boolean
  teamNumber: number | null
  seasonYear: number | null
  vendorName: string | null
  freshnessState: string | null
  programs: string[]
  audienceRoles: string[]
  audienceFunctions: string[]
  links: Array<{ id: string; linkType: string; url: string; label: string | null; isBroken: boolean; lastCheckedAt: Date | null }>
}

export async function getToolForEdit(id: string): Promise<ToolForEdit | null> {
  const db = getDb()

  const [tool] = await db.select().from(tools).where(eq(tools.id, id)).limit(1)
  if (!tool) return null

  const [programRows, roleRows, fnRows, linkRows] = await Promise.all([
    db
      .select({ slug: programs.slug })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(eq(toolPrograms.toolId, id)),

    db
      .select({ slug: audiencePrimaryRoles.slug })
      .from(toolAudiencePrimaryRoles)
      .innerJoin(audiencePrimaryRoles, eq(audiencePrimaryRoles.id, toolAudiencePrimaryRoles.roleId))
      .where(eq(toolAudiencePrimaryRoles.toolId, id)),

    db
      .select({ slug: audienceFunctions.slug })
      .from(toolAudienceFunctions)
      .innerJoin(audienceFunctions, eq(audienceFunctions.id, toolAudienceFunctions.functionId))
      .where(eq(toolAudienceFunctions.toolId, id)),

    db
      .select({ id: toolLinks.id, linkType: toolLinks.linkType, url: toolLinks.url, label: toolLinks.label, isBroken: toolLinks.isBroken, lastCheckedAt: toolLinks.lastCheckedAt })
      .from(toolLinks)
      .where(eq(toolLinks.toolId, id)),
  ])

  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    summary: tool.summary,
    description: tool.description,
    toolType: tool.toolType,
    status: tool.status,
    isOfficial: tool.isOfficial,
    isVendor: tool.isVendor,
    isRookieFriendly: tool.isRookieFriendly,
    isTeamCode: tool.isTeamCode,
    teamNumber: tool.teamNumber ?? null,
    seasonYear: tool.seasonYear ?? null,
    vendorName: tool.vendorName,
    freshnessState: tool.freshnessState,
    programs: programRows.map((r) => r.slug),
    audienceRoles: roleRows.map((r) => r.slug),
    audienceFunctions: fnRows.map((r) => r.slug),
    links: linkRows,
  }
}
