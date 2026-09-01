'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { parseGoogleFormPrefillUrl } from '@/lib/grants/google-form'
import { PROFILE_PATHS, isKnownProfilePath, profilePathLabel } from '@/lib/grants/prefill'
// Value tuple comes from the zero-dependency enum subpath (NOT the barrel), so
// the DB client / postgres never lands in the client bundle.
import { GRANT_FIELD_FILL_KINDS } from '@the-tool-pit/db/grant-enums'
import type { GrantFieldFillKind } from '@the-tool-pit/db/grant-enums'

/**
 * Admin editor for one grant's application form-field map.
 *
 * Self-contained on purpose: it owns no data loading, no server action and no
 * route. The grants admin page mounts it, hands it the current rows, and hands
 * it a save action. That keeps this file out of the way of whoever owns the
 * admin page layout.
 *
 * The pasted-link path is the point of the whole component. Typing
 * `entry.1234567890` by hand off a page source is how a map like this gets
 * abandoned after two grants, so the normal flow is: open the funder's Google
 * Form, fill it in with recognisable junk, use the form's own "Get pre-filled
 * link", paste it here, then point each recovered parameter at a team profile
 * field.
 */

/** One editable row. `id` present = an existing grant_form_fields row. */
export interface FormFieldRowDraft {
  id?: string
  fillKind: GrantFieldFillKind
  /** e.g. `entry.1234567890` or `team_number`. Empty for fillKind 'copy'. */
  paramName: string
  profilePath: string
  label: string
  notes: string
  sortOrder: number
}

export interface AdminFormFieldEditorProps {
  grantId: string
  /** The grant's current applicationUrl, shown so a pasted link can be compared. */
  applicationUrl?: string | null
  initialFields: FormFieldRowDraft[]
  /** Persist the whole map. Replace-all semantics: what is here is what is stored. */
  onSave: (grantId: string, fields: FormFieldRowDraft[]) => Promise<{ error?: string } | void>
  /**
   * Optional. When given, a pasted pre-filled link that points at a different
   * form than applicationUrl offers to correct the grant's application URL,
   * which is usually the real reason a map "does not work".
   */
  onSaveApplicationUrl?: (grantId: string, url: string) => Promise<{ error?: string } | void>
}

const FILL_KIND_LABEL: Record<GrantFieldFillKind, string> = {
  google_form_entry: 'Google Forms entry',
  query: 'Query parameter',
  copy: 'Copy only',
}

