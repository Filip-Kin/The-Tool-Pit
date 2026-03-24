import { getDb } from '@/lib/db'
import { toolClickEvents, searchEvents } from '@the-tool-pit/db'

interface RecordClickInput {
  toolId: string
  linkType: string
  sessionId?: string
  ipHash?: string
}

export async function recordClickEvent(input: RecordClickInput): Promise<void> {
  const db = getDb()
  await db.insert(toolClickEvents).values({
    toolId: input.toolId,
    linkType: input.linkType,
    sessionId: input.sessionId,
    ipHash: input.ipHash,
  })
}

interface RecordSearchInput {
  query: string
  programFilter?: string
  resultCount: number
  sessionId?: string
  ipHash?: string
}

export async function recordSearchEvent(input: RecordSearchInput): Promise<void> {
  const db = getDb()
  await db.insert(searchEvents).values({
    query: input.query.slice(0, 500), // cap length
    programFilter: input.programFilter,
    resultCount: input.resultCount,
    sessionId: input.sessionId,
    ipHash: input.ipHash,
  })
}
