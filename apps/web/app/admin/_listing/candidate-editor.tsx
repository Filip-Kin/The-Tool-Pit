'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddressField } from '@/components/fields/address-field'
import { DateField } from '@/components/ui/date-field'
import type { AddressParts } from '@/app/api/fields/geocode/route'

/**
 * Review a discovered candidate by CORRECTING it, then accept.
 *
 * The queue used to show the read values as text and offer one box, for the
 * name. Everything else had to be fixed afterwards on another screen, which on
 * a phone meant reading the candidate, accepting it, finding the listing,
 * opening it, and typing the four things that were wrong. Nobody does that
 * twice.
 *
 * So the fields are the form. Every value the reader found is in a box with the
 * sentence it came from underneath it, and correcting a wrong venue is typing
 * in the box next to the quote that produced it. Same idea as the grants review
 * deck, which is the pattern this platform already settled on.
 *
 * ONE COLUMN ON A PHONE, two above `sm`. The controls are full-height and the
 * labels sit above rather than beside, because a 6rem label column next to a
 * 200-character quote is unreadable at 375px.
 */

export interface EditableField {
  /** Key on the extracted object, which is also the name posted back. */
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox'
  options?: readonly string[]
  value?: string | number | boolean | null
  /** The sentence behind the value, and which page said it. */
  evidence?: { quote: string; source: string }
  /** Full width on a two-column layout. */
  wide?: boolean
  hint?: string
}

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary'

function sourceLabel(source: string): string {
  if (source === 'thread') return 'thread'
  try {
    const url = new URL(source)
    const path = url.pathname.replace(/\/$/, '')
    return `${url.host.replace(/^www\./, '')}${path.length > 1 ? path : ''}`
  } catch {
    return source
  }
}

function Field({ field }: { field: EditableField }) {
  const value = field.value ?? ''
  const common = { name: field.name, id: field.name, className: inputClass }

  return (
    <label className={`flex flex-col gap-1 ${field.wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-medium text-muted">{field.label}</span>

      {field.type === 'select' ? (
        <select {...common} defaultValue={String(value)}>
          <option value="">not set</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea {...common} rows={3} defaultValue={String(value)} />
      ) : field.type === 'date' ? (
        // ONE date picker, ISO on the wire, the viewer's locale on screen. This
        // is the uncontrolled form-POST path: a hidden input carries the ISO
        // value under field.name so the accept FormData reads it as before.
        <DateField name={field.name} defaultValue={String(value)} id={field.name} />
      ) : field.type === 'checkbox' ? (
        <span className="flex items-center gap-2">
          {/* A hidden partner so an unchecked box posts a value rather than
              vanishing, which is how a "no" becomes "not set". */}
          <input type="hidden" name={field.name} value="false" />
          <input
            type="checkbox"
            name={field.name}
            value="true"
            defaultChecked={value === true}
            className="h-5 w-5 rounded border-border accent-primary"
          />
          <span className="text-sm text-foreground">yes</span>
        </span>
      ) : (
        <input
          {...common}
          type={field.type === 'number' ? 'number' : 'text'}
          defaultValue={String(value)}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
        />
      )}

      {field.hint && <span className="text-[10px] text-muted-2">{field.hint}</span>}

      {field.evidence?.quote && (
        <span className="flex flex-wrap items-start gap-1.5 text-[10px] leading-snug">
          <span className="shrink-0 rounded bg-official/20 px-1 py-px font-medium uppercase tracking-wide text-official">
            {sourceLabel(field.evidence.source)}
          </span>
          <span className="min-w-0 break-words italic text-muted">“{field.evidence.quote}”</span>
        </span>
      )}
    </label>
  )
}

/**
 * Optional verified-address search at the top of the editor.
 *
 * The event candidate accept flow needs a way to place the listing: a reviewer
 * searches an address, picks a real geocoded match, its parts fill the boxes
 * below, and the confirmed coordinates ride along with Accept so the listing
 * lands on the map without a second geocode round trip. The old draggable map
 * was replaced by this box: it takes far less room and, crucially, shows whether
 * the address is verified BEFORE Accept, so a bad address is caught in the form
 * instead of silently dropping the listing back into pending. When this prop is
 * absent (the practice-field queue) the editor is exactly the plain form it was.
 */
export interface PinMapConfig {
  /** The coordinates the candidate already carries, if any. */
  initial: { lat: number; lng: number } | null
}

export function CandidateEditor({
  candidateId,
  fields,
  accept,
  acceptLabel,
  note,
  pinMap,
}: {
  candidateId: string
  fields: EditableField[]
  /** Takes the corrected values. Returns where it went, or what it still needs. */
  accept: (candidateId: string, values: Record<string, string>) => Promise<{
    error?: string
    pending?: string
  }>
  acceptLabel: string
  note: string
  /** Present only for the event queue: a pin map that fills the address boxes and captures coordinates for Accept. */
  pinMap?: PinMapConfig
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(pinMap?.initial ?? null)

  /**
   * Write the pin's resolved address parts into the uncontrolled boxes.
   *
   * The fields are defaultValue inputs, so the map fills them by writing into
   * the live DOM elements rather than through React state. A part the geocoder
   * did not resolve is left alone, so a good value the reviewer already typed is
   * never wiped by an empty reverse-geocode.
   */
  function fillAddress(parts: AddressParts) {
    const form = formRef.current
    if (!form) return
    for (const key of ['address', 'city', 'region', 'country'] as const) {
      const value = parts[key]
      if (value == null || value === '') continue
      const el = form.elements.namedItem(key)
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        el.value = value
      }
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const values: Record<string, string> = {}
    for (const [key, v] of data.entries()) {
      // A checkbox posts its hidden "false" first and "true" second when
      // ticked, so the last value wins and an unticked box stays false.
      values[key] = typeof v === 'string' ? v : ''
    }

    setError(null)
    setPendingNote(null)
    start(async () => {
      const res = await accept(candidateId, values)
      if (res.error) setError(res.error)
      else if (res.pending) setPendingNote(res.pending)
      router.refresh()
    })
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
      {pinMap && (
        <>
          <AddressField
            verified={coords != null}
            onPick={(parts, c) => {
              fillAddress(parts)
              setCoords(c)
            }}
            onClear={() => setCoords(null)}
          />
          {/* The confirmed coordinates ride along with Accept. They are preferred
              over a geocode of the typed address, so the reviewer's verified pick
              wins and the accept path never has to guess. */}
          <input type="hidden" name="latitude" value={coords?.lat ?? ''} readOnly />
          <input type="hidden" name="longitude" value={coords?.lng ?? ''} readOnly />
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} field={f} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={busy}
          // Full width and finger-sized on a phone; ordinary button on desktop.
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40 sm:w-auto sm:self-start sm:py-2"
        >
          {busy ? 'Saving…' : acceptLabel}
        </button>
        <p className="text-[10px] text-muted-2">{note}</p>
        {pendingNote && <p className="text-xs text-stale">{pendingNote}</p>}
        {error && <p className="text-xs text-frc">{error}</p>}
      </div>
    </form>
  )
}
