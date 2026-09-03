'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cardClass } from '@/components/ui/card'
import { PassingAlongCheckbox } from '@/components/submit/passing-along-checkbox'
import { PASSING_ALONG_DEFAULT } from '@/lib/listings/passing-along'
import { SubmitConfirmation } from '@/components/ui/submit-confirmation'
import { cn } from '@/lib/utils/cn'
// The verified-address search and the shared date picker, reused so the public
// submit form matches the admin editors box for box.
import { AddressField } from '@/components/fields/address-field'
import { DateField } from '@/components/ui/date-field'
import {
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db/event-enums'
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  VOLUNTEER_STATUS_LABEL,
} from '@/lib/events/event-display'
import type { PublicEvent } from '@/lib/events/event-display'
import { useSession } from '@/components/auth/session-provider'

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
  program: Program
  hostTeamNumber: string
  venueName: string
  address: string
  city: string
  region: string
  country: string
  startDate: string
  endDate: string
  days: string
  parallelDivisions: boolean
  capacity: string
  costUsd: string
  costNote: string
  registrationStatus: string
  registrationOpensAt: string
  volunteerStatus: string
  eventStatus: string
  website: string
  registrationUrl: string
  teamListUrl: string
  volunteerUrl: string
  chiefDelphiUrl: string
  contactEmail: string
  notes: string
  submitterName: string
  submitterContact: string
}

/**
 * Last year's listing, as the renewal link hands it over.
 *
 * Public columns only, and no dates: see buildRenewal in the submit page for
 * why. Every field is optional-shaped because it comes off a listing that was
 * itself allowed to be incomplete.
 */
export interface RenewalPrefill {
  previousListingId: string
  previousSeasonYear: number | null
  name: string
  program: string
  hostTeamNumber: number | null
  latitude: number | null
  longitude: number | null
  venueName: string | null
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  days: number | null
  parallelDivisions: boolean
  capacity: number | null
  costUsd: number | null
  costNote: string | null
  website: string | null
  registrationUrl: string | null
  volunteerUrl: string | null
  chiefDelphiUrl: string | null
  contactEmail: string | null
  notes: string | null
}

const INITIAL: FormState = {
  name: '',
  program: 'frc',
  hostTeamNumber: '',
  venueName: '',
  address: '',
  city: '',
  region: '',
  country: '',
  startDate: '',
  endDate: '',
  days: '',
  parallelDivisions: false,
  capacity: '',
  costUsd: '',
  costNote: '',
  registrationStatus: 'unknown',
  registrationOpensAt: '',
  volunteerStatus: 'unknown',
  eventStatus: 'confirmed',
  website: '',
  registrationUrl: '',
  teamListUrl: '',
  volunteerUrl: '',
  chiefDelphiUrl: '',
  contactEmail: '',
  notes: '',
  submitterName: '',
  submitterContact: '',
}

/** A prefill, folded onto the empty form. A missing value stays empty. */
function fromRenewal(r: RenewalPrefill): FormState {
  const s = (v: string | null) => v ?? ''
  const n = (v: number | null) => (v == null ? '' : String(v))
  return {
    ...INITIAL,
    name: r.name,
    program: (['frc', 'ftc', 'fll'] as const).includes(r.program as Program) ? (r.program as Program) : 'frc',
    hostTeamNumber: n(r.hostTeamNumber),
    venueName: s(r.venueName),
    address: s(r.address),
    city: s(r.city),
    region: s(r.region),
    country: s(r.country),
    days: n(r.days),
    parallelDivisions: r.parallelDivisions,
    capacity: n(r.capacity),
    costUsd: n(r.costUsd),
    costNote: s(r.costNote),
    website: s(r.website),
    registrationUrl: s(r.registrationUrl),
    volunteerUrl: s(r.volunteerUrl),
    chiefDelphiUrl: s(r.chiefDelphiUrl),
    contactEmail: s(r.contactEmail),
    notes: s(r.notes),
    // startDate, endDate, registrationStatus and registrationOpensAt keep their
    // empty defaults on purpose. They are the four fields that are about THIS
    // year, and carrying last year's across is how a wrong date gets published.
  }
}

