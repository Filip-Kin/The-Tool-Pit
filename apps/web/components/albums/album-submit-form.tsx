'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'

// Cloudflare Turnstile API injected by their script (shared shape with the tools form).
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
const CURRENT_YEAR = new Date().getFullYear()
type Program = 'frc' | 'ftc'

interface EventOption {
  tbaKey: string
  eventCode: string
  year: number
  name: string
  program: string
  city: string | null
  stateProv: string | null
}

export function AlbumSubmitForm() {
  const [url, setUrl] = useState('')
  const [program, setProgram] = useState<Program>('frc')
  const [eventName, setEventName] = useState('')
  const [code, setCode] = useState('')
  const [year, setYear] = useState('')
  // Full TBA key when the user picked a real event; null once they hand-edit.
  const [tbaKey, setTbaKey] = useState<string | null>(null)
  const [photographer, setPhotographer] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; message: string } | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Render the Cloudflare Turnstile widget (spam protection) when configured.
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

  const [options, setOptions] = useState<EventOption[]>([])
  const [showOptions, setShowOptions] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchOptions = useCallback(async (q: string, prog: Program) => {
    if (q.trim().length < 2) {
      setOptions([])
      setShowOptions(false)
      return
    }
    try {
      const res = await fetch(`/api/albums/event-search?q=${encodeURIComponent(q.trim())}&program=${prog}`)
      if (!res.ok) return
      const data = (await res.json()) as EventOption[]
      setOptions(data)
      setShowOptions(data.length > 0)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowOptions(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function onEventNameChange(v: string) {
    setEventName(v)
    setTbaKey(null) // typing means it's no longer a confirmed pick
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void fetchOptions(v, program), 250)
  }

  function switchProgram(p: Program) {
    if (p === program) return
    setProgram(p)
    setTbaKey(null) // codes differ per program
    if (eventName.trim().length >= 2) void fetchOptions(eventName, p)
  }

  function pick(o: EventOption) {
    setEventName(o.name)
    setCode(o.eventCode)
    setYear(String(o.year))
    setTbaKey(o.tbaKey)
    setShowOptions(false)
  }

  function resetTurnstile() {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    if (SITE_KEY && !turnstileToken) {
      setResult({ ok: false, message: 'Please complete the “I’m not a robot” check.' })
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/albums/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          program,
          tbaKey: tbaKey ?? undefined,
          eventHint: eventName.trim() || undefined,
          code: code.trim() || undefined,
          year: year ? parseInt(year, 10) : undefined,
          photographer: photographer.trim(),
          note: note.trim(),
          turnstileToken: turnstileToken ?? undefined,
        }),
      })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        setUrl('')
        setEventName('')
        setCode('')
        setYear('')
        setTbaKey(null)
        setPhotographer('')
        setNote('')
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

  const locOf = (o: EventOption) => [o.city, o.stateProv].filter(Boolean).join(', ')

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Program">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(['frc', 'ftc'] as Program[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => switchProgram(p)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium uppercase transition-colors',
                program === p ? 'bg-primary text-white' : 'text-muted hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Album URL" required>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://photographer.smugmug.com/…"
          className="input"
        />
      </Field>

      <div ref={boxRef} className="relative">
        <Field label="Event" hint="Search by name and pick from the list to auto-fill the code and year.">
          <input
            value={eventName}
            onChange={(e) => onEventNameChange(e.target.value)}
            onFocus={() => { if (options.length > 0) setShowOptions(true) }}
            placeholder={program === 'ftc' ? 'Wisconsin Championship' : 'Midland'}
            className="input"
            autoComplete="off"
          />
        </Field>
        {showOptions && options.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
            {options.map((o) => (
              <li key={o.tbaKey}>
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                    {o.year}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{o.name}</span>
                    {locOf(o) && <span className="block truncate text-xs text-muted-2">{locOf(o)}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-2">{o.eventCode}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Field label="Event code" hint={tbaKey ? 'Auto-filled from your pick.' : 'Or enter a code directly.'}>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setTbaKey(null) }}
              placeholder={program === 'ftc' ? 'ftcwicmp' : 'mimid'}
              className="input font-mono"
            />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Year" required>
            <input
              type="number"
              inputMode="numeric"
              min={1992}
              max={CURRENT_YEAR}
              value={year}
              onChange={(e) => { setYear(e.target.value); setTbaKey(null) }}
              placeholder={String(CURRENT_YEAR)}
              className="input"
            />
          </Field>
        </div>
      </div>
      <Field label="Photographer" hint="Who took the photos (optional).">
        <input value={photographer} onChange={(e) => setPhotographer(e.target.value)} className="input" />
      </Field>
      <Field label="Note" hint="Anything else we should know (optional).">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-y" />
      </Field>

      {SITE_KEY && <div ref={turnstileRef} className="min-h-[65px]" />}

      <button
        type="submit"
        disabled={submitting || !url.trim() || (Boolean(SITE_KEY) && !turnstileToken)}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit album'}
      </button>

      {result && <p className={result.ok ? 'text-sm text-official' : 'text-sm text-frc'}>{result.message}</p>}
    </form>
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
