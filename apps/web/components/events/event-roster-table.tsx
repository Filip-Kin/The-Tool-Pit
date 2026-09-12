'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CalendarSearch, ExternalLink, Copy, Check } from 'lucide-react'

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

/**
 * One day's roster of a "2x 1-day" event (one event, two days, each day its
 * own tournament with its own team list). The API sends `days` only for those;
 * an ordinary event sends `teams` alone.
 */
interface DayRosterRow {
  day: number
  label: string
  teams: RosterTeamRow[]
}

/** Avatars come from the shared team-avatar service. 404 is normal (many
 * off-season teams have none), so a team without one falls back to the service's
 * default avatar; only if THAT also fails do we show the number in a tile. */
const AVATAR_BASE = 'https://avatars.frc.tools/avatar'
// Ask for the 64px default, not the 960x960 original: a roster full of no-avatar
// teams was loading dozens of near-megabyte PNGs, so they crawled in one by one.
const DEFAULT_AVATAR = `${AVATAR_BASE}/default.png?s=64`

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
      // max-w-none: the name column is w-full, so auto table layout squeezes
      // this cell toward zero and preflight's max-width:100% then shrinks the
      // image into it. Rendered 0 x 32 px, loaded but invisible, until this.
      className="h-8 w-8 max-w-none shrink-0 rounded-md bg-surface-3 object-contain"
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

/** Item classes match components/ui/card-menu.tsx, the reference menu. */
const MENU_ITEM =
  'flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground outline-none data-[highlighted]:bg-surface'

/**
 * The whole row is a menu: click anywhere on a team and two options open under
 * the pointer. "View other events" lands on the offseason list filtered to
 * this team with EVERY event showing, not only upcoming (the question is
 * "where else does 254 go", and last month counts); "TBA page" opens the team
 * on The Blue Alliance. No chevron, no button styling: it is a row that opens
 * a menu. A second robot ("4145B") shares the team's number, so its menu is
 * the team's menu.
 */
function TeamRow({ team }: { team: RosterTeamRow }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <tr
          className="cursor-pointer border-t border-border-subtle outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 data-[state=open]:bg-surface-2"
          tabIndex={0}
          aria-label={`Team ${team.number}${team.robot ?? ''} options`}
        >
          <td className="w-10 min-w-10 py-1.5 pl-3 pr-2">
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={2}
          // Above the event dialog (Dialog.Content is z-[2001]); at the default
          // z-50 the menu opened underneath the overlay and looked like nothing.
          className="z-[2100] min-w-48 rounded-md border border-border-subtle bg-background p-1 shadow-xl"
        >
          <DropdownMenu.Item asChild>
            <Link href={`/events?team=${team.number}&when=all`} className={MENU_ITEM}>
              <CalendarSearch className="h-4 w-4 text-muted" aria-hidden /> View other events
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a
              href={`https://www.thebluealliance.com/team/${team.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className={MENU_ITEM}
            >
              <ExternalLink className="h-4 w-4 text-muted" aria-hidden /> TBA page
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  const [copied, setCopied] = useState(false)
  const [days, setDays] = useState<DayRosterRow[]>([])
  const [activeDay, setActiveDay] = useState<number>(1)
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()
    setState('loading')
    setTeams([])
    setDays([])
    fetch(`/api/events/${eventId}/roster`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { teams?: RosterTeamRow[]; days?: DayRosterRow[] }) => {
        if (!active) return
        setTeams(Array.isArray(data.teams) ? data.teams : [])
        const d = Array.isArray(data.days) ? data.days.filter((x) => Array.isArray(x.teams)) : []
        setDays(d)
        // Open on the first day that has anyone in it.
        setActiveDay(d.find((x) => x.teams.length > 0)?.day ?? d[0]?.day ?? 1)
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

  // A 2x 1-day event shows one list per day behind tabs; the heading count is
  // then the DAY's count, and each tab carries its own day's size.
  const twoDay = days.length > 1
  const shown = twoDay ? (days.find((d) => d.day === activeDay)?.teams ?? []) : teams
  const waitlist = shown.filter((t) => t.waitlisted).sort(byWaitlistOrder)
  const registered = shown.filter((t) => !t.waitlisted)

  return (
    <section className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Registered teams
          <span className="ml-1.5 font-normal text-muted">{registered.length}</span>
        </h3>
        {registered.length > 0 && (
          <button
            type="button"
            // The numbers only, one per line, in the order shown, for pasting
            // into a scouting sheet or a spreadsheet. The day's list when the
            // event runs two.
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(registered.map((t) => t.number).join('\n'))
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                /* clipboard blocked; nothing to do */
              }
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
            aria-label="Copy team numbers"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-official" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {twoDay && (
        <div role="tablist" aria-label="Day" className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {days.map((d) => {
            const on = d.day === activeDay
            return (
              <button
                key={d.day}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveDay(d.day)}
                className={
                  'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ' +
                  (on ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-muted hover:text-foreground')
                }
              >
                {d.label}
                <span className={'ml-1.5 tabular-nums ' + (on ? 'text-muted' : 'text-muted-2')}>
                  {d.teams.filter((t) => !t.waitlisted).length}
                </span>
              </button>
            )
          })}
        </div>
      )}
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
