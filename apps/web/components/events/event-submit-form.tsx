'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
// The pin-drop map and its Nominatim geocode proxy are vertical-neutral, so we
// reuse the fields ones rather than duplicate ~200 lines and a second API route.
import { PinMap } from '@/components/fields/pin-map'
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
  chiefDelphiUrl: string
  contactEmail: string
  notes: string
  submitterName: string
  submitterContact: string
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
  chiefDelphiUrl: '',
  contactEmail: '',
  notes: '',
  submitterName: '',
  submitterContact: '',
}

/**
 * The off-season event submit form. Sign-in is optional throughout: the server
 * reads the session cookie if it is there, and a signed-out submission is a
 * first-class submission. Getting an event on the map must not need an account.
 *
 * There is no edit mode here - the claim-and-edit model for listings is a
 * separate session's (feat/listing-ownership).
 */
export function EventSubmitForm() {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(INITIAL)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
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
      setResult({ ok: false, message: 'Please drop a pin on the map so the event can be placed.' })
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

      const res = await fetch('/api/events/submit', { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        setForm({ ...INITIAL, submitterName: form.submitterName, submitterContact: form.submitterContact })
        setCoords(null)
        resetTurnstile()
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
              <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="End date" hint="Leave blank for a one-day event.">
              <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className="input" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Days">
              <select value={form.days} onChange={(e) => set('days', e.target.value)} className="input">
                <option value="">—</option>
                <option value="1">1 day</option>
                <option value="2">2 days</option>
              </select>
            </Field>
          </div>
        </div>
        <Check
          checked={form.parallelDivisions}
          onChange={(v) => set('parallelDivisions', v)}
          label="Two separate 1-day events the same weekend (each with its own field)"
        />
      </Section>

      <Section title="Where it is" hint="Search an address or drop a pin, then drag it to the exact venue. The address fields fill in from the pin - edit them if anything looks off.">
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
        <Field label="Venue name" hint="e.g. Kettering University Recreation Center.">
          <input value={form.venueName} onChange={(e) => set('venueName', e.target.value)} className="input" />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Address">
              <input value={form.address} onChange={(e) => set('address', e.target.value)} className="input" />
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
                <input type="date" value={form.registrationOpensAt} onChange={(e) => set('registrationOpensAt', e.target.value)} className="input" />
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
          <p className="text-xs text-muted-2">Signed in as {user.displayName || user.email}. This submission will be credited to your account.</p>
        ) : (
          <p className="text-xs text-muted-2">No account needed. Signing in just lets you find your submission later.</p>
        )}
      </Section>

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <button
        type="submit"
        disabled={submitting || !form.name.trim() || !coords || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit event'}
      </button>

      {result && <p className={result.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>{result.message}</p>}
    </form>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4">
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
