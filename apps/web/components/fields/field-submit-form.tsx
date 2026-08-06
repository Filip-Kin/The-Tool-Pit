'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { PinMap } from './pin-map'
import {
  COVERAGE_LABEL,
  PERIMETER_LABEL,
  ELEMENTS_LABEL,
  AVAILABILITY_LABEL,
} from '@/lib/fields/field-display'
// Value tuples come from the zero-dependency enum subpath (NOT the barrel),
// so the DB client / postgres never lands in the client bundle.
import { FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY } from '@the-tool-pit/db/field-enums'

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
  aprilTags: boolean
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
  aprilTags: false,
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

export function FieldSubmitForm() {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; message: string } | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
      setResult({ ok: false, message: 'Please give the field a name.' })
      return
    }
    if (!coords) {
      setResult({ ok: false, message: 'Please drop a pin on the map so the field can be placed.' })
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
      if (photo) fd.set('photo', photo)
      if (turnstileToken) fd.set('turnstileToken', turnstileToken)

      const res = await fetch('/api/fields/submit', { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        setForm(INITIAL)
        setCoords(null)
        setPhoto(null)
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
      <Section title="The field">
        <Field label="Field or facility name" required>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Royal Oak Robotics practice field" className="input" required />
        </Field>
        <div className="flex gap-3">
          <div className="w-32">
            <Field label="Team number">
              <input type="number" inputMode="numeric" min={1} value={form.teamNumber} onChange={(e) => set('teamNumber', e.target.value)} placeholder="1188" className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Team / organisation">
              <input value={form.teamName} onChange={(e) => set('teamName', e.target.value)} placeholder="Royal Oak Robotics" className="input" />
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

      <Section title="Where it is" hint="Drop a pin on the exact spot. Search an address to jump there first, then fine-tune by dragging.">
        <PinMap value={coords} onChange={setCoords} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Address">
              <input value={form.address} onChange={(e) => set('address', e.target.value)} className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className="input" />
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
            <Field label="Game elements">
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
          <Check checked={form.aprilTags} onChange={(v) => set('aprilTags', v)} label="AprilTags set up" />
          <label className="flex items-center gap-2 text-sm text-foreground">
            Ceiling height
            <input type="number" inputMode="decimal" min={1} step="0.5" value={form.ceilingHeightFt} onChange={(e) => set('ceilingHeightFt', e.target.value)} placeholder="ft" className="input w-24" />
            <span className="text-xs text-muted-2">ft</span>
          </label>
        </div>
      </Section>

      <Section title="Access">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Availability">
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
        <Field label="How to arrange access" hint="What a visiting team should do to book time.">
          <textarea value={form.contactInfo} onChange={(e) => set('contactInfo', e.target.value)} rows={2} className="input resize-y" />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Sign-up / contact link" hint="A Google Form, booking page, or email link.">
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
        <Field label="Photo of the field" hint="Optional. Reviewed before it goes live. Max 10 MB.">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="input" />
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
            <Field label="How to reach you" hint="In case we have a question.">
              <input value={form.submitterContact} onChange={(e) => set('submitterContact', e.target.value)} className="input" />
            </Field>
          </div>
        </div>
      </Section>

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <button
        type="submit"
        disabled={submitting || !form.name.trim() || !coords || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit field'}
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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={cn('h-4 w-4 rounded border-border accent-[var(--color-primary)]')} />
      {label}
    </label>
  )
}
