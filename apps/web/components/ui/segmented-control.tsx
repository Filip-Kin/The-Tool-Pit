'use client'

import { cn } from '@/lib/utils/cn'

/** One choice in the group. `count` is the small tally the explorers show beside a label. */
export interface SegmentedOption<T extends string> {
  value: T
  label: string
  count?: number
}

/**
 * The one select-button group used across the site.
 *
 * Lifted out of the events explorer, which was the version that looked right,
 * because five hand-rolled copies had drifted into three different corner radii
 * and two different active colours. Sharing it means a change to the look lands
 * on every vertical at once instead of on whichever one someone remembers.
 *
 * The 'md' height is deliberately 2.375rem, the same as the `.input` class, so
 * a control row of a group, a text field and a select lines up with no
 * hand-tuning.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** 'md' matches a form row. 'sm' is for a secondary filter sitting under one. */
  size?: 'sm' | 'md'
  /** Names the group for a screen reader: the buttons alone never say what they switch. */
  label?: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full self-start overflow-x-auto rounded-lg border border-border bg-surface p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'whitespace-nowrap rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? 'bg-primary text-white' : 'text-muted hover:text-foreground',
            )}
          >
            {option.label}
            {option.count ? (
              <span className={cn('ml-1.5 text-xs', active ? 'text-white/70' : 'text-muted-2')}>
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
