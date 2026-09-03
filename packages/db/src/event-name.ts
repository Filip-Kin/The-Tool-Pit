/**
 * The event's own name, out of a thread title.
 *
 * Threads title themselves for the forum, not for a directory: "2026 SoCal
 * Showdown Offseason Competition", "NYC Robo Replay 2026 - two day offseason
 * 10/10-11", "CORI 2026 Registration Is Now Open! - Central Ohio Offseason
 * Event". The name of the event is a few words inside each of those.
 *
 * The reader is asked for the clean name, and this runs anyway, for two
 * reasons. A candidate read before that instruction existed still has the long
 * title, and re-reading fifty events to fix punctuation is not a good use of
 * anybody's model budget. And a moderator typing a name into the review form
 * should get the same treatment as the reader.
 *
 * DELIBERATELY CONSERVATIVE. It strips the year and a short list of generic
 * tails that carry no information, and it stops. It does not try to shorten a
 * name it does not recognise, because "Clash in The Corn" and "Where Is Wolcott
 * Invitational" are the real names and a cleverer rule would eat them.
 */

/** Words that describe the KIND of event rather than naming this one. */
const GENERIC = [
  'offseason competition',
  'off-season competition',
  'offseason event',
  'off-season event',
  'offseason tournament',
  'off-season tournament',
  'offseason',
  'off-season',
  'competition',
  'tournament',
  'event',
]

export function cleanEventName(raw: string): string {
  let name = raw.trim()

  // Everything after a dash is the thread's own description: a date range, a
  // tagline, a call to action. "NYC Robo Replay 2026 - two day offseason
  // 10/10-11" is one event with a sentence attached.
  //
  // Only when what precedes it is long enough to be a name on its own, so
  // "Bordie Blast 2026 - Bordie Through Time" keeps "Bordie Blast" but a title
  // that opens with a dash is left alone.
  const dash = name.search(/\s[-–\u2014:|]\s/)
  if (dash > 6) name = name.slice(0, dash)

  // A call to action, wherever it sits.
  name = name.replace(/\b(registration|applications?|sign-?ups?)\s+(is|are)\s+(now\s+)?open!?/gi, ' ')

  // The year. Tracked in its own column, so it is noise in the name, and it
  // appears at either end: "2026 SoCal Showdown" and "Beach Blitz 2026".
  name = name.replace(/\b20\d\d\b/g, ' ')

  // A generic tail, once. "SoCal Showdown Offseason Competition" is "SoCal
  // Showdown"; "Clash in The Corn" has no tail and is untouched.
  const lower = () => name.toLowerCase().trim()
  for (const phrase of GENERIC) {
    const at = lower().lastIndexOf(phrase)
    if (at > 0 && at + phrase.length === lower().length) {
      name = name.trim().slice(0, at)
      break
    }
  }

  // A leading article the thread added: "The 2026 Red Stick Rumble".
  name = name.replace(/^\s*the\s+/i, '')

  return name.replace(/\s+/g, ' ').replace(/^[\s\-–\u2014:|,]+|[\s\-–\u2014:|,]+$/g, '').trim() || raw.trim()
}
