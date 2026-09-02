'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listingFormSpec,
  LISTING_REVIEW_NOTE,
  type ExtraLink,
  type ListingFieldSpec,
  type ListingGroup,
  type ToolTagKey,
} from './listing-fields'
import { ExtraLinksEditor } from './extra-links-editor'
import { TagPicker } from './tag-picker'
import { cn } from '@/lib/utils/cn'
import type { EditableListing, ListingFormValues } from '@/lib/queries/listing-ownership'
import type { TagOption } from '@/lib/listings/tool-taxonomy'

/**
 * The owner edit form for a listing.
 *
 * One component for all four verticals, because they differ only in which
 * fields they have, and that difference is data: components/me/listing-fields.ts
 * declares the fields, their groups, their captions and their limits, and this
 * file renders whatever it is handed. Adding a column to a vertical is an entry
 * in that file and nothing here.
 *
 * The save behaviour is the team profile form's, deliberately identical rather
 * than merely similar. Filip's standing complaint is that the platform reads
 * like separate apps stitched together, and two editors on the same site that
 * save in two different ways is exactly that. So: no Save button, whole-form
 * autosave on an 800ms debounce, an immediate flush when a field loses focus or
 * the tab goes away, a snapshot gate so an untouched form never posts, and a
 * failure that keeps your text and says so instead of pretending.
 *
 * Nothing here decides permissions. The page proved edit access before
 * rendering, and the action proves it again server-side on every save.
 */

// #region autosave

/** Quiet period after the last keystroke. Long enough to not save mid-word. */
const AUTOSAVE_DEBOUNCE_MS = 800

type SaveStatus =
  /** Loaded and untouched, or edited and waiting for the debounce. */
  | { kind: 'idle'; dirty: boolean }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }

/**
 * A comparable snapshot of the form.
 *
 * Keys are sorted because the seed fills them in spec order while a link with
 * no row yet is added later, and insertion order must not read as a change.
 */
function serialiseValues(values: ListingFormValues): string {
  return JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]))
}

/**
 * Every field the spec declares, whether or not the listing had a value for it.
 *
 * A field missing from the state would render as an uncontrolled input and then
 * flip to controlled on the first keystroke, and an absent FormData key reads
 * as empty on the server, so a half-seeded form would blank whatever it did not
 * render. Seeding from the spec makes both impossible.
 */
function seedValues(listing: EditableListing): ListingFormValues {
  const out: ListingFormValues = {}
  for (const field of listingFormSpec(listing.entityType, listing.formContext).fields) {
    const loaded = listing.values[field.key]
    out[field.key] = loaded ?? emptyValue(field.kind)
  }
  return out
}

function emptyValue(kind: ListingFieldSpec['kind']): string | boolean | string[] | ExtraLink[] {
  if (kind === 'checkbox') return false
  if (kind === 'tags' || kind === 'links') return []
  return ''
}

/**
 * The link rows out of a form value.
 *
 * ListingFormValues holds a union, and string[] and ExtraLink[] are both
 * arrays, so Array.isArray alone does not tell them apart. The caller has
 * already branched on field.kind, which is what makes this safe; this only has
 * to convince the compiler of it without an `any`.
 */
function asExtraLinks(value: ListingFormValues[string] | undefined): ExtraLink[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is ExtraLink => typeof v === 'object' && v !== null)
}

// #endregion