export function AdminFormFieldEditor({
  grantId,
  applicationUrl,
  initialFields,
  onSave,
  onSaveApplicationUrl,
}: AdminFormFieldEditorProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [rows, setRows] = useState<FormFieldRowDraft[]>(() =>
    [...initialFields].sort((a, b) => a.sortOrder - b.sortOrder),
  )
  const [pasteUrl, setPasteUrl] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [detectedFormUrl, setDetectedFormUrl] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const problems = useMemo(() => validate(rows), [rows])

  function update(index: number, patch: Partial<FormFieldRowDraft>) {
    setSaved(false)
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function remove(index: number) {
    setSaved(false)
    setRows((prev) => renumber(prev.filter((_, i) => i !== index)))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    setSaved(false)
    setRows((prev) => {
      const next = [...prev]
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return renumber(next)
    })
  }

  function addBlank() {
    setSaved(false)
    setRows((prev) =>
      renumber([
        ...prev,
        { fillKind: 'copy', paramName: '', profilePath: '', label: '', notes: '', sortOrder: prev.length },
      ]),
    )
  }

  /** Turn a pasted pre-filled Google Forms link into rows, keeping what exists. */
  function importPastedLink() {
    setSaved(false)
    setSaveError(null)
    const result = parseGoogleFormPrefillUrl(pasteUrl)
    if (!result.ok) {
      setParseError(result.error)
      setParseWarnings([])
      setDetectedFormUrl(null)
      return
    }
    setParseError(null)
    setParseWarnings(result.form.warnings)
    setDetectedFormUrl(result.form.formUrl)

    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.paramName.trim()).filter(Boolean))
      // Existing rows win: re-importing a link must never wipe profile paths
      // that have already been mapped by hand.
      const added = result.form.entries
        .filter((e) => !seen.has(e.paramName))
        .map<FormFieldRowDraft>((e, i) => ({
          fillKind: 'google_form_entry',
          paramName: e.paramName,
          profilePath: '',
          // The junk the admin typed when generating the link is the only clue
          // to which question this id is, so it starts as the label.
          label: e.sampleValue || (e.subfield ? `Question ${e.entryId} (${e.subfield})` : `Question ${e.entryId}`),
          notes: '',
          sortOrder: prev.length + i,
        }))
      return renumber([...prev, ...added])
    })
  }

  function save() {
    setSaveError(null)
    setSaved(false)
    start(async () => {
      const res = await onSave(grantId, renumber(rows))
      if (res && 'error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function saveApplicationUrl(url: string) {
    if (!onSaveApplicationUrl) return
    setSaveError(null)
    start(async () => {
      const res = await onSaveApplicationUrl(grantId, url)
      if (res && 'error' in res && res.error) setSaveError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* #region paste a pre-filled link */}
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted">
          Import from a pre-filled Google Forms link
        </label>
        <p className="mt-1 text-xs text-muted-2">
          Open the funder’s form, fill every box with the question’s own name, then use the form’s
          “Get pre-filled link” and paste it here. Existing rows are kept.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            placeholder="https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&entry.123=…"
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={importPastedLink}
            disabled={pending || !pasteUrl.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Import
          </button>
        </div>
        {parseError && <p className="mt-2 text-xs text-red-400">{parseError}</p>}
        {parseWarnings.map((w) => (
          <p key={w} className="mt-1 text-xs text-amber-400">
            {w}
          </p>
        ))}
        {detectedFormUrl && detectedFormUrl !== applicationUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="break-all">Form URL in that link: {detectedFormUrl}</span>
            {onSaveApplicationUrl && (
              <button
                type="button"
                disabled={pending}
                onClick={() => saveApplicationUrl(detectedFormUrl)}
                className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
              >
                Use as the application URL
              </button>
            )}
          </div>
        )}
      </div>
      {/* #endregion */}

      {/* #region rows */}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-2">
          No fields mapped. Until there are some, the grant page tells teams plainly that this form
          has to be typed.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <FieldRow
              key={row.id ?? `new-${i}`}
              row={row}
              index={i}
              count={rows.length}
              disabled={pending}
              onChange={(patch) => update(i, patch)}
              onRemove={() => remove(i)}
              onMove={(d) => move(i, d)}
            />
          ))}
        </div>
      )}

      <datalist id="grant-profile-paths">
        {PROFILE_PATHS.map((p) => (
          <option key={p.path} value={p.path}>
            {p.group}: {p.label}
          </option>
        ))}
      </datalist>
      {/* #endregion */}

      {problems.length > 0 && (
        <ul className="flex flex-col gap-1">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5 text-xs text-amber-400">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addBlank}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a field
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save field map'}
        </button>
        {saved && !pending && <span className="text-xs text-green-400">Saved</span>}
        {saveError && <span className="text-xs text-red-400">{saveError}</span>}
      </div>
    </div>
  )
}

// #region row

function FieldRow({
  row,
  index,
  count,
  disabled,
  onChange,
  onRemove,
  onMove,
}: {
  row: FormFieldRowDraft
  index: number
  count: number
  disabled: boolean
  onChange: (patch: Partial<FormFieldRowDraft>) => void
  onRemove: () => void
  onMove: (delta: number) => void
}) {
  const needsParam = row.fillKind !== 'copy'
  const pathKnown = !row.profilePath.trim() || isKnownProfilePath(row.profilePath.trim())

  return (
    <div className="rounded border border-border-subtle bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={row.fillKind}
          disabled={disabled}
          onChange={(e) => onChange({ fillKind: e.target.value as GrantFieldFillKind })}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        >
          {GRANT_FIELD_FILL_KINDS.map((k) => (
            <option key={k} value={k}>
              {FILL_KIND_LABEL[k]}
            </option>
          ))}
        </select>

        <input
          value={row.paramName}
          disabled={disabled || !needsParam}
          onChange={(e) => onChange({ paramName: e.target.value })}
          placeholder={needsParam ? 'entry.1234567890' : 'not used'}
          className={cn(
            'w-44 rounded border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-primary',
            needsParam && !row.paramName.trim() ? 'border-amber-500/60' : 'border-border',
            !needsParam && 'opacity-40',
          )}
        />

        <input
          value={row.profilePath}
          disabled={disabled}
          list="grant-profile-paths"
          onChange={(e) => onChange({ profilePath: e.target.value })}
          placeholder="profile path, e.g. boilerplate.mission"
          className={cn(
            'w-60 rounded border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-primary',
            pathKnown ? 'border-border' : 'border-amber-500/60',
          )}
        />

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            title="Move up"
            className="rounded border border-border p-1 text-muted hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            title="Move down"
            className="rounded border border-border p-1 text-muted hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            title="Remove this field"
            className="rounded border border-border p-1 text-muted hover:text-red-400 disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={row.label}
          disabled={disabled}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="the question as the form asks it"
          className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <input
          value={row.notes}
          disabled={disabled}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="note for the team, e.g. attach as a PDF"
          className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
      </div>

      {row.profilePath.trim() && pathKnown && (
        <p className="mt-1 text-xs text-muted-2">Fills with: {profilePathLabel(row.profilePath.trim())}</p>
      )}
    </div>
  )
}

// #endregion

// #region helpers

/** sortOrder is the array order. Rewritten on every structural change. */
function renumber(rows: FormFieldRowDraft[]): FormFieldRowDraft[] {
  return rows.map((r, i) => ({ ...r, sortOrder: i }))
}

/**
 * Warnings, never blocks. A half-mapped row is a normal working state, and the
 * prefill builder already degrades a broken row into a copy field rather than
 * dropping it. What matters is that the admin can see the gap here instead of
 * discovering it on a team's application.
 */
function validate(rows: FormFieldRowDraft[]): string[] {
  const out: string[] = []
  const params = new Map<string, number>()

  for (const row of rows) {
    const label = row.label.trim() || row.profilePath.trim() || row.paramName.trim() || 'an unnamed field'
    if (!row.profilePath.trim()) {
      out.push(`${label}: no profile path, so nothing will be filled in for it.`)
    } else if (!isKnownProfilePath(row.profilePath.trim())) {
      out.push(`${label}: "${row.profilePath.trim()}" is not a team profile field we recognise.`)
    }
    if (row.fillKind !== 'copy' && !row.paramName.trim()) {
      out.push(`${label}: marked prefillable but has no parameter name, so it falls back to copy-only.`)
    }
    if (row.fillKind === 'google_form_entry' && row.paramName.trim() && !/^(entry\.)?\d+(_[a-z]+)?$/i.test(row.paramName.trim())) {
      out.push(`${label}: "${row.paramName.trim()}" is not a Google Forms entry id.`)
    }
    const key = row.paramName.trim()
    if (key) params.set(key, (params.get(key) ?? 0) + 1)
  }

  for (const [param, n] of params) {
    if (n > 1) out.push(`${param} is mapped ${n} times. Only the last one will reach the form.`)
  }
  return out
}

// #endregion
