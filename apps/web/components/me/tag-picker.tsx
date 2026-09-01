'use client'

import { useRef } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { TagOption } from '@/lib/listings/tool-taxonomy'

/**
 * Pick the tags a listing carries, from a fixed list.
 *
 * WHY CHIPS AND NOT A COMBOBOX. Three programs, five roles and fourteen
 * functions is a list somebody can read. A combobox would hide all of them
 * behind a keystroke and leave the owner guessing what the vocabulary is, which
 * is the whole difficulty with tagging your own thing: not typing the word, but
 * knowing which words there are. So every choice is on screen and the selected
 * ones are filled in.
 *
 * ONE CONTROL, NOT TWO. The obvious build is a row of removable chips plus a
 * list of choices underneath, and that puts "remove FRC" in two places on one
 * screen. Instead a selected chip IS the removable chip: it carries a tick, it
 * turns into a cross under the cursor, and clicking it takes the tag off.
 *
 * KEYBOARD. Roving tabindex, the listbox convention: the group is one tab stop
 * and the arrow keys move inside it, so a form with three of these is three
 * stops rather than twenty-two. Space and Enter toggle, because these are
 * ordinary buttons and that is what a button does.
 *
 * The selected values are posted as one FormData key repeated, which is the
 * convention the admin tool editor and the grant editor already use, so the
 * parser reads them with getAll and nothing new had to be invented on the wire.
 */
export function TagPicker({
  name,
  label,
  options,
  values,
  onChange,
}: {
  /** The FormData key. Repeated once per selected value. */
  name: string
  /** Names the group for a screen reader. The chips alone never say what they tag. */
  label: string
  options: readonly TagOption[]
  values: readonly string[]
  onChange: (values: string[]) => void
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const selected = new Set(values)

  function toggle(value: string) {
    // Kept in the options' own order rather than click order, so the same set
    // of tags always serialises the same way and an autosave that changed
    // nothing does not look like a change.
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value))
  }

  /** Arrow keys walk the chips. Home and End jump to the ends. */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const chips = Array.from(groupRef.current?.querySelectorAll<HTMLButtonElement>('[data-chip]') ?? [])
    if (chips.length === 0) return
    const here = chips.findIndex((c) => c === document.activeElement)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? chips.length - 1
          : here < 0
            ? 0
            : (here + step + chips.length) % chips.length
    e.preventDefault()
    chips[next]?.focus()
  }

  // The roving tab stop. The first selected chip when there is one, so tabbing
  // back into the group lands on what is already set rather than on the start
  // of the list.
  const focusIndex = Math.max(
    0,
    options.findIndex((o) => selected.has(o.value)),
  )

  return (
    <>
      {/* The values, as the form reads them. Hidden inputs rather than checked
          checkboxes: a controlled checkbox with no onChange is a React warning,
          and the chips are the real control. */}
      {options
        .filter((o) => selected.has(o.value))
        .map((o) => (
          <input key={o.value} type="hidden" name={name} value={o.value} />
        ))}

      <div
        ref={groupRef}
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {options.map((option, i) => {
          const on = selected.has(option.value)
          return (
            <button
              key={option.value}
              data-chip
              type="button"
              aria-pressed={on}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => toggle(option.value)}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                on
                  ? 'border-primary bg-primary/15 text-primary hover:bg-primary/25'
                  : 'border-border bg-surface text-muted hover:border-border/80 hover:text-foreground',
              )}
            >
              {on && (
                <>
                  {/* The tick is the state; the cross is what clicking does.
                      Swapped on hover and on focus so the chip says which one
                      it is about to be, and never both at once. */}
                  <Check className="h-3.5 w-3.5 group-hover:hidden group-focus-visible:hidden" aria-hidden />
                  <X className="hidden h-3.5 w-3.5 group-hover:block group-focus-visible:block" aria-hidden />
                </>
              )}
              {option.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
