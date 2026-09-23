/**
 * Deterministic album-title -> event-name scoring for album-enrich step 3b.
 *
 * Pure, no I/O, so the decision rule is unit-tested on real titles.
 *
 * Why not pg_trgm: word_similarity(title, name) scores the whole long title
 * against the best extent of the short name, so "2023 FRC Muskego TWIST Greg
 * Blau" scored 0.13 against "TWIST". Flipped, it scores 1.0 for any title that
 * contains the name's trigrams anywhere, including inside another word, and it
 * cannot tell two same-year events with near-identical names apart. Here we
 * strip the shared boilerplate ("FIM District", "Event", "presented by ...",
 * years) from the event name, keep its distinctive words, and score how much of
 * that is present as whole words in the title. Auto-match needs a clear winner.
 */

/** Words that name the kind of event, the program or the district, not which one. */
const BOILERPLATE = new Set([
  // programs, orgs, district prefixes
  'first', 'frc', 'ftc', 'fll', 'fim', 'fit', 'win', 'ne', 'pnw', 'chs', 'fma', 'pch', 'fin', 'fnc', 'ont', 'isr',
  // event-kind words
  'district', 'districts', 'event', 'events', 'regional', 'regionals', 'competition', 'championship', 'championships',
  'division', 'qualifier', 'qualifying', 'tournament', 'offseason', 'off', 'season', 'invitational', 'league',
  'robotics', 'robot', 'robots', 'tech', 'challenge', 'photos', 'pics', 'gallery', 'album',
  // glue
  'the', 'of', 'at', 'and', 'a', 'an', 'in', 'for', 'on', 'by', 'presented', 'sponsored',
])

function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !/^(?:19|20)\d{2}$/.test(t))
}

/**
 * Distinctive tokens of an event name: drop the "presented by ..." sponsor tail
 * and a trailing "@venue", then boilerplate and years. Falls back to all
 * non-year tokens if nothing distinctive is left (an event literally named
 * "Championship" still needs something to match on).
 */
export function eventNameTokens(name: string): string[] {
  const core = name.replace(/\b(?:presented|sponsored)\s+by\b.*$/i, '').replace(/@.*$/, '')
  const all = rawTokens(core)
  const kept = all.filter((t) => !BOILERPLATE.has(t))
  return kept.length > 0 ? kept : all
}

/**
 * Tokens of an album title. An Open Graph title carries the site after its last
 * " - " / " | " ("... Greg Blau - FIRST Wisconsin"); drop that tail when it is a
 * FIRST org name so "Wisconsin" there cannot vote for "Wisconsin Regional".
 */
export function titleTokens(title: string): Set<string> {
  const core = title.replace(/\s[-|–]\s*FIRST\b[^-|–]*$/i, '')
  const toks = rawTokens(core)
  const set = new Set(toks)
  // "La Crosse" vs "LaCrosse": also index each adjacent pair joined.
  for (let i = 0; i + 1 < toks.length; i++) set.add(toks[i] + toks[i + 1])
  return set
}

/**
 * Share of the event's distinctive name present in the title as whole words,
 * weighted by token length (so "nw" counts less than "michigan"). 0..1.
 */
export function scoreEventName(title: Set<string>, eventName: string): number {
  const toks = eventNameTokens(eventName)
  if (toks.length === 0) return 0
  let total = 0
  let hit = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    total += t.length
    if (title.has(t)) {
      hit += t.length
      continue
    }
    // A title word may also be two event words joined ("LaCrosse" vs "La Crosse").
    const next = toks[i + 1]
    if (next && title.has(t + next)) {
      hit += t.length + next.length
      total += next.length
      i++
    }
  }
  return hit / total
}

/** Minimum score for an automatic name match. */
export const NAME_MATCH_THRESHOLD = 0.6
/** The winner must beat the runner-up by this much, or it is a tie for AI/admin. */
export const NAME_MATCH_MARGIN = 0.15
/** Below this there is no plausible candidate: no auto-match and no AI call. */
export const AI_MIN_PLAUSIBLE = 0.4

export interface ScoredEvent<E> {
  event: E
  score: number
}

export interface NameMatchDecision<E> {
  /** Events ranked best first (ties keep input order). */
  ranked: ScoredEvent<E>[]
  /** The auto-match, or null when the best is weak or not clearly ahead. */
  match: ScoredEvent<E> | null
  /** True when the best is plausible but not an auto-match: worth an AI call. */
  maybe: boolean
}

/**
 * Rank every candidate event of the album's year+program by name score and
 * decide. Auto-match only when the best scores >= NAME_MATCH_THRESHOLD AND
 * leads the runner-up by >= NAME_MATCH_MARGIN; anything else scoring >=
 * AI_MIN_PLAUSIBLE is the "maybe" band for the AI shortlist.
 */
export function decideNameMatch<E extends { name: string }>(title: string, candidates: E[]): NameMatchDecision<E> {
  const t = titleTokens(title)
  const ranked = candidates
    .map((event) => ({ event, score: scoreEventName(t, event.name) }))
    .sort((a, b) => b.score - a.score)
  const top = ranked[0]
  const second = ranked[1]?.score ?? 0
  const clear = !!top && top.score >= NAME_MATCH_THRESHOLD && top.score - second >= NAME_MATCH_MARGIN
  return {
    ranked,
    match: clear ? top : null,
    maybe: !clear && !!top && top.score >= AI_MIN_PLAUSIBLE,
  }
}

/**
 * An FLL album named as such ("FLL", "FIRST LEGO League") whose title does not
 * also name FTC/FRC. "FLL-FTC2026 - Prix" is a combined event that IS an FTC
 * event, so a mention of either other program keeps it in play.
 */
export function isFllOnlyTitle(title: string): boolean {
  if (!/\bfll\b|lego\s+league/i.test(title)) return false
  return !/\bftc|\bfrc|tech\s+challenge|robotics\s+competition/i.test(title)
}
