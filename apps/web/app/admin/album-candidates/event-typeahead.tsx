'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Search events by NAME for the admin album queue. Reuses the exact endpoint the
 * public submit form uses (`/api/albums/event-search`), so a moderator types
 * "Midland" instead of hunting for the raw key "2026mimid". Picking an option
 * resolves it to its full TBA key and hands it back through onKeyChange; typing a
 * raw key still works (the set action validates the format).
 */
interface EventOption {
  tbaKey: string
  eventCode: string
  year: number
  name: string
  program: string
  city: string | null
  stateProv: string | null
}

export function EventTypeahead({
  program,
  initialText,
  onKeyChange,
  disabled,
}: {
  program: 'frc' | 'ftc'
  /** What the box shows on first render (the machine's guess name, or ''). */
  initialText: string
  /** Fires with the chosen full TBA key, or the raw text when typed directly. */
  onKeyChange: (key: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(initialText)
  const [options, setOptions] = useState<EventOption[]>([])
  const [show, setShow] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  async function fetchOptions(q: string) {
    if (q.trim().length < 2) {
      setOptions([])
      return
    }
    try {
      const res = await fetch(`/api/albums/event-search?q=${encodeURIComponent(q.trim())}&program=${program}`)
      if (!res.ok) return
      const data = (await res.json()) as EventOption[]
      setOptions(data)
      setShow(data.length > 0)
    } catch {
      // ignore: the raw-key fallback still works
    }
  }

  function onInput(v: string) {
    setText(v)
    // A typed value is used as-is (a full key like 2026mimid); a pick overrides it.
    onKeyChange(v.trim())
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void fetchOptions(v), 250)
  }

  function pick(o: EventOption) {
    setText(o.name)
    onKeyChange(o.tbaKey)
    setShow(false)
  }

  const locOf = (o: EventOption) => [o.city, o.stateProv].filter(Boolean).join(', ')

  return (
    <div ref={boxRef} className="relative">
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => { if (options.length > 0) setShow(true) }}
        placeholder="Search event by name…"
        autoComplete="off"
        className="w-full min-w-[9rem] rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-40"
      />
      {show && options.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-72 max-w-[80vw] overflow-auto rounded-lg border border-border bg-surface shadow-lg">
          {options.map((o) => (
            <li key={o.tbaKey}>
              <button
                type="button"
                onClick={() => pick(o)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2"
              >
                <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                  {o.year}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{o.name}</span>
                  {locOf(o) && <span className="block truncate text-[10px] text-muted-2">{locOf(o)}</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-2">{o.eventCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
