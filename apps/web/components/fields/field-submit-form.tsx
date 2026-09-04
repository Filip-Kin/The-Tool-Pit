'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cardClass } from '@/components/ui/card'
import { PassingAlongCheckbox } from '@/components/submit/passing-along-checkbox'
import { PASSING_ALONG_DEFAULT } from '@/lib/listings/passing-along'
import { SubmitConfirmation } from '@/components/ui/submit-confirmation'
import { X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { PinMap } from './pin-map'
import type { PublicField, FieldPhotoRef } from '@/lib/fields/field-display'
import {
  COVERAGE_LABEL,
  PERIMETER_LABEL,
  ELEMENTS_LABEL,
  AVAILABILITY_LABEL,
} from '@/lib/fields/field-display'
// Value tuples come from the zero-dependency enum subpath (NOT the barrel),
// so the DB client / postgres never lands in the client bundle.
import { FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY } from '@the-tool-pit/db/field-enums'
import { useSession, type SessionUser } from '@/components/auth/session-provider'
import { SignInDialog } from '@/components/auth/sign-in-dialog'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'error-callback': () => void
          'expired-callback': () => void
          theme?: 'light' | 'dark' | 'auto'
        },
      ) => string
      reset: (widgetId: string) => void
    }
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
type Program = 'frc' | 'ftc' | 'fll'

interface FormState {
  name: string
  teamNumber: string
  teamName: string
  program: Program
  address: string
  city: string
  region: string
  country: string
  coverage: string
  perimeter: string
  elements: string
  hasFms: boolean
  ceilingHeightFt: string
  availability: string
  hours: string
  contactInfo: string
  contactUrl: string
  website: string
  notes: string
  submitterName: string
  submitterContact: string
}

const INITIAL: FormState = {
  name: '',
  teamNumber: '',
  teamName: '',
  program: 'frc',
  address: '',
  city: '',
  region: '',
  country: '',
  coverage: 'full',
  perimeter: 'none',
  elements: 'wood',
  hasFms: false,
  ceilingHeightFt: '',
  availability: 'unknown',
  hours: '',
  contactInfo: '',
  contactUrl: '',
  website: '',
  notes: '',
  submitterName: '',
  submitterContact: '',
}

/** Map a published field to the form state, for pre-filling an edit. */
function fieldToFormState(f: PublicField): FormState {
  return {
    name: f.name,
    teamNumber: f.teamNumber != null ? String(f.teamNumber) : '',
    teamName: f.teamName ?? '',
    program: (f.program as Program) ?? 'frc',
    address: f.address ?? '',
    city: f.city ?? '',
    region: f.region ?? '',
    country: f.country ?? '',
    coverage: f.coverage,
    perimeter: f.perimeter,
    elements: f.elements,
    hasFms: f.hasFms,
    ceilingHeightFt: f.ceilingHeightFt != null ? String(f.ceilingHeightFt) : '',
    availability: f.availability,
    hours: f.hours ?? '',
    contactInfo: f.contactInfo ?? '',
    contactUrl: f.contactUrl ?? '',
    website: f.website ?? '',
    notes: f.notes ?? '',
    submitterName: '',
    submitterContact: '',
  }
}

/**
 * What the "You" fields start as for a given viewer. Signed in we fill them
 * from the account so nobody retypes their own name, signed out they stay
 * blank exactly as before.
 */
function submitterDefaults(user: SessionUser | null): Pick<FormState, 'submitterName' | 'submitterContact'> {
  return {
    submitterName: user?.displayName ?? '',
    submitterContact: user?.email ?? '',
  }
}

/**
 * The field submit form. In `edit` mode it is pre-filled from an existing field
 * and posts an edit proposal (for admin approval) instead of a new field.
 *
 * Sign-in is optional throughout. The account is never checked before posting:
 * the server reads it from the session cookie if it is there, and a signed-out
 * submission is a first-class submission. Getting a field on the map must not
 * depend on having an account.
 */
