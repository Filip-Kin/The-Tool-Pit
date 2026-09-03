import { desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListingCandidates, practiceFieldCandidates } from '@the-tool-pit/db'
import type {
  ExtractedEventListingFields,
  ExtractedPracticeFieldFields,
  RawEventListingMetadata,
  RawPracticeFieldMetadata,
} from '@the-tool-pit/db'

/**
 * The data behind the per-vertical "reads" inspector.
 *
 * A read is a model call the worker makes over a discovered candidate: it opens
 * the thread and the event's own pages, and writes onto the candidate's
 * `raw_metadata` what it did (readAt, readPages, readEvidence, readRejected) and
 * onto `extracted` the fields it produced. Nothing here writes; this is the
 * window a moderator uses to see, per candidate, exactly what the last read did.
 *
 * BOTH VERTICALS SHARE THE READ SHAPE, so the queries are written once against a
 * table chosen by vertical. The union of the two candidate tables carries every
 * column these queries touch (`id`, `status`, `rawMetadata`, `extracted`,
 * `sourceUrl`, `canonicalUrl`, `createdAt`), the same union the worker's
 * read-candidates job selects over.
 */

export type ReadsVertical = 'event' | 'field'

/** The shared read fields, present on both verticals' rawMetadata. */
type ReadMeta = {
  readAt?: string
  readPages?: string[]
  readEvidence?: Record<string, { quote: string; source: string }>
  readRejected?: string[]
  title?: string
}

function candidateTable(vertical: ReadsVertical) {
  return vertical === 'event' ? eventListingCandidates : practiceFieldCandidates
}

/** The candidate's display name, extracted first, then the discovery title. */
function candidateName(
  vertical: ReadsVertical,
  extracted: (ExtractedEventListingFields & ExtractedPracticeFieldFields) | null,
  meta: ReadMeta,
  sourceUrl: string,
): string {
  const ex = extracted ?? {}
  if (ex.name) return ex.name
  if (vertical === 'field' && ex.teamName) return ex.teamName
  return meta.title || sourceUrl
}

/** Filled extracted fields, in insertion order, as [label, value] pairs. */
function extractedPairs(
  extracted: Record<string, unknown> | null,
): [string, string][] {
  if (!extracted) return []
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(extracted)) {
    if (v === null || v === undefined || v === '') continue
    out.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
  }
  return out
}

// ---------------------------------------------------------------------------
// Overview: how far the reader has got through this vertical's candidates
// ---------------------------------------------------------------------------

export interface ReadsOverview {
  /** Every candidate in the vertical. */
  total: number
  /** Candidates that carry a reading (readAt present). */
  read: number
  /** Pending candidates a sweep has not read yet: what a running sweep chews. */
  pendingUnread: number
}

export async function getReadsOverview(vertical: ReadsVertical): Promise<ReadsOverview> {
  const db = getDb()
  const table = candidateTable(vertical)

  const [[tot], [rd], [pu]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(table),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`${table.rawMetadata}->>'readAt' is not null`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`${table.status} = 'pending' and (${table.rawMetadata}->>'readAt') is null`),
  ])

  return { total: tot?.n ?? 0, read: rd?.n ?? 0, pendingUnread: pu?.n ?? 0 }
}

// ---------------------------------------------------------------------------
// List: candidates, newest read first
// ---------------------------------------------------------------------------

export interface ReadListRow {
  id: string
  name: string
  sourceUrl: string
  status: string
  readAt: string | null
  pagesCount: number
  fieldsCount: number
  rejectedCount: number
  createdAt: Date
}

export interface ReadsListResult {
  rows: ReadListRow[]
  total: number
}

export async function getReadsList(
  vertical: ReadsVertical,
  page: number,
  pageSize: number,
): Promise<ReadsListResult> {
  const db = getDb()
  const table = candidateTable(vertical)

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(table)
      // Newest READ first, then anything unread by newest discovery. A moderator
      // watching a sweep wants the just-read row at the top; the never-read ones
      // fall to the back where the sweep has not reached yet.
      .orderBy(
        sql`(${table.rawMetadata}->>'readAt') is null`,
        sql`${table.rawMetadata}->>'readAt' desc nulls last`,
        desc(table.createdAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(table),
  ])

  return {
    rows: rows.map((row) => {
      const meta = (row.rawMetadata ?? {}) as ReadMeta
      const extracted = row.extracted as Record<string, unknown> | null
      return {
        id: row.id,
        name: candidateName(
          vertical,
          (row.extracted ?? null) as (ExtractedEventListingFields & ExtractedPracticeFieldFields) | null,
          meta,
          row.sourceUrl,
        ),
        sourceUrl: row.sourceUrl,
        status: row.status,
        readAt: meta.readAt ?? null,
        pagesCount: meta.readPages?.length ?? 0,
        fieldsCount: extractedPairs(extracted).length,
        rejectedCount: meta.readRejected?.length ?? 0,
        createdAt: row.createdAt,
      }
    }),
    total: totals?.n ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Detail: exactly what one read did
// ---------------------------------------------------------------------------

/** One field the read produced, with the words and the page behind it. */
export interface ReadEvidenceRow {
  field: string
  /** The value that landed on `extracted`, when the field was kept. */
  value: string | null
  quote: string
  source: string
}

export interface ReadDetail {
  id: string
  name: string
  status: string
  sourceUrl: string
  canonicalUrl: string | null
  readAt: string | null
  /** Every page the reader opened, in order. */
  pages: string[]
  /** Per-field evidence: value, quote, source. */
  evidence: ReadEvidenceRow[]
  /** Values the reader offered that its evidence did not support. */
  rejected: string[]
  /** The final extracted fields, as [label, value] pairs. */
  extracted: [string, string][]
}

export async function getReadDetail(
  vertical: ReadsVertical,
  id: string,
): Promise<ReadDetail | null> {
  const db = getDb()
  const table = candidateTable(vertical)

  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1)
  if (!row) return null

  const meta = (row.rawMetadata ?? {}) as RawEventListingMetadata & RawPracticeFieldMetadata
  const extracted = (row.extracted ?? {}) as Record<string, unknown>
  const readEvidence = meta.readEvidence ?? {}

  const evidence: ReadEvidenceRow[] = Object.entries(readEvidence).map(([field, ev]) => {
    const raw = extracted[field]
    return {
      field,
      value: raw === null || raw === undefined || raw === '' ? null : String(raw),
      quote: ev.quote,
      source: ev.source,
    }
  })

  return {
    id: row.id,
    name: candidateName(
      vertical,
      (row.extracted ?? null) as (ExtractedEventListingFields & ExtractedPracticeFieldFields) | null,
      meta,
      row.sourceUrl,
    ),
    status: row.status,
    sourceUrl: row.sourceUrl,
    canonicalUrl: row.canonicalUrl,
    readAt: meta.readAt ?? null,
    pages: meta.readPages ?? [],
    evidence,
    rejected: meta.readRejected ?? [],
    extracted: extractedPairs(extracted),
  }
}
