'use client'

import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * ONE date picker for the whole app.
 *
 * Native <input type="date"> renders in the browser or OS locale, so the same
 * form read "03/09/2026" as the 3rd in Auckland and the 9th in Detroit, and
 * teams fixed it with ad-hoc lang="en-US" hacks that only papered over the
 * typing, not the reading. This replaces every one of them:
 *
 *   - The VALUE always round-trips as ISO yyyy-mm-dd. That is what the server
 *     stores and what every caller passes in, regardless of who is looking.
 *   - The DISPLAYED text follows the viewer's own locale through Intl, so a New
 *     Zealander sees "3 Sept 2026" and an American sees "Sep 3, 2026" off the
 *     same stored value, and neither can misread the other's.
 *
 * Two entry points, one component:
 *
 *   - Controlled: pass `value` (ISO or '') and `onChange`. The React-state forms
 *     (event submit, published-event editor, owner listing editor) use this.
 *   - Uncontrolled form-POST: pass `name` and optionally `defaultValue`. A hidden
 *     input carries the ISO string under `name`, so an ordinary FormData submit
 *     picks it up exactly as the old native input did. The candidate accept form
 *     uses this.
 *
 * `name` is honoured in either mode, so a controlled form may still post the ISO
 * value through FormData if it wants to.
 */

interface DateFieldProps {
  /** Controlled ISO value (yyyy-mm-dd) or '' for empty. Omit for uncontrolled. */
  value?: string
  /** Uncontrolled seed. Ignored once `value` is provided. */
  defaultValue?: string
  /** Fired with the new ISO value (or '' when cleared). */
  onChange?: (iso: string) => void
  /** FormData key. When set, a hidden input carries the ISO value for a form POST. */
  name?: string
  id?: string
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Parse yyyy-mm-dd as a LOCAL calendar date, so no timezone shifts the day. */
function isoToDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Back to yyyy-mm-dd from the LOCAL components, never the UTC ones. */
function dateToIso(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** The viewer's locale, unambiguous: named month so 03/09 vs 09/03 cannot happen. */
function formatDisplay(iso: string): string {
  const d = isoToDate(iso)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  } catch {
    return iso
  }
}

// The calendar, themed to the app's dark surface by feeding react-day-picker its
// own CSS variables from our tokens rather than editing its stylesheet.
const RDP_VARS = {
  '--rdp-accent-color': 'var(--color-primary)',
  '--rdp-accent-background-color': 'var(--color-primary-subtle)',
  '--rdp-today-color': 'var(--color-primary)',
  '--rdp-day_button-width': '2.25rem',
  '--rdp-day_button-height': '2.25rem',
} as React.CSSProperties

export function DateField({
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled,
  placeholder = 'Select a date',
  className,
}: DateFieldProps) {
  const isControlled = value !== undefined
  const [internal, setInternal] = useState(defaultValue ?? '')
  const iso = isControlled ? (value ?? '') : internal
  const selected = isoToDate(iso)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape, the way a popover should.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function commit(next: string) {
    if (!isControlled) setInternal(next)
    onChange?.(next)
  }

  function handleSelect(date: Date | undefined) {
    commit(date ? dateToIso(date) : '')
    setOpen(false)
  }

  const label = iso ? formatDisplay(iso) : placeholder

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="input flex items-center justify-between gap-2 text-left disabled:opacity-40"
      >
        {/* The value is locale-formatted on the client, so the server render can
            differ from the browser's; the text reconciles without a warning. */}
        <span suppressHydrationWarning className={iso ? 'text-foreground' : 'text-muted-2'}>
          {label}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-2" aria-hidden />
      </button>

      {name && <input type="hidden" name={name} value={iso} readOnly />}

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-50 mt-1 rounded-md border border-border-strong bg-surface-2 p-2 text-foreground shadow-lg"
          style={RDP_VARS}
        >
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={handleSelect}
            showOutsideDays
          />
          {iso && (
            <button
              type="button"
              onClick={() => handleSelect(undefined)}
              className="mt-1 w-full rounded-sm px-2 py-1 text-center text-xs text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
