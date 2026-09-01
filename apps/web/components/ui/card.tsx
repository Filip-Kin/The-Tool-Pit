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

type Pad = 'none' | 'sm' | 'md' | 'lg'

const PAD: Record<Pad, string> = {
  /**
   * The padding lives inside, not on the shell. One case so far: an event card
   * puts its border on a wrapper because the Register link is a sibling of the
   * button, so the button carries the padding and the wrapper carries the box.
   */
  none: '',
  /** A dense row in a list, where the card is one of many on a phone. */
  sm: 'p-3',
  /** The default. Anything that is one item among several. */
  md: 'p-4',
  /** A single panel that owns its screen, like a detail dialog. */
  lg: 'p-5',
}

export interface CardShell {
  pad?: Pad
  /** Adds the hover treatment. Use when the whole card is a click target. */
  interactive?: boolean
  selected?: boolean
  className?: string
}

/**
 * The shell as a class string, for cards that are not a <div>.
 *
 * Half the cards on this site are some other element and cannot use <Card>: a
 * grant card IS the link, a field row IS the button that selects it, a tool
 * card is an <article> because it is one of a grid of them. Making Card
 * polymorphic to cover that would be a lot of generics for one line of output,
 * so those call sites take the classes and keep their own element. Either way
 * the shell is defined here once.
 */
export function cardClass({ pad = 'md', interactive = false, selected = false, className }: CardShell = {}) {
  return cn(
    'rounded-lg border bg-surface',
    PAD[pad],
    selected ? 'border-primary bg-surface-2' : 'border-border-subtle',
    interactive && !selected && 'transition-colors hover:bg-surface-2',
    className,
  )
}

export function Card({
  pad,
  interactive,
  selected,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & CardShell) {
  return (
    <div className={cardClass({ pad, interactive, selected, className })} {...rest}>
      {children}
    </div>
  )
}