/**
 * A published listing, folded onto the form for an edit. Unlike a renewal this
 * DOES carry the dates and registration state across: an edit is a correction
 * to the same event, not a fresh one, so every field starts where it is now.
 */
function fromEvent(ev: PublicEvent): FormState {
  const s = (v: string | null) => v ?? ''
  const n = (v: number | null) => (v == null ? '' : String(v))
  return {
    ...INITIAL,
    name: ev.name,
    program: (['frc', 'ftc', 'fll'] as const).includes(ev.program as Program) ? (ev.program as Program) : 'frc',
    hostTeamNumber: n(ev.hostTeamNumber),
    venueName: s(ev.venueName),
    address: s(ev.address),
    city: s(ev.city),
    region: s(ev.region),
    country: s(ev.country),
    startDate: s(ev.startDate),
    endDate: s(ev.endDate),
    days: n(ev.days),
    parallelDivisions: ev.parallelDivisions,
    capacity: n(ev.capacity),
    costUsd: n(ev.costUsd),
    costNote: s(ev.costNote),
    registrationStatus: ev.registrationStatus,
    registrationOpensAt: s(ev.registrationOpensAt),
    volunteerStatus: ev.volunteerStatus,
    eventStatus: ev.eventStatus,
    website: s(ev.website),
    registrationUrl: s(ev.registrationUrl),
    // Read defensively: the field lives client-side here until the shared
    // PublicEvent type carries it, so it prefills empty rather than failing to
    // typecheck against the current type.
    teamListUrl: s((ev as { teamListUrl?: string | null }).teamListUrl ?? null),
    volunteerUrl: s(ev.volunteerUrl),
    chiefDelphiUrl: s(ev.chiefDelphiUrl),
    contactEmail: s(ev.contactEmail),
    notes: s(ev.notes),
  }
}

/**
 * The off-season event submit form. Sign-in is optional throughout: the server
 * reads the session cookie if it is there, and a signed-out submission is a
 * first-class submission. Getting an event on the map must not need an account.
 *
 * `edit` turns it into an anonymous "Suggest an edit" for an existing listing:
 * every box arrives filled in and the post goes to the edit-proposal route for
 * moderation instead of creating a new listing. Same open-to-everyone rule.
 *
 * `renewal` turns it into next year's listing for an event that already ran.
 * It is still a normal submission: same moderation queue, same rules. The only
 * differences are that most of the boxes arrive filled in and the new row
 * carries previousListingId, which is what links the two seasons together.
 */
