'use client'

import { useState } from 'react'

const CURRENT_YEAR = new Date().getFullYear()

export function AlbumSubmitForm() {
  const [url, setUrl] = useState('')
  const [eventHint, setEventHint] = useState('')
  const [year, setYear] = useState('')
  const [photographer, setPhotographer] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; message: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/albums/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          eventHint: eventHint.trim(),
          year: year ? parseInt(year, 10) : undefined,
          photographer: photographer.trim(),
          note: note.trim(),
        }),
      })
      const data = (await res.json()) as { message?: string; error?: string }
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? 'Submitted.' })
        setUrl('')
        setEventHint('')
        setYear('')
        setPhotographer('')
        setNote('')
      } else {
        setResult({ ok: false, message: data.error ?? 'Submission failed.' })
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
      <div className="flex gap-3">
        <div className="flex-1">
          <Field label="Event name or code" hint="Like “Midland” or mimid.">
            <input
              value={eventHint}
              onChange={(e) => setEventHint(e.target.value)}
              placeholder="Midland"
              className="input"
            />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Year" hint="Season year.">
            <input
              type="number"
              inputMode="numeric"
              min={1992}
              max={CURRENT_YEAR}
              value={year}
              onChange={(e) => setYear(e.target.value)}
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

      <button
        type="submit"
        disabled={submitting || !url.trim()}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit album'}
      </button>

      {result && (
        <p className={result.ok ? 'text-sm text-official' : 'text-sm text-frc'}>{result.message}</p>
      )}
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