export function ListingEditForm({
  entityId,
  listing,
  dynamicOptions,
  saveAction,
}: {
  entityId: string
  listing: EditableListing
  /**
   * Option tuples the spec cannot carry itself, by field key. TOOL_TYPES lives
   * in the db barrel, which re-exports the postgres client, so value-importing
   * it into a client component would drag net and tls into the browser bundle.
   * The page reads it server-side and passes it down.
   */
  dynamicOptions: Record<string, readonly string[]>
  saveAction: (formData: FormData) => Promise<{ error?: string; message?: string }>
}) {
  const spec = useMemo(
    () => listingFormSpec(listing.entityType, listing.formContext),
    [listing.entityType, listing.formContext],
  )
  const [values, setValues] = useState<ListingFormValues>(() => seedValues(listing))
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle', dirty: false })

  const formRef = useRef<HTMLFormElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Mirrors values, so the debounced callback reads the newest ones. */
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])
  /**
   * The snapshot the server last accepted, seeded with what was loaded so an
   * untouched form never saves. A failed save must NOT update it: that is what
   * stops a rejected value being treated as stored.
   */
  const [loadedSnapshot] = useState(() => serialiseValues(seedValues(listing)))
  const savedRef = useRef(loadedSnapshot)
  const savingRef = useRef(false)
  /** An edit arrived while a save was in flight; run once more when it lands. */
  const queuedRef = useRef(false)

  /**
   * Send the whole form.
   *
   * Whole-form and not per-field, because the action reads an absent FormData
   * key as an empty value: posting one field would blank the rest. The FormData
   * still comes off the DOM rather than from state, so there is one
   * serialisation and it cannot drift from what the action parses.
   *
   * Validation stays entirely on the server. The limits in the spec are shared
   * with it, so the inputs and the checks agree by construction, but the check
   * that decides is the server's. What the user must never get is a value the
   * server rejected sitting in a field that looks saved, so a failure keeps
   * their text, keeps the stale snapshot, and says so.
   */
  const save = useCallback(async () => {
    const form = formRef.current
    if (!form) return

    const snapshot = serialiseValues(valuesRef.current)
    if (snapshot === savedRef.current) return
    if (savingRef.current) {
      queuedRef.current = true
      return
    }

    savingRef.current = true
    setStatus({ kind: 'saving' })
    const res = await saveAction(new FormData(form))
    savingRef.current = false
    const queued = queuedRef.current
    queuedRef.current = false

    if (res.error) {
      // The snapshot stays stale on purpose, so the next blur or keystroke
      // retries rather than believing the rejected value is stored.
      setStatus({ kind: 'failed', message: res.error })
      return
    }
    savedRef.current = snapshot
    setStatus({ kind: 'saved' })

    // Whatever was typed during the round trip has not been sent yet. The
    // snapshot check at the top of the next pass makes this a no-op if it has.
    if (queued) void save()
  }, [saveAction])

  /** Cancel the pending debounce and go now. Used by blur, tab-away and Retry. */
  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    void save()
  }, [save])

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void save()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function set(key: string, value: string | boolean | string[] | ExtraLink[]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setStatus({ kind: 'idle', dirty: true })
    scheduleSave()
  }

  useEffect(() => {
    /**
     * Switching apps on a phone is how a half-typed answer gets lost: the tab
     * can be discarded while the debounce is still counting. visibilitychange
     * fires before that, beforeunload covers closing the tab on a desktop.
     */
    function onHide() {
      if (document.visibilityState === 'hidden') saveNow()
    }
    function onUnload(e: BeforeUnloadEvent) {
      if (serialiseValues(valuesRef.current) === savedRef.current) return
      e.preventDefault()
      // Older engines ignore preventDefault here and want a set returnValue.
      e.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [saveNow])

  const reviewNote = LISTING_REVIEW_NOTE[listing.entityType]

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        // Enter in a text box still implicit-submits a form with no submit
        // button. Commit rather than reload the page.
        e.preventDefault()
        saveNow()
      }}
      /**
       * Leaving a field commits it. React's onBlur is focusout, which bubbles,
       * so tabbing between two boxes saves without waiting out the debounce.
       */
      onBlur={saveNow}
      className="flex flex-col gap-8"
    >
      <input type="hidden" name="entityId" value={entityId} />

      <SaveStatusLine status={status} onRetry={saveNow} />

      {spec.groups.map((group) => (
        <Group key={group.key} group={group}>
          {spec.fields
            .filter((f) => f.group === group.key)
            .map((field) => (
              <Field key={field.key} field={field}>
                <Input
                  field={field}
                  value={values[field.key]}
                  options={field.options ?? dynamicOptions[field.key] ?? []}
                  tagOptions={listing.tagOptions[field.key as ToolTagKey] ?? []}
                  onChange={(v) => set(field.key, v)}
                />
              </Field>
            ))}
        </Group>
      ))}

      {reviewNote && <p className="text-sm text-muted-2">{reviewNote}</p>}

      <SaveStatusLine status={status} onRetry={saveNow} failuresOnly />
    </form>
  )
}

// #region inputs

function Input({
  field,
  value,
  options,
  tagOptions,
  onChange,
}: {
  field: ListingFieldSpec
  value: ListingFormValues[string] | undefined
  options: readonly string[]
  /** kind 'tags' only: the slug and label pairs the picker shows. */
  tagOptions: readonly TagOption[]
  onChange: (value: string | boolean | string[] | ExtraLink[]) => void
}) {
  if (field.kind === 'links') {
    return (
      <ExtraLinksEditor label={field.label} links={asExtraLinks(value)} onChange={onChange} />
    )
  }

  if (field.kind === 'tags') {
    return (
      <TagPicker
        name={field.key}
        label={field.label}
        options={tagOptions}
        values={Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []}
        onChange={onChange}
      />
    )
  }

  if (field.kind === 'checkbox') {
    return (
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          name={field.key}
          value="true"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <span className="text-sm text-foreground">{field.label}</span>
      </span>
    )
  }

  const text = typeof value === 'string' ? value : ''

  if (field.kind === 'select') {
    return (
      <select
        name={field.key}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {field.optionLabels?.[o] ?? humanize(o)}
          </option>
        ))}
      </select>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <textarea
        name={field.key}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={field.rows ?? 4}
        maxLength={field.maxLength}
        className="input"
      />
    )
  }

  return (
    <input
      type={inputType(field.kind)}
      name={field.key}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      step={field.kind === 'number' ? 'any' : undefined}
      maxLength={field.kind === 'int' || field.kind === 'number' || field.kind === 'date' ? undefined : field.maxLength}
      min={field.kind === 'int' || field.kind === 'number' ? field.min : undefined}
      max={field.kind === 'int' || field.kind === 'number' ? field.max : undefined}
      inputMode={field.kind === 'int' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined}
      placeholder={field.kind === 'url' ? 'https://' : undefined}
      className="input"
    />
  )
}

