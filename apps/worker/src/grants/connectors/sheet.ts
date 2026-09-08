/**
 * Sheet connector: a hand-curated spreadsheet of funders, read as CSV.
 *
 * Filip keeps a list of grants and sponsorships a team can apply to, with the
 * facts a funder page rarely states in one place: whether it is open, the
 * window, whether an employee has to be involved, 501(c)(3), restrictions. A
 * row there is the strongest lead this vertical gets, so the sheet is a SOURCE
 * that is re-read on its cadence, not a one-time import: a row added next month
 * files a candidate next week.
 *
 * Each row becomes one candidate at its application link, carrying the row's
 * own columns in rawMetadata.sheet and summarised in the description, so the
 * extractor reads them as evidence and the reviewer sees them on the card.
 * Still a CANDIDATE: the sheet says the funder exists and roughly when it is
 * open; the funder's own page says the deadline.
 *
 * The target is Google Sheets' CSV export URL
 * (.../spreadsheets/d/<id>/export?format=csv&gid=<tab>), which needs no login
 * when the sheet is shared by link.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, grantSources } from '@the-tool-pit/db'
import { politeFetch, delay } from '../../connectors/base.js'
import { canonicalGrantUrl } from './shared.js'
import type { GrantConnector, GrantConnectorContext, GrantConnectorResult, GrantCandidateInput } from './types.js'

const FETCH_DELAY_MS = 1200

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** Header cell to a key: "Require 501(c)(3)" -> "require501c3". */
function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The columns this reads, by normalised header, with the aliases seen so far. */
const COLUMNS: Record<string, string[]> = {
  name: ['grantsponsorship', 'grant', 'name', 'funder', 'sponsor'],
  link: ['applicationlink', 'link', 'url', 'application', 'website'],
  isOpen: ['isitopen', 'open', 'status'],
  openDate: ['opendate', 'opens'],
  closeDate: ['closedate', 'closes', 'deadline'],
  employee: ['employee', 'employeerequired', 'requiresemployee'],
  restrictions: ['restrictions', 'restriction', 'region', 'geography'],
  requires501c3: ['require501c3', 'requires501c3', '501c3'],
  notes: ['notes', 'note', 'comments'],
}

export interface SheetRow {
  name: string
  link: string
  isOpen?: string
  openDate?: string
  closeDate?: string
  employee?: string
  restrictions?: string
  requires501c3?: string
  notes?: string
}

export function sheetRows(csv: string): SheetRow[] {
  const table = parseCsv(csv)
  if (table.length < 2) return []
  const keys = table[0].map(headerKey)
  const col = (want: string): number => {
    for (const alias of COLUMNS[want]) {
      const i = keys.indexOf(alias)
      if (i !== -1) return i
    }
    return -1
  }
  const idx = Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, col(k)])) as Record<keyof typeof COLUMNS, number>
  if (idx.name === -1 || idx.link === -1) return []
  const cell = (r: string[], k: string): string | undefined => {
    const i = idx[k]
    const v = i === -1 ? '' : (r[i] ?? '').trim()
    return v || undefined
  }
  const out: SheetRow[] = []
  for (const r of table.slice(1)) {
    const name = cell(r, 'name')
    const link = cell(r, 'link')
    if (!name || !link || !/^https?:\/\//i.test(link)) continue
    out.push({
      name,
      link,
      isOpen: cell(r, 'isOpen'),
      openDate: cell(r, 'openDate'),
      closeDate: cell(r, 'closeDate'),
      employee: cell(r, 'employee'),
      restrictions: cell(r, 'restrictions'),
      requires501c3: cell(r, 'requires501c3'),
      notes: cell(r, 'notes'),
    })
  }
  return out
}