export function EventSubmitForm({
  renewal,
  edit,
  onSubmitted,
}: {
  renewal?: RenewalPrefill | null
  /** An existing listing to correct, rather than a new one to add. */
  edit?: { event: PublicEvent } | null
  /** Called after a successful edit, so a host dialog can keep the confirmation up. */
  onSubmitted?: () => void
} = {}) {
  const { user } = useSession()
  const editing = !!edit
  const [form, setForm] = useState<FormState>(() =>
    edit ? fromEvent(edit.event) : renewal ? fromRenewal(renewal) : INITIAL,
  )
  const [editReason, setEditReason] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    // The pin is the single most tedious part of this form and the venue almost
    // never moves, so an edit or a renewal starts with it already dropped.
    edit && edit.event.latitude != null && edit.event.longitude != null
      ? { lat: edit.event.latitude, lng: edit.event.longitude }
      : renewal && renewal.latitude != null && renewal.longitude != null
        ? { lat: renewal.latitude, lng: renewal.longitude }
        : null,
  )
  const [submitting, setSubmitting] = useState(false)
  // Unticked, like every other submit form. See lib/listings/passing-along.ts.
  const [passingAlong, setPassingAlong] = useState(PASSING_ALONG_DEFAULT.event)
  const [result, setResult] = useState<{ ok?: boolean; message: string } | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Fill the private "You" fields from the account when the session lands, once,
  // and never over a value the submitter already typed.
  const prefilledForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user || prefilledForRef.current === user.id) return
    prefilledForRef.current = user.id
    setForm((f) => ({
      ...f,
      submitterName: f.submitterName || user.displayName || '',
      submitterContact: f.submitterContact || user.email || '',
    }))
  }, [user])

  useEffect(() => {
    if (!SITE_KEY || !turnstileRef.current) return
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
  }, [])

  function resetTurnstile() {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setResult({ ok: false, message: 'Please give the event a name.' })
      return
    }
    if (!coords) {
      setResult({ ok: false, message: 'Please pick a verified address so the event can be placed on the map.' })
      return
    }
    if (SITE_KEY && !turnstileToken) {
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
      if (turnstileToken) fd.set('turnstileToken', turnstileToken)
      if (editing) {
        if (editReason.trim()) fd.set('editReason', editReason.trim())
      } else {
        if (renewal) fd.set('previousListingId', renewal.previousListingId)
        // Always explicit, never left to a default the server would have to guess.
        fd.set('passingAlong', passingAlong ? 'true' : 'false')
      }

      const url = editing ? `/api/events/${edit.event.id}/edit` : '/api/events/submit'
      const res = await fetch(url, { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        resetTurnstile()
        if (editing) {
          // Leave the filled form as-is under the confirmation, and let the host
          // dialog react (it keeps the thank-you visible rather than resetting).
          onSubmitted?.()
        } else {
          setForm({ ...INITIAL, submitterName: form.submitterName, submitterContact: form.submitterContact })
          setCoords(null)
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

  // A successful submit replaces the whole form with a terminal confirmation, so
  // there is no re-enabled button and no re-solved Turnstile to fire the same
  // event or edit twice. The dialog-hosted edit flow leaves out "Submit another"
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
                setForm({ ...INITIAL, submitterName: form.submitterName, submitterContact: form.submitterContact })
                setCoords(null)
                setResult(null)
              }
        }
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {editing && (
        <Section title="What changed" hint="A short note on what you updated and why (optional). Your edit is reviewed before it goes live.">
          <textarea
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            rows={2}
            className="input resize-y"
            placeholder="e.g. registration is open now and the cost went up to $350"
          />
        </Section>
      )}
      <Section title="The event">
        <Field label="Event name" required>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Kettering Kickoff" className="input" required />
        </Field>
        <div className="flex gap-3">
          <div className="w-28">
            <Field label="Program">
              <select value={form.program} onChange={(e) => set('program', e.target.value as Program)} className="input uppercase">
                <option value="frc">FRC</option>
                <option value="ftc">FTC</option>
                <option value="fll">FLL</option>
              </select>
            </Field>
          </div>
          <div className="w-32">
            <Field label="Host team #">
              <input type="number" inputMode="numeric" min={1} value={form.hostTeamNumber} onChange={(e) => set('hostTeamNumber', e.target.value)} placeholder="e.g. 3538" className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Status">
              <select value={form.eventStatus} onChange={(e) => set('eventStatus', e.target.value)} className="input">
                {EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      <Section title="When">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Start date">
              <DateField value={form.startDate} onChange={(v) => set('startDate', v)} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="End date" hint="Leave blank for a one-day event.">
              <DateField value={form.endDate} onChange={(v) => set('endDate', v)} />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Days">
              <select value={form.days} onChange={(e) => set('days', e.target.value)} className="input">
                <option value="">-</option>
                <option value="1">1 day</option>
                <option value="2">2 days</option>
              </select>
            </Field>
          </div>
        </div>
        <Check
          checked={form.parallelDivisions}
          onChange={(v) => set('parallelDivisions', v)}
          label="Two separate 1-day events the same weekend"
        />
      </Section>

      <Section title="Where it is" hint="Type the address and pick a match to verify it - the city, region and country fill in and the pin is captured.">
        <Field label="Venue name" hint="e.g. Kettering University Recreation Center.">
          <input value={form.venueName} onChange={(e) => set('venueName', e.target.value)} className="input" />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Address">
              <AddressField
                defaultQuery={form.address}
                verified={coords != null}
                onText={(v) => set('address', v)}
                onPick={(p, c) => {
                  setForm((f) => ({
                    ...f,
                    ...(p.address ? { address: p.address } : {}),
                    ...(p.city ? { city: p.city } : {}),
                    ...(p.region ? { region: p.region } : {}),
                    ...(p.country ? { country: p.country } : {}),
                  }))
                  setCoords(c)
                }}
                onClear={() => setCoords(null)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Flint" className="input" />
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

      <Section title="Capacity and cost">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Team slots" hint="How many teams the event holds.">
              <input type="number" inputMode="numeric" min={1} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="32" className="input" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Cost (USD)">
              <input type="number" inputMode="numeric" min={0} value={form.costUsd} onChange={(e) => set('costUsd', e.target.value)} placeholder="300" className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Cost note" hint="e.g. $450 for both days.">
              <input value={form.costNote} onChange={(e) => set('costNote', e.target.value)} className="input" />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Registration and volunteers">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Registration">
              <select value={form.registrationStatus} onChange={(e) => set('registrationStatus', e.target.value)} className="input">
                {REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{REGISTRATION_STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
          {form.registrationStatus === 'not_open' && (
            <div className="flex-1">
              <Field label="Registration opens" hint="If a date is known.">
                <DateField value={form.registrationOpensAt} onChange={(v) => set('registrationOpensAt', v)} />
              </Field>
            </div>
          )}
          <div className="flex-1">
            <Field label="Volunteers">
              <select value={form.volunteerStatus} onChange={(e) => set('volunteerStatus', e.target.value)} className="input">
                {VOLUNTEER_STATUSES.map((s) => <option key={s} value={s}>{VOLUNTEER_STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Links">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Website">
              <input type="url" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Registration link" hint="If different from the website.">
              <input type="url" value={form.registrationUrl} onChange={(e) => set('registrationUrl', e.target.value)} className="input" />
            </Field>
          </div>
        </div>
        <Field label="Team list page" hint="Link to the event's own registered-teams list, if it has one.">
          <input type="url" value={form.teamListUrl} onChange={(e) => set('teamListUrl', e.target.value)} placeholder="https://…" className="input" />
        </Field>
        <Field label="Volunteer sign-up link" hint="Where volunteers apply, when that is a separate form.">
          <input type="url" value={form.volunteerUrl} onChange={(e) => set('volunteerUrl', e.target.value)} placeholder="https://…" className="input" />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Chief Delphi thread" hint="For events with no site of their own.">
              <input type="url" value={form.chiefDelphiUrl} onChange={(e) => set('chiefDelphiUrl', e.target.value)} placeholder="https://www.chiefdelphi.com/t/…" className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Organiser email">
              <input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} className="input" />
            </Field>
          </div>
        </div>
        <Field label="Notes" hint="Scholarships, eligibility limits, second-robot pricing, anything teams should know.">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="input resize-y" />
        </Field>
      </Section>

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
          <p className="text-xs text-muted-2">Signed in as {user.displayName || user.email}. This {editing ? 'edit' : 'submission'} will be credited to your account.</p>
        ) : (
          <p className="text-xs text-muted-2">No account needed. Signing in just lets you find your {editing ? 'edit' : 'submission'} later.</p>
        )}
      </Section>

      {/* Ownership only, so it belongs to a fresh listing. An edit is a
          correction to someone's event, not a claim on it. */}
      {!editing && <PassingAlongCheckbox checked={passingAlong} onChange={setPassingAlong} noun="event" />}

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <Button
        type="submit"
        disabled={submitting || !form.name.trim() || !coords || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start"
      >
        {submitting ? 'Submitting…' : editing ? 'Submit edit for review' : 'Submit event'}
      </Button>

      {result && <p className={result.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>{result.message}</p>}
    </form>
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

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border accent-[var(--color-primary)]" />
      {label}
    </label>
  )
}