function inputType(kind: ListingFieldSpec['kind']): string {
  switch (kind) {
    case 'int':
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'email':
      return 'email'
    case 'url':
      return 'url'
    default:
      return 'text'
  }
}

/** snake_case enum member to something readable, when no label was given. */
function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// #endregion

// #region chrome

function Group({ group, children }: { group: ListingGroup; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{group.title}</h2>
      {group.blurb && <p className="mt-1 max-w-2xl text-sm text-muted">{group.blurb}</p>}
      <div className="mt-4 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({ field, children }: { field: ListingFieldSpec; children: React.ReactNode }) {
  // A checkbox carries its own label next to the box, so repeating it above
  // would read as two separate settings.
  const showLabel = field.kind !== 'checkbox'
  // A tag picker is a group of buttons, not one control, so it cannot sit in a
  // <label>: a label may only name a single form element, and wrapping a dozen
  // of them makes every chip read as the same thing. It names itself with
  // aria-label instead and this is a plain container. The repeatable link list
  // is the same case, with two inputs and a remove button per row.
  const many = field.kind === 'tags' || field.kind === 'links'
  const Wrapper = many ? 'div' : 'label'
  return (
    <Wrapper
      className={cn(
        'flex flex-col',
        field.wide && 'sm:col-span-2',
        // A chip row needs a little more air above it than a text box does,
        // because the chips have a border and the label does not. Same for a
        // row of link boxes with a button beside them.
        many ? 'gap-2' : 'gap-1.5',
      )}
    >
      {showLabel && <span className="text-sm font-medium text-foreground">{field.label}</span>}
      {many && field.hint && (
        // Above the chips for a picker, and above the rows for the link list.
        // Under them it sat below a wrapping row of buttons and read as a
        // caption for the next field.
        <span className="-mt-0.5 text-xs text-muted-2">{field.hint}</span>
      )}
      {children}
      {!many && field.hint && <span className="text-xs text-muted-2">{field.hint}</span>}
    </Wrapper>
  )
}

/**
 * The save state, in words.
 *
 * Nothing here is pinned, for the reason the team profile form gives: an
 * on-screen keyboard shrinks the visual viewport, so a bottom-pinned bar pops
 * in and out on every scroll. It sits in the flow at a fixed height so a status
 * change never moves the field under the cursor, and it renders twice: once
 * above the fields and, when a save has failed, once below them. A failure is
 * the one state where the user has text that is not stored.
 */
function SaveStatusLine({
  status,
  onRetry,
  failuresOnly,
}: {
  status: SaveStatus
  onRetry: () => void
  /** The copy below the fields, which stays out of the way unless something broke. */
  failuresOnly?: boolean
}) {
  if (status.kind === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-frc/30 bg-frc/10 px-3 py-2">
        {/* role=alert, not status: this is the message that costs the user
            something. Only the first copy announces, or it is read out twice. */}
        <span role={failuresOnly ? undefined : 'alert'} className="text-sm text-frc">
          Not saved. {status.message}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-frc/40 px-2.5 py-1 text-sm font-medium text-frc transition-colors hover:bg-frc/10"
        >
          Retry
        </button>
      </div>
    )
  }

  if (failuresOnly) return null

  // There is no Save button on this form, and the first thing someone does on a
  // form with no Save button is look for the Save button. This line is the
  // answer, so it has to be findable: the status dot pattern, stuck to the top
  // of the form so it stays on screen while a long one is scrolled. As muted
  // 14px text above the first field it read as a caption and got missed.
  //
  // The dot carries the state and the words confirm it, which is why the dot
  // has a colour per state rather than being decoration. It pulses only while
  // a request is actually in flight, so motion means something is happening.
  const saving = status.kind === 'saving'
  const saved = status.kind === 'saved'

  return (
    <div className="sticky top-2 z-10 flex min-h-9 items-center">
      <span
        role="status"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium backdrop-blur',
          saved
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border-subtle bg-surface/90 text-muted',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            saving
              ? 'animate-pulse bg-official'
              : saved
                ? 'bg-primary'
                : status.dirty
                  ? 'bg-official'
                  : 'bg-muted-2',
          )}
        />
        {saving ? 'Saving…' : saved ? 'Saved' : status.dirty ? 'Not saved yet' : 'Saves as you type'}
      </span>
    </div>
  )
}

// #endregion
