import { cn } from '@/lib/utils/cn'

/**
 * One meaning per colour, for every status word the admin shows.
 *
 * WHY THIS IS ONE FILE. Four screens rendered a status and each kept its own
 * colour map, so the same word came out three different ways: the overview and
 * the crawl list drew a finished job in two different greens, and the crawl
 * detail page drew `running` blue while the other two drew it amber. Nobody
 * chose that. It is what happens when a Record<string, string> gets copied.
 *
 * The colours are tokens, so both themes are covered by one name. They were
 * literal Tailwind palette classes picked against near-black, and every one of
 * them failed on white: the green they all used is 1.78:1 on a white card,
 * which is not a status, it is a blank space where a status was.
 *
 * FIVE TONES, AND WHAT SEPARATES THEM. A reviewer scans a column of these, so
 * they have to be told apart at a glance, not merely be legible. Measured as
 * Oklab distance, the closest pair of the five is 0.101 in light and 0.168 in
 * dark, against about 0.02 for one just-noticeable step. Every chip also
 * carries its own word, so colour is never the only thing saying what a row is.
 */

type Tone = 'good' | 'waiting' | 'bad' | 'linked' | 'inert'

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-rookie',
  waiting: 'text-official',
  bad: 'text-frc',
  linked: 'text-ftc',
  inert: 'text-muted',
}

/** The pill form. The tint is 10%, not 15%: the label sits ON it. */
const TONE_CHIP: Record<Tone, string> = {
  good: 'bg-rookie/10 text-rookie border-rookie/30',
  waiting: 'bg-official/10 text-official border-official/30',
  bad: 'bg-frc/10 text-frc border-frc/30',
  linked: 'bg-ftc/10 text-ftc border-ftc/30',
  inert: 'bg-surface-3 text-muted border-border',
}

/**
 * Every status word in the admin, across crawl jobs, candidates, submissions,
 * tools, grants and listings. They share a map because no word means two
 * different things: a job is `done` and a candidate is `published`, a job
 * `failed` and a candidate is `suppressed`.
 *
 * Anything unlisted falls through to `inert`, which is the right answer for a
 * word this file has not been told about: grey and readable beats a colour that
 * implies something.
 */
const TONES: Record<string, Tone> = {
  // Reached the end, and the end was the good one.
  done: 'good',
  published: 'good',
  approved: 'good',

  // On its way, or waiting for a person. Amber is "look at me", and a queue
  // nobody looks at is the failure mode these screens exist to prevent.
  running: 'waiting',
  pending: 'waiting',
  processing: 'waiting',
  needs_review: 'waiting',
  submitted: 'waiting',
  flagged: 'waiting',
  unverified: 'waiting',
  no_cover: 'waiting',

  // Stopped, and somebody has to know.
  failed: 'bad',
  suppressed: 'bad',
  rejected: 'bad',

  // Tied to a row that already exists. Not good, not bad, just no longer its
  // own thing.
  matched: 'linked',
  merged: 'linked',

  // Inert on purpose: nothing is waiting on these and nothing went wrong.
  queued: 'inert',
  duplicate: 'inert',
  draft: 'inert',
  archived: 'inert',
}

function toneOf(status: string): Tone {
  return TONES[status] ?? 'inert'
}

/**
 * The bare coloured word, for a table cell that already sits in a column headed
 * with what it is. A pill in every cell of a forty-row table is forty borders.
 */
export function StatusText({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('text-xs font-medium capitalize', TONE_TEXT[toneOf(status)], className)}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

/** The pill, for a page header or a single row that has no column to explain it. */
export function StatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
        TONE_CHIP[toneOf(status)],
        className,
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

/**
 * The fill of a classifier confidence bar.
 *
 * Here rather than beside either bar because there are two of them, on the
 * candidate list and the candidate detail, and they had already drifted: one
 * called the middle band yellow and the other amber. A bar has no label, so the
 * colour is the whole message and the two have to agree. Each fill clears 3:1
 * against the track it sits in, in both themes, which is what WCAG asks of a
 * graphic carrying meaning on its own.
 */
export function confidenceFill(value: number): string {
  if (value >= 0.7) return 'bg-rookie'
  if (value >= 0.4) return 'bg-official'
  return 'bg-frc'
}
