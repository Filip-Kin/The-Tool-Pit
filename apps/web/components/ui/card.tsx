import { cn } from '@/lib/utils/cn'

/**
 * The card shell every vertical shares.
 *
 * Only the SHELL. What goes inside a card is genuinely different per vertical,
 * because a grant needs a deadline and an award range while a practice field
 * needs hours and a host team, so the innards stay where they are. What was
 * never meant to differ is the box around them, and it had drifted into four
 * paddings (p-3, p-4, p-5, p-6) and two different border tokens used
 * interchangeably, which is what made six verticals read as six sites.
 *
 * The defaults are the majority values from the codebase as it stood, not new
 * inventions: `border-border-subtle bg-surface p-4` was already 19 of the 32
 * card containers, so most call sites collapse to <Card> with no props.
 */

type Pad = 'sm' | 'md' | 'lg'

const PAD: Record<Pad, string> = {
  /** A dense row in a list, where the card is one of many on a phone. */
  sm: 'p-3',
  /** The default. Anything that is one item among several. */
  md: 'p-4',
  /** A single panel that owns its screen, like a detail dialog. */
  lg: 'p-5',
}

export function Card({
  pad = 'md',
  interactive = false,
  selected = false,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  pad?: Pad
  /** Adds the hover treatment. Use when the whole card is a click target. */
  interactive?: boolean
  selected?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface',
        PAD[pad],
        selected ? 'border-primary bg-surface-2' : 'border-border-subtle',
        interactive && !selected && 'transition-colors hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