export function FieldSubmitForm({
  edit,
  admin,
  onSubmitted,
}: {
  edit?: { field: PublicField }
  /**
   * Admin mode, for /admin/new/field. Same form, because the fields are the
   * same fields and a second one would drift from this one. The Turnstile
   * check goes (an admin session already proved who this is), and so do the
   * private "You" box and the passing-along question. The choice to publish it
   * now instead of queueing it for review arrives.
   *
   * A hint to the UI and NOT a permission: the route it posts to checks the
   * admin session itself, so flipping this in devtools gets a 401.
   */
  admin?: boolean
  onSubmitted?: () => void
} = {}) {
  const adminMode = !!admin && !edit
  // An admin session stands in for the bot check. Nothing else turns it off.
  const needsTurnstile = Boolean(SITE_KEY) && !adminMode
  // Ticked by default: an admin filling this in has just read the source, so
  // the review they would otherwise queue up for themselves is one they have
  // already done.
  const [publishNow, setPublishNow] = useState(true)
  const editing = !!edit
  const { user } = useSession()
  const [signInOpen, setSignInOpen] = useState(false)
  const [form, setForm] = useState<FormState>(edit ? fieldToFormState(edit.field) : INITIAL)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    edit && edit.field.latitude != null && edit.field.longitude != null
      ? { lat: edit.field.latitude, lng: edit.field.longitude }
      : null,
  )
  const [newPhotos, setNewPhotos] = useState<File[]>([])
  const [removePhotoIds, setRemovePhotoIds] = useState<string[]>([])
  const [editReason, setEditReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Unticked, like every other submit form. See lib/listings/passing-along.ts.
  const [passingAlong, setPassingAlong] = useState(PASSING_ALONG_DEFAULT.field)
  const [result, setResult] = useState<{ ok?: boolean; message: string } | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // The session resolves after first paint on some routes, so fill the "You"
  // fields when it lands. Only ever fills blanks: someone submitting on behalf
  // of a team mate has already typed the right name and we must not stomp it.
  // Keyed on the user id so a sign-in mid-form still prefills, once.
  const prefilledForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user || prefilledForRef.current === user.id) return
    prefilledForRef.current = user.id
    const defaults = submitterDefaults(user)
    setForm((f) => ({
      ...f,
      submitterName: f.submitterName || defaults.submitterName,
      submitterContact: f.submitterContact || defaults.submitterContact,
    }))
  }, [user])

  useEffect(() => {
    if (!needsTurnstile || !turnstileRef.current) return
    function renderWidget() {
      if (!turnstileRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'error-callback': () => setTurnstileToken(null),
        'expired-callback': () => setTurnstileToken(null),
        theme: 'auto',
      })
    }
    if (window.turnstile) {
      renderWidget()
      return
    }
    if (!document.getElementById('cf-turnstile-script')) {
      const script = document.createElement('script')
      script.id = 'cf-turnstile-script'
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      script.async = true
      script.defer = true
      script.onload = renderWidget
      document.head.appendChild(script)
    } else {
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll)
          renderWidget()
        }
      }, 100)
      return () => clearInterval(poll)
    }
  }, [needsTurnstile])

  function resetTurnstile() {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setResult({ ok: false, message: 'Please give the field a name.' })
      return
    }
    if (!coords) {
      setResult({ ok: false, message: 'Please drop a pin on the map so the field can be placed.' })
      return
    }
    if (needsTurnstile && !turnstileToken) {
      setResult({ ok: false, message: 'Please complete the “I’m not a robot” check.' })
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const fd = new FormData()
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'boolean') fd.set(k, v ? 'true' : 'false')
        else if (v) fd.set(k, v)
      }
      fd.set('latitude', String(coords.lat))
      fd.set('longitude', String(coords.lng))
      for (const f of newPhotos) fd.append('photos', f)
      if (editing) {
        if (editReason.trim()) fd.set('editReason', editReason.trim())
        fd.set('removePhotoIds', JSON.stringify(removePhotoIds))
      }
      if (turnstileToken) fd.set('turnstileToken', turnstileToken)
      // Always explicit, never left to a default the server would have to guess.
      if (adminMode) fd.set('publish', publishNow ? 'true' : 'false')
      else if (!editing) fd.set('passingAlong', passingAlong ? 'true' : 'false')

      const url = adminMode
        ? '/admin/api/listings/field'
        : editing
          ? `/api/fields/${edit.field.id}/edit`
          : '/api/fields/submit'
      const res = await fetch(url, { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        if (editing) {
          setNewPhotos([])
          setRemovePhotoIds([])
          resetTurnstile()
          onSubmitted?.()
        } else {
          // Clearing back to blank would drop the account prefill, so put it
          // straight back for the next field they add.
          setForm({ ...INITIAL, ...submitterDefaults(user) })
          setCoords(null)
          setNewPhotos([])
          resetTurnstile()
        }
      } else {
        setResult({ ok: false, message: data.error ?? 'Submission failed.' })
        resetTurnstile()
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  const noun = editing ? 'edit' : 'submission'

  // A successful submit replaces the whole form with a terminal confirmation, so
  // there is no re-enabled button and no re-solved Turnstile to fire the same
  // field or edit twice. The dialog-hosted edit flow leaves out "Submit another"
  // and relies on the dialog close; a create page gets a way back to a blank one.
  if (result?.ok) {
    return (
      <SubmitConfirmation
        message={result.message}
        title={editing ? 'Thanks, your edit is in for review' : undefined}
        onSubmitAnother={
          editing
            ? undefined
            : () => {
                setForm({ ...INITIAL, ...submitterDefaults(user) })
                setCoords(null)
                setNewPhotos([])
                setResult(null)
              }
        }
      />
    )
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {editing && (
          <Section title="What changed" hint="A quick note on what you're updating and why (optional). Your edit is reviewed before it goes live.">
            <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} className="input resize-y" placeholder="e.g. we now have realistic hub lighting and timing for this season" />
          </Section>
        )}
        <Section title="The field">
          <Field label="Field or facility name" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Motor City Alliance Field" className="input" required />
          </Field>
          <div className="flex gap-3">
            <div className="w-32">
              <Field label="Team number">
                <input type="number" inputMode="numeric" min={1} value={form.teamNumber} onChange={(e) => set('teamNumber', e.target.value)} placeholder="5577" className="input" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Team / organisation">
                <input value={form.teamName} onChange={(e) => set('teamName', e.target.value)} placeholder="Kinematic Wolves" className="input" />
              </Field>
            </div>
            <div className="w-28">
              <Field label="Program">
                <select value={form.program} onChange={(e) => set('program', e.target.value as Program)} className="input uppercase">
                  <option value="frc">FRC</option>
                  <option value="ftc">FTC</option>
                  <option value="fll">FLL</option>
                </select>
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Where it is" hint="Search an address or drop a pin on the exact spot, then fine-tune by dragging. The address, city and state fill in automatically from the pin - edit them if anything looks off.">
          <PinMap
            value={coords}
            onChange={setCoords}
            onResolveAddress={(p) =>
              setForm((f) => ({
                ...f,
                ...(p.address ? { address: p.address } : {}),
                ...(p.city ? { city: p.city } : {}),
                ...(p.region ? { region: p.region } : {}),
                ...(p.country ? { country: p.country } : {}),
              }))
            }
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="Address">
                <input value={form.address} onChange={(e) => set('address', e.target.value)} className="input" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="City">
                <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Detroit" className="input" />
              </Field>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="State / region">
                <input value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="MI" className="input" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Country">
                <input value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="USA" className="input" />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Field spec">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="Coverage">
                <select value={form.coverage} onChange={(e) => set('coverage', e.target.value)} className="input">
                  {FIELD_COVERAGE.map((c) => <option key={c} value={c}>{COVERAGE_LABEL[c]}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Game elements" hint="Go by your major elements - if the main ones are official, pick official even if a few are shop-built. Use your best judgement and add specifics in the notes.">
                <select value={form.elements} onChange={(e) => set('elements', e.target.value)} className="input">
                  {FIELD_ELEMENTS.map((el) => <option key={el} value={el}>{ELEMENTS_LABEL[el]}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Perimeter">
                <select value={form.perimeter} onChange={(e) => set('perimeter', e.target.value)} className="input">
                  {FIELD_PERIMETER.map((p) => <option key={p} value={p}>{PERIMETER_LABEL[p]}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <Check checked={form.hasFms} onChange={(v) => set('hasFms', v)} label="Has an FMS" />
            <label className="flex items-center gap-2 text-sm text-foreground">
              Ceiling height
              <input type="number" inputMode="decimal" min={1} step="0.5" value={form.ceilingHeightFt} onChange={(e) => set('ceilingHeightFt', e.target.value)} placeholder="ft" className="input w-24" />
              <span className="text-xs text-muted-2">ft</span>
            </label>
          </div>
          <p className="text-xs text-muted-2">Ceiling height can be approximate. It mainly flags whether the field is tall enough to shoot - anything under 12 ft is marked as a low ceiling.</p>
        </Section>

        <Section title="Access">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="Availability" hint="Roughly when in the year the field is set up. How to actually get access is below.">
                <select value={form.availability} onChange={(e) => set('availability', e.target.value)} className="input">
                  {FIELD_AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Days / hours open" hint="Free text, e.g. weeknights 6-9pm in build season.">
                <input value={form.hours} onChange={(e) => set('hours', e.target.value)} className="input" />
              </Field>
            </div>
          </div>
          <Field label="How to arrange access" hint="Most fields are by arrangement - say what a visiting team should do to book time.">
            <textarea value={form.contactInfo} onChange={(e) => set('contactInfo', e.target.value)} rows={2} className="input resize-y" />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="Sign-up form link" hint="Only if there's a booking form or sign-up page (e.g. a Google Form). With one, the field shows as sign-up instead of by arrangement.">
                <input type="url" value={form.contactUrl} onChange={(e) => set('contactUrl', e.target.value)} placeholder="https://forms.gle/…" className="input" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Website">
                <input type="url" value={form.website} onChange={(e) => set('website', e.target.value)} className="input" />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Extras">
          <Field label="Notes" hint="Anything else visiting teams should know.">
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="input resize-y" />
          </Field>
          <Field
            label="Photos of the field"
            hint={
              editing
                ? 'Add or remove photos. Changes are reviewed before they go live. Up to 8, max 25 MB each and 50 MB in total.'
                : 'Optional. Reviewed before it goes live. Up to 8 photos, max 25 MB each and 50 MB in total.'
            }
          >
            <PhotoEditor
              existing={edit?.field.photos ?? []}
              removeIds={removePhotoIds}
              onToggleRemove={(id) =>
                setRemovePhotoIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
              }
              files={newPhotos}
              onAddFiles={(fs) => setNewPhotos((prev) => [...prev, ...fs].slice(0, 8))}
              onRemoveFile={(i) => setNewPhotos((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </Field>
        </Section>

        {!adminMode && (
        <Section title="You" hint="Private - only the moderators see this, never shown publicly.">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field label="Your name">
                <input value={form.submitterName} onChange={(e) => set('submitterName', e.target.value)} className="input" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="How to reach you">
                <input value={form.submitterContact} onChange={(e) => set('submitterContact', e.target.value)} className="input" />
              </Field>
            </div>
          </div>
          {user ? (
            <p className="text-xs text-muted-2">
              Signed in as {user.displayName || user.email}. This {noun} will be credited to your account.
            </p>
          ) : (
            <p className="text-xs text-muted-2">
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Sign in to track this {noun}
              </button>{' '}
              (optional, it works fine without one).
            </p>
          )}
        </Section>
        )}

        {!editing && !adminMode && (
          <PassingAlongCheckbox checked={passingAlong} onChange={setPassingAlong} noun="practice field" />
        )}

        {adminMode && (
          <Check
            checked={publishNow}
            onChange={setPublishNow}
            label="Publish it now, without a second pass through the review queue"
          />
        )}

        {needsTurnstile && <div ref={turnstileRef} className="min-h-[65px]" />}

        <Button
          type="submit"
          disabled={submitting || !form.name.trim() || !coords || (needsTurnstile && !turnstileToken)}
          className="self-start"
        >
          {submitting
            ? 'Submitting…'
            : adminMode
              ? publishNow
                ? 'Create and publish'
                : 'Create for review'
              : editing
                ? 'Submit edit for review'
                : 'Submit field'}
        </Button>

        {result && <p className={result.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>{result.message}</p>}
      </form>

      {/* Opened only from the quiet link in the "You" section, never
          automatically: an interrupting modal is exactly what would cost us
          submissions. It sits OUTSIDE the form on purpose. React events from a
          portal bubble up the React tree, so a dialog rendered inside the form
          would fire this form's onSubmit when someone signs in with a password. */}
      <SignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        reason={`Optional. Signing in credits this ${noun} to you and lets you find it later.`}
      />
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className={cardClass({ className: 'flex flex-col gap-4' })}>
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-muted-2">{hint}</p>}
      {children}
    </fieldset>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-frc"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-2">{hint}</span>}
    </label>
  )
}

/** Object-URL previews for picked files, revoked when the selection changes. */
function usePreviews(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f))
    setUrls(next)
    return () => next.forEach((u) => URL.revokeObjectURL(u))
  }, [files])
  return urls
}

/**
 * Gallery editor: shows existing photos with a remove/keep toggle, plus a
 * thumbnail preview of newly picked files. Used for both new submissions
 * (no existing photos) and edit proposals.
 */
function PhotoEditor({
  existing,
  removeIds,
  onToggleRemove,
  files,
  onAddFiles,
  onRemoveFile,
}: {
  existing: FieldPhotoRef[]
  removeIds: string[]
  onToggleRemove: (id: string) => void
  files: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
}) {
  const previews = usePreviews(files)
  const hasThumbs = existing.length > 0 || files.length > 0
  return (
    <div className="flex flex-col gap-3">
      {hasThumbs && (
        <div className="flex flex-wrap gap-2">
          {existing.map((p) => {
            const removed = removeIds.includes(p.id)
            return (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  className={cn('h-20 w-24 rounded-md border border-border object-cover', removed && 'opacity-30 grayscale')}
                />
                <button
                  type="button"
                  onClick={() => onToggleRemove(p.id)}
                  aria-label={removed ? 'Keep photo' : 'Remove photo'}
                  className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
                >
                  {removed ? <RotateCcw className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </button>
                {removed && (
                  <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 py-0.5 text-center text-[10px] font-medium text-white">
                    Will remove
                  </span>
                )}
              </div>
            )
          })}
          {previews.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-20 w-24 rounded-md border border-primary/60 object-cover" />
              <span className="absolute left-1 top-1 rounded bg-primary px-1 text-[10px] font-medium text-white">New</span>
              <button
                type="button"
                onClick={() => onRemoveFile(i)}
                aria-label="Remove photo"
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          onAddFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
        className="input"
      />
    </div>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={cn('h-4 w-4 rounded border-border accent-[var(--color-primary)]')} />
      {label}
    </label>
  )
}
