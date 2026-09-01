'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
// Value tuples come from the zero-dependency enum subpaths (NOT the barrel),
// so the DB client / postgres never lands in the client bundle. FIELD_PROGRAMS
// is the shared three-program tuple, same slugs as the `programs` table.
import { FIELD_PROGRAMS, type FieldProgram } from '@the-tool-pit/db/field-enums'
import {
  ARTIFACT_KINDS,
  MIN_SEASON_YEAR,
  currentSeasonYear,
  maxSeasonYear,
  type ArtifactKind,
} from '@the-tool-pit/db/robot-code-enums'

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

const KIND_LABEL: Record<ArtifactKind, string> = {
  code: 'Robot code',
  cad: 'CAD',
}

interface FormState {
  url: string
  program: FieldProgram
  teamNumber: string
  seasonYear: string
  artifactKind: ArtifactKind
  note: string
}

function initialState(): FormState {
  return {
    url: '',
    program: 'frc',
    teamNumber: '',
    seasonYear: String(currentSeasonYear()),
    artifactKind: 'code',
    note: '',
  }
}

/**
 * Public robot code / CAD submission form. Same Turnstile handling and the same
 * no-account rule as the fields and grants forms.
 *
 * It asks four things a pipeline would otherwise have to guess: team number,
 * program, season and code-vs-CAD. The archive is indexed on exactly those, and
 * a wrong guess files one team's robot under another team's number, which is
 * worse than the entry being missing. The submitter knows all four without
 * looking anything up, so the form asks instead of inferring.
 */
export function RobotCodeSubmitForm() {
  const [form, setForm] = useState<FormState>(initialState)
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

  const teamNumber = Number(form.teamNumber)
  const seasonYear = Number(form.seasonYear)
  const maxYear = maxSeasonYear()
  const teamValid = Number.isInteger(teamNumber) && teamNumber >= 1 && teamNumber <= 99999
  const seasonValid = Number.isInteger(seasonYear) && seasonYear >= MIN_SEASON_YEAR && seasonYear <= maxYear
  const ready = form.url.trim() !== '' && teamValid && seasonValid

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.url.trim()) {
      setResult({ ok: false, message: 'Please add the link to the repo or model.' })
      return
    }
    if (!teamValid) {
      setResult({ ok: false, message: 'Please give a team number between 1 and 99999.' })
      return
    }
    if (!seasonValid) {
      setResult({ ok: false, message: `Please give a season between ${MIN_SEASON_YEAR} and ${maxYear}.` })
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

      const res = await fetch('/api/robot-code/submit', { method: 'POST', body: fd })
      const data = (await res.json()) as { message?: string; error?: string; status?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        // A duplicate is not a failure, but it is also not a new submission, so
        // leave what they typed on screen rather than clearing it. Anything
        // accepted clears back to a blank form, since the next thing a team
        // adds is usually the matching CAD or the season before.
        if (data.status === 'pending') setForm(initialState())
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
        title="What you're adding"
        hint="One repo or model per submission. If your team publishes code and CAD separately, send them one at a time."
      >
        <Field
          label="Link"
          required
          hint="GitHub, Onshape, GrabCAD or Fusion / A360. Link the repo or document itself, not a folder of screenshots."
        >
          <input
            type="url"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://github.com/frc5577/2026-robot"
            className="input"
            required
          />
        </Field>
        {/* A group of buttons, not a <select>, because there are only two
            answers and this is the one the reviewer cannot check by opening the
            link: a repo of Onshape exports looks like any other team repo. */}
        <div className="flex flex-col gap-1.5" role="group" aria-label="Is it code or CAD">
          <span className="text-sm font-medium text-foreground">
            Is it code or CAD<span className="text-frc"> *</span>
          </span>
          <div className="inline-flex self-start rounded-full border border-border bg-surface p-0.5">
            {ARTIFACT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set('artifactKind', k)}
                aria-pressed={form.artifactKind === k}
                className={cn(
                  'rounded-full px-4 py-1 text-xs font-medium transition-colors',
                  form.artifactKind === k ? 'bg-primary/15 text-primary' : 'text-muted hover:text-foreground',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-2">Both? Send the code link now and the CAD link after.</span>
        </div>
      </Section>

      <Section
        title="Whose it is"
        hint="The archive is listed by team and season, so these three decide where it shows up. We take them from you rather than reading them out of the repo name, which is how work ends up filed under the wrong team."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="w-full sm:w-32">
            <Field label="Team number" required>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={99999}
                value={form.teamNumber}
                onChange={(e) => set('teamNumber', e.target.value)}
                placeholder="5577"
                className="input"
                required
              />
            </Field>
          </div>
          <div className="w-full sm:w-28">
            <Field label="Program">
              <select
                value={form.program}
                onChange={(e) => set('program', e.target.value as FieldProgram)}
                className="input uppercase"
              >
                {FIELD_PROGRAMS.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-full sm:w-32">
            <Field label="Season" required hint="The year the game was played.">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_SEASON_YEAR}
                max={maxYear}
                value={form.seasonYear}
                onChange={(e) => set('seasonYear', e.target.value)}
                className="input"
                required
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Anything else" hint="Optional. Only the moderators read this.">
        <Field
          label="Note"
          hint="Useful if the repo needs explaining: which branch is the competition code, what a reviewer should ignore, whether it is a rewrite of an earlier season."
        >
          <textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={3} className="input resize-y" />
        </Field>
      </Section>

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <button
        type="submit"
        disabled={submitting || !ready || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit'}
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