/** The row's facts as one paragraph the extractor and the reviewer both read. */
export function describeRow(row: SheetRow, sheetLabel: string): string {
  const bits: string[] = []
  if (row.isOpen) bits.push(`Status on the sheet: ${row.isOpen}.`)
  if (row.openDate || row.closeDate) {
    bits.push(`Application window: ${row.openDate ?? 'not stated'} to ${row.closeDate ?? 'not stated'}.`)
  }
  if (row.employee) bits.push(`Employee involvement required: ${row.employee}.`)
  if (row.requires501c3) bits.push(`Requires 501(c)(3): ${row.requires501c3}.`)
  if (row.restrictions) bits.push(`Restrictions: ${row.restrictions}.`)
  if (row.notes) bits.push(`Notes: ${row.notes}.`)
  return `From ${sheetLabel}, a hand-kept list of grants and sponsorships for FIRST teams. ${bits.join(' ')}`.trim()
}

export class GrantSheetConnector implements GrantConnector {
  name = 'grant_sheet'

  async run(ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const db = getDb()
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    const touchedSourceIds: string[] = []
    let skipped = 0

    const rows = await db
      .select()
      .from(grantSources)
      .where(ctx.sourceId ? eq(grantSources.id, ctx.sourceId) : and(eq(grantSources.kind, 'sheet'), eq(grantSources.enabled, true)))
    if (rows.length === 0) {
      limits.push('no enabled grant_sources rows of kind sheet, nothing to read')
      return { candidates, skipped: 0, errors, limits, touchedSourceIds }
    }
    const now = Date.now()
    const due = ctx.sourceId ? rows : rows.filter((r) => !r.lastRunAt || now - r.lastRunAt.getTime() >= r.cadenceHours * 3600_000)
    if (rows.length - due.length > 0) limits.push(`${rows.length - due.length} of ${rows.length} sheet sources skipped, not due under cadenceHours`)

    const failed: string[] = []
    const ok: string[] = []
    for (const source of due) {
      touchedSourceIds.push(source.id)
      try {
        const res = await politeFetch(source.target)
        if (!res.ok) {
          errors.push(`[grant-sheet] HTTP ${res.status} for ${source.target} (${source.label})`)
          failed.push(source.id)
          skipped++
          continue
        }
        const parsed = sheetRows(await res.text())
        if (parsed.length === 0) {
          errors.push(`[grant-sheet] "${source.label}" read as CSV but had no rows with a name and an http link; check the header names`)
          failed.push(source.id)
          skipped++
          continue
        }
        for (const row of parsed) {
          const canonical = canonicalGrantUrl(row.link) ?? row.link
          candidates.push({
            sourceUrl: source.target,
            canonicalUrl: canonical,
            title: row.name,
            funderName: row.name,
            applicationUrl: row.link,
            description: describeRow(row, source.label),
            discoveredVia: `sheet:${source.label}`,
            sourceId: source.id,
            metadata: {
              sheet: {
                isOpen: row.isOpen,
                openDate: row.openDate,
                closeDate: row.closeDate,
                employeeRequired: row.employee,
                restrictions: row.restrictions,
                requires501c3: row.requires501c3,
                notes: row.notes,
              },
            },
          })
        }
        ok.push(source.id)
      } catch (err) {
        errors.push(`[grant-sheet] fetch failed for ${source.target} (${source.label}): ${String(err)}`)
        failed.push(source.id)
        skipped++
      }
      await delay(FETCH_DELAY_MS)
    }
    if (failed.length > 0) {
      await db.update(grantSources).set({ lastError: 'read failed on last run, see grant_crawl_jobs', updatedAt: new Date() }).where(inArray(grantSources.id, failed))
    }
    if (ok.length > 0) {
      await db.update(grantSources).set({ lastError: null, updatedAt: new Date() }).where(inArray(grantSources.id, ok))
    }
    console.log(`[grant-sheet] ${candidates.length} rows from ${due.length} due sheets, ${skipped} skipped`)
    return { candidates, skipped, errors, limits, touchedSourceIds }
  }
}
