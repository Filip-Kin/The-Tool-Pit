/**
 * Writing an automatic change to a public listing, with a record that can
 * undo it.
 *
 * Every write the field, event and tool refreshes make goes through
 * applyLoggedPatch: in ONE transaction it locks the row, reads the full value
 * each column holds now, inserts one listing_changes row per column (old value,
 * new value, quote, page), and only then updates. A crash between the two
 * leaves neither. apps/worker/scripts/revert-listing-changes.ts reads the
 * same rows back.
 *
 * planRevert is the pure half of that script, kept here so it is tested.
 */
import { and, eq, type SQL } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { getDb, listingChanges, type ListingChange } from '@the-tool-pit/db'

export type ChangeEntityType = 'field' | 'event' | 'tool'

/** A table with a uuid `id` and an `updatedAt`, which all three listing tables have. */
type ListingTable = PgTable & { id: PgColumn }

export interface LoggedPatchInput {
  entityType: ChangeEntityType
  table: ListingTable
  id: string
  actor: string
  /** Columns to write, by Drizzle key. updatedAt is added here. */
  patch: Record<string, unknown>
  /** The proof per column, when there is one. Derived columns (a pin, a season) have none. */
  proof?: Record<string, { quote?: string | null; source?: string | null } | undefined>
  /** Extra conditions the row must still meet, checked under the lock (published, not claimed). */
  where?: SQL
  /**
   * Is the column still what the plan was made against? A column a person
   * changed while the model was reading is dropped from the write.
   */
  stillCurrent?: (key: string, value: unknown) => boolean
}

/** Write the patch and its change rows together. Returns the columns written; empty when the row moved. */
export async function applyLoggedPatch(input: LoggedPatchInput): Promise<string[]> {
  const { table, id } = input
  return getDb().transaction(async (tx) => {
    const cond = input.where ? and(eq(table.id, id), input.where) : eq(table.id, id)
    const [row] = (await tx.select().from(table as PgTable).where(cond).for('update').limit(1)) as Array<
      Record<string, unknown>
    >
    if (!row) return []

    const keys = Object.keys(input.patch).filter(
      (k) => k !== 'updatedAt' && (!input.stillCurrent || input.stillCurrent(k, row[k])),
    )
    if (keys.length === 0) return []

    await tx.insert(listingChanges).values(
      keys.map((k) => ({
        entityType: input.entityType,
        entityId: id,
        column: k,
        oldValue: toJson(row[k]),
        newValue: toJson(input.patch[k]),
        quote: input.proof?.[k]?.quote || null,
        sourceUrl: input.proof?.[k]?.source || null,
        actor: input.actor,
      })),
    )

    const set: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of keys) set[k] = input.patch[k]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tx.update(table).set(set as any).where(eq(table.id, id))
    return keys
  })
}

/** A column value as jsonb holds it: Dates as ISO strings, undefined as null. */
export function toJson(value: unknown): unknown {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value ?? null))
}

/**
 * Equal as stored values. jsonb round-trips a Date to a string and numeric
 * columns come back as strings, so both sides are compared in JSON form, and
 * numbers by value.
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  const ja = toJson(a)
  const jb = toJson(b)
  const empty = (v: unknown) => v === null || v === ''
  if (empty(ja) && empty(jb)) return true
  if (JSON.stringify(ja) === JSON.stringify(jb)) return true
  const na = typeof ja === 'number' || typeof ja === 'string' ? Number(ja) : NaN
  const nb = typeof jb === 'number' || typeof jb === 'string' ? Number(jb) : NaN
  return Number.isFinite(na) && Number.isFinite(nb) && String(ja).trim() !== '' && String(jb).trim() !== '' && na === nb
}

// #region revert

export interface RevertStep {
  change: Pick<ListingChange, 'id' | 'entityType' | 'entityId' | 'column' | 'oldValue' | 'newValue' | 'createdAt'>
  /** 'restore' writes oldValue back; anything else is why not. */
  action: 'restore' | 'changed_since' | 'entity_gone'
  current?: unknown
}

/**
 * Which matching changes to undo.
 *
 * Only the LATEST change per (entity, column) counts: undoing it restores what
 * the column held before the last automatic write, and an older change to the
 * same column is already covered. It is restored only when the column still
 * holds that change's new value; a column a person (or a later job) has since
 * changed is left alone.
 *
 * `current` maps "entityType:entityId" to the row as it stands, by Drizzle key.
 */
export function planRevert(
  changes: ReadonlyArray<RevertStep['change']>,
  current: ReadonlyMap<string, Record<string, unknown>>,
): RevertStep[] {
  const latest = new Map<string, RevertStep['change']>()
  for (const c of changes) {
    const key = `${c.entityType}:${c.entityId}:${c.column}`
    const seen = latest.get(key)
    if (!seen || new Date(c.createdAt).getTime() > new Date(seen.createdAt).getTime()) latest.set(key, c)
  }
  const steps: RevertStep[] = []
  for (const c of latest.values()) {
    const row = current.get(`${c.entityType}:${c.entityId}`)
    if (!row) {
      steps.push({ change: c, action: 'entity_gone' })
      continue
    }
    const now = row[c.column]
    steps.push({ change: c, action: sameStoredValue(now, c.newValue) ? 'restore' : 'changed_since', current: now })
  }
  return steps
}

/** A jsonb old value as the column takes it back: timestamps become Dates again. */
export function fromJson(table: PgTable, column: string, value: unknown): unknown {
  const col = (getTableColumns(table) as Record<string, PgColumn>)[column]
  if (col && col.columnType === 'PgTimestamp' && typeof value === 'string') return new Date(value)
  return value
}

// #endregion
