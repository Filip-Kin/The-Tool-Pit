'use client'

import { useEffect, useState } from 'react'

/**
 * The registered teams for one event, drawn as a scrollable table in the public
 * event dialog.
 *
 * The dialog is a client component handed a plain PublicEvent by the explorer,
 * so the roster is fetched on demand from /api/events/[id]/roster rather than
 * shipped inside every pin on the map. The route returns the LATEST APPROVED
 * snapshot's teams (nothing scraped shows before a moderator approves it) and
 * only for a published listing.
 *
 * WAITLIST FIRST. Some events publish a waitlist below their entry list, in the
 * order teams will be admitted. Those rows lead here, labelled and numbered, so
 * a team can see where it stands before the teams that are already in.
 *
 * The whole thing renders nothing until there is a roster to show: plenty of
 * off-season listings have no team list yet, and an empty table would be noise.
 */

/**
 * One team on a snapshot, mirrored from @the-tool-pit/db's RosterTeam. Redefined
 * locally on purpose: the db barrel opens a database connection, so a client
 * component must never import it. The API route is the type's real owner.
 */
interface RosterTeamRow {
  number: number
  name?: string
  robot?: string | null
  waitlisted?: boolean
  waitlistPosition?: number | null
}

type LoadState = 'loading' | 'ready' | 'error'

/** Avatars come from the shared team-avatar service. 404 is normal (many
 * off-season teams have none), so a team without one falls back to the service's
 * default avatar; only if THAT also fails do we show the number in a tile. */
const AVATAR_BASE = 'https://avatars.frc.tools/avatar'
const DEFAULT_AVATAR = `${AVATAR_BASE}/default.png`

function TeamAvatar({ number }: { number: number }) {
  const [src, setSrc] = useState(`${AVATAR_BASE}/${number}.png?s=64`)
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-[10px] font-semibold tabular-nums text-muted-2">
        {number}
      </div>
    )
  }
  return (
    // Plain img, not next/image: the service 404s freely and we want the
    // onError fallback, not a build-time domain allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => (src === DEFAULT_AVATAR ? setFailed(true) : setSrc(DEFAULT_AVATAR))}
      className="h-8 w-8 shrink-0 rounded-md bg-surface-3 object-contain"
    />
  )
}

/** A full-width label row inside the table body, marking a section. */
function SectionRow({ label, count }: { label: string; count: number }) {
  return (
    <tr>
      <td
        colSpan={3}
        className="border-t border-border-subtle bg-surface-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-2"
      >
        {label}
        <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-2">
          {count}
        </span>
      </td>
    </tr>
  )
}

function TeamRow({ team }: { team: RosterTeamRow }) {
  return (
    <tr className="border-t border-border-subtle">
      <td className="py-1.5 pl-3 pr-2">
        <TeamAvatar number={team.number} />
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 font-medium tabular-nums text-foreground">
        <span className="inline-flex items-center gap-1.5">
          {team.waitlisted && team.waitlistPosition != null && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-reg-waitlist/15 px-1 text-[10px] font-semibold text-reg-waitlist tabular-nums">
              {team.waitlistPosition}
            </span>
          )}
          {/* Number and robot letter read as one token, "4145B", with no space
              between them: the letter is a second robot from the same team, not
              a separate column. */}
          <span>
            {team.number}
            {team.robot && <span className="font-normal text-muted">{team.robot}</span>}
          </span>
        </span>
      </td>
      <td className="w-full break-words py-1.5 pr-3 text-muted">{team.name ?? '-'}</td>
    </tr>
  )
}

function byWaitlistOrder(a: RosterTeamRow, b: RosterTeamRow): number {
  // Given positions lead, in order; unpositioned waitlist entries sink below
  // them, then break ties on team number so the list is stable.
  const pa = a.waitlistPosition
  const pb = b.waitlistPosition
  if (pa != null && pb != null) return pa - pb
  if (pa != null) return -1
  if (pb != null) return 1
  return a.number - b.number
}

export function EventRosterTable({ eventId }: { eventId: string }) {
  const [teams, setTeams] = useState<RosterTeamRow[]>([])
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()
    setState('loading')
    setTeams([])
    fetch(`/api/events/${eventId}/roster`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { teams?: RosterTeamRow[] }) => {
        if (!active) return
        setTeams(Array.isArray(data.teams) ? data.teams : [])
        setState('ready')
      })
      .catch((err: unknown) => {
        if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
          setState('error')
        }
      })
    return () => {
      active = false
      ctrl.abort()
    }
  }, [eventId])

  // Stay quiet until there is something to show. A listing with no approved
  // roster, a fetch error, or the loading beat all render nothing rather than a
  // half-built table.
  if (state !== 'ready' || teams.length === 0) return null

  const waitlist = teams.filter((t) => t.waitlisted).sort(byWaitlistOrder)
  const registered = teams.filter((t) => !t.waitlisted)

  return (
    <section className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-semibold text-foreground">
        Registered teams
        <span className="ml-1.5 font-normal text-muted">{registered.length}</span>
      </h3>
      {/* The body scrolls on its own (capped height + overflow), with a sticky
          header, so a 30-plus team roster stays inside the dialog. The dialog
          itself is capped at 85vh and scrolls, so nothing runs off-screen on
          desktop or mobile even when both lists are long. */}
      <div className="max-h-[min(45vh,22rem)] overflow-y-auto rounded-lg border border-border-subtle">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-2">
            <tr>
              <th scope="col" className="w-8 py-2 pl-3 pr-2 font-medium">
                <span className="sr-only">Avatar</span>
              </th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">
                Team
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Name
              </th>
            </tr>
          </thead>
          <tbody>
            {waitlist.length > 0 && <SectionRow label="Waitlist" count={waitlist.length} />}
            {waitlist.map((t) => (
              <TeamRow key={`w-${t.number}-${t.robot ?? ''}`} team={t} />
            ))}
            {waitlist.length > 0 && registered.length > 0 && (
              <SectionRow label="Registered" count={registered.length} />
            )}
            {registered.map((t) => (
              <TeamRow key={`r-${t.number}-${t.robot ?? ''}`} team={t} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
