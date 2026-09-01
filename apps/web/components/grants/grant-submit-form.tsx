'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cardClass } from '@/components/ui/card'
import { PassingAlongCheckbox } from '@/components/submit/passing-along-checkbox'
import { PASSING_ALONG_DEFAULT } from '@/lib/listings/passing-along'
import { useSession, type SessionUser } from '@/components/auth/session-provider'

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

interface FormState {
  name: string
  infoUrl: string
  funderName: string
  applicationUrl: string
  summary: string
  notes: string
  submitterName: string
  submitterContact: string
}

const INITIAL: FormState = {
  name: '',
  infoUrl: '',
  funderName: '',
  applicationUrl: '',
  summary: '',
  notes: '',
  submitterName: '',
  submitterContact: '',
}

function submitterDefaults(user: SessionUser | null): Pick<FormState, 'submitterName' | 'submitterContact'> {
  return {
    submitterName: user?.displayName ?? '',
    submitterContact: user?.email ?? '',
  }
}

/**
 * Public grant submission form. Same shape and the same Turnstile handling as
 * the fields submit form, and sign-in is optional here too: the server reads
 * the session if there is one and a signed-out submission is a first-class
 * submission.
 *
 * The form asks for very little. What we need is the funder's own page, and
 * everything else only shortens the reviewer's job. Asking a mentor to fill in
 * an award range they are unsure of would put a guess in front of a reviewer
 * dressed up as a fact.
 */
export function GrantSubmitForm() {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  // Unticked, like every other submit form. See lib/listings/passing-along.ts.
  const [passingAlong, setPassingAlong] = useState(PASSING_ALONG_DEFAULT.grant)
  const [result, setResult] = useState<{ ok?: boolean; message: string; slug?: string } | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // The session resolves after first paint, so fill the "You" fields when it
  // lands, and only where they are still blank: someone submitting on behalf of
  // a team mate has already typed the right name.
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
      setResult({ ok: false, message: 'Please give the grant a name.' })
      return
    }
    if (!form.infoUrl.trim()) {
      setResult({ ok: false, message: 'Please add the link to the funder page.' })
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
      for (const [k, v] of Object.entries(form)) if (v) fd.set(k, v)
      if (turnstileToken) fd.set('turnstileToken', turnstileToken)
      // Always explicit, never left to a default the server would have to guess.
      fd.set('passingAlong', passingAlong ? 'true' : 'false')

      const res = await fetch('/api/grants/submit', { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string; status?: string; slug?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.', slug: data.slug })
        // A duplicate is not a failure, but it is also not a new submission, so
        // leave what they typed on screen rather than clearing it.
        if (data.status === 'pending') {
          setForm({ ...INITIAL, ...submitterDefaults(user) })
        }
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
      <Section
        title="The grant"
        hint="The funder's own page is the one thing we cannot do without. Everything else just saves the reviewer time."
      >
        <Field label="Link to the funder page" required hint="The page describing the grant, not a news story about it.">
          <input
            type="url"
            value={form.infoUrl}
            onChange={(e) => set('infoUrl', e.target.value)}
            placeholder="https://example.org/grants/stem"
            className="input"
            required
          />
        </Field>
        <Field label="Grant or programme name" required>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Community STEM Grant"
            className="input"
            required
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Who funds it" hint="The foundation, company or agency handing out the money.">
              <input
                value={form.funderName}
                onChange={(e) => set('funderName', e.target.value)}
                placeholder="Example Family Foundation"
                className="input"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Application link" hint="Only if applying happens somewhere other than the page above.">
              <input
                type="url"
                value={form.applicationUrl}
                onChange={(e) => set('applicationUrl', e.target.value)}
                placeholder="https://forms.gle/…"
                className="input"
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="What you know">
        <Field label="What it funds" hint="One or two sentences in your own words.">
          <textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={2} className="input resize-y" />
        </Field>
        <Field
          label="Anything else"
          hint="Deadlines, amounts, who is eligible, whether your team has applied before. Say what you actually know and leave out what you do not, we will check it all against the funder's page anyway."
        >
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={4} className="input resize-y" />
        </Field>
      </Section>

      <Section title="You" hint="Private. Only the moderators see this, and it is never shown publicly.">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Your name">
              <input value={form.submitterName} onChange={(e) => set('submitterName', e.target.value)} className="input" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="How to reach you" hint="Only used if we have a question about this grant.">
              <input
                value={form.submitterContact}
                onChange={(e) => set('submitterContact', e.target.value)}
                className="input"
              />
            </Field>
          </div>
        </div>
        {user && (
          <p className="text-xs text-muted-2">
            Signed in as {user.displayName || user.email}, so we have filled these in for you.
          </p>
        )}
      </Section>

      <PassingAlongCheckbox checked={passingAlong} onChange={setPassingAlong} noun="grant" />

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <Button
        type="submit"
        disabled={submitting || !form.name.trim() || !form.infoUrl.trim() || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start"
      >
        {submitting ? 'Submitting…' : 'Submit grant'}
      </Button>

      {result && (
        <p className={result.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>
          {result.message}
          {result.slug && (
            <>
              {' '}
              <a href={`/grants/${result.slug}`} className="underline underline-offset-2">
                Open the listing
              </a>
              .
            </>
          )}
        </p>
      )}
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

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
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
