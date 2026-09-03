/**
 * Turn an owner's hand-typed team list into structured roster entries.
 *
 * WHY A PARSER AND NOT JUST A SPLIT. An owner types their roster into a
 * textarea, one team per line, and people type it every way at once: a bare
 * number, a number and the team's name, a second robot as "4145B", and the odd
 * blank line, comma or stray heading in between. This reads all of that into the
 * same { number, robot, name } shape the scrape path produces, so a manual list
 * shows on the public event page with the same avatars and B-team handling.
 *
 * THE TWO THINGS IT MUST NOT DO, both called out because getting either wrong
 * files a team under the wrong number:
 *
 *  - It must not read a NAME as a team number. A line with no leading number is
 *    a heading or a name on its own, and it is skipped, never guessed at.
 *  - It must not read a SLOT INDEX as a team number. A seeding/bracket list
 *    writes "6 - 4145": the number before the dash is the slot, the number
 *    after it is the team. Only the team is taken.
 *
 * Pure and dependency-free on purpose (the RosterTeam import is a type, erased
 * at build), so it is unit-testable on its own and safe to import from the save
 * action without dragging anything into the bundle.
 */
import type { RosterTeam } from './schema/event-listings'

/** 1..5 digits. No FRC/FTC number starts at 0 or runs past five digits. */
const MAX_TEAM_NUMBER = 99_999

/**
 * Parse the whole textarea into a deduplicated, sorted roster.
 *
 * Lines break on newlines; a comma breaks a line the same way, because a pasted
 * list often arrives comma-separated. A team name containing a comma loses only
 * the clause after it, which is a fair trade for reading "254, 1114, 2056".
 */
export function parseManualRoster(text: string | null | undefined): RosterTeam[] {
  if (!text) return []
  const out: RosterTeam[] = []
  const seen = new Set<string>()
  for (const segment of text.split(/[\r\n,]+/)) {
    const team = parseOneTeam(segment)
    if (!team) continue
    // A number typed twice with the same robot letter is one entry, not two.
    const key = `${team.number}:${team.robot ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(team)
  }
  return out.sort((a, b) => a.number - b.number || (a.robot ?? '').localeCompare(b.robot ?? ''))
}

/**
 * One segment into one team, or null when it holds no team.
 *
 * The order matters: the slot/bracket shape is checked BEFORE the ordinary
 * "number then name" read, because "6 - 4145" starts with a number that is not
 * a team and the ordinary read would take it.
 */
function parseOneTeam(segment: string): RosterTeam | null {
  const s = segment.trim()
  if (!s) return null

  // "slot - team", and "slot - team B": a dash BETWEEN TWO NUMBERS is the
  // seeding/bracket shape (CORI, MARC write "6 - 4145"). The number before the
  // dash is a slot index and must never be read as a team; take the one after.
  // A hyphen with a LETTER after it ("4145-B") is not this: that is a B team,
  // and it falls through to the ordinary read below.
  const slot = s.match(/^\d{1,5}\s*[-–—]\s*(\d{1,5})\s*([A-Za-z])?$/)
  if (slot) {
    const number = Number(slot[1])
    if (number >= 1 && number <= MAX_TEAM_NUMBER) {
      return { number, robot: slot[2] ? slot[2].toUpperCase() : null }
    }
  }

  // Ordinary line: a team number, then maybe a robot letter, then maybe a name.
  const m = s.match(/^(\d{1,5})(.*)$/)
  if (!m) return null
  const number = Number(m[1])
  if (!Number.isInteger(number) || number < 1 || number > MAX_TEAM_NUMBER) return null
  let rest = m[2]

  // A second robot from the same team is a single letter right after the number:
  // "4145B" is the canonical form, "4145 B" and "4145-B" are tolerated. It is a
  // robot letter ONLY when it stands alone, one letter with no other letter or
  // digit glued to it, so the "T" of "254 The Cheesy Poofs" is never read as a
  // robot code.
  let robot: string | null = null
  const robotMatch = rest.match(/^[\s-]*([A-Za-z])(?![A-Za-z0-9])/)
  if (robotMatch) {
    robot = robotMatch[1].toUpperCase()
    rest = rest.slice(robotMatch[0].length)
  }

  // Whatever is left is the name. A "name" with no letters in it is stray text
  // (a leftover slot number, a second number typed without a comma), never a
  // name, so it is dropped rather than kept as one.
  let name: string | undefined = rest.replace(/^[\s\-:.]+/, '').trim()
  if (!name || !/[A-Za-z]/.test(name)) name = undefined

  return { number, robot, ...(name ? { name } : {}) }
}
