/**
 * TBA (The Blue Alliance) TRUSTED API client.
 *
 * Every other TBA connector in this repo is a read-only GET signed with the
 * single shared TBA_API_KEY. This is the opposite: a per-event WRITE, signed
 * with an auth_id/auth_secret pair TBA issues to whoever owns that event's
 * page (https://www.thebluealliance.com/request/apiwrite). Getting this wrong
 * writes a wrong team list onto someone else's public TBA event page, so it
 * is its own small module rather than another branch in tba-events.ts.
 *
 * Signing scheme (TBA trusted API v1): the request body is signed as
 * md5(auth_secret + request_path + body), sent as X-TBA-Auth-Sig alongside
 * X-TBA-Auth-Id. request_path is the path only (starts with /api/trusted/...),
 * no scheme/host, and must be byte-identical to what TBA computes server-side.
 */
import { createHash } from 'node:crypto'
import { politeFetch } from './base.js'

export interface TbaTrustedCredentials {
  authId: string
  authSecret: string
}

export interface TbaTrustedPushResult {
  ok: boolean
  httpStatus: number
  /** TBA's response body (its own {Error} or {Success} message), for the stored tbaPushError. */
  message: string
}

function signTrustedRequest(authSecret: string, requestPath: string, body: string): string {
  return createHash('md5').update(authSecret + requestPath + body).digest('hex')
}

/** The TBA key for a plain team: 254 -> frc254. */
const teamKey = (n: number) => `frc${n}`

/**
 * A roster entry as the push needs it: the number and, for a second robot
 * from the same org, its letter. Mirrors RosterTeam without importing the db
 * package into a connector.
 */
export interface PushTeam {
  number: number
  robot?: string | null
}

/**
 * The demo-team range FIRST reserves for offseason events. A second robot
 * ("8280B") is not a team FIRST knows, so FMS runs it under one of these
 * numbers and TBA renames it back with the event's remap_teams.
 */
const DEMO_MIN = 9970
const DEMO_MAX = 9999

/**
 * Filip's rule for which demo number a B team gets (2026-10-06): 99 + the
 * parent's last two digits when those are 70-99, so 8280B is 9980; otherwise
 * 999 + the parent's last digit, so 1701B is 9991 and 5144B is 9994.
 */
export function demoNumberFor(parent: number): number {
  const lastTwo = parent % 100
  return lastTwo >= 70 ? 9900 + lastTwo : 9990 + (parent % 10)
}

/**
 * Turn a roster into what TBA's trusted API will take: a list of team keys,
 * and the remap that turns each demo key back into its B-team key.
 *
 * WHY. TBA's team_list/update REJECTS "frc8280B" outright ("Invalid team keys
 * provided"), and a push that sends the parent's number twice collapses to one
 * entry, so the second robot silently fell off TBA (DCC 25 -> 24, C3 26 -> 23
 * on 2026-10-06). TBA's own mechanism is the demo number in the list plus
 * info/update { remap_teams: { frc9980: "frc8280B" } }, which is what FMS
 * does too, so the event's match data and our list agree.
 *
 * Collisions: the rule can give two B teams the same number (1701B and 5141B
 * both want 9991), and a roster can already hold a real demo team. The first
 * claimant keeps the rule's number; a later one walks up from it through
 * 9970-9999 (wrapping) to the first free number. Deterministic for a given
 * roster order, which is sorted by number, so a re-push does not reshuffle.
 * A roster with more B teams than free demo numbers is not a real roster;
 * the extras are dropped and named in `dropped` so the job can say so.
 */
export function tbaTeamKeys(teams: PushTeam[]): { keys: string[]; remap: Record<string, string>; dropped: string[] } {
  const sorted = [...teams].sort((a, b) => a.number - b.number || (a.robot ?? '').localeCompare(b.robot ?? ''))
  const taken = new Set<number>(sorted.filter((t) => !t.robot).map((t) => t.number))
  const keys: string[] = []
  const remap: Record<string, string> = {}
  const dropped: string[] = []
  for (const t of sorted) {
    if (!t.robot) {
      keys.push(teamKey(t.number))
      continue
    }
    const letter = t.robot.toUpperCase()
    let demo = demoNumberFor(t.number)
    let tries = 0
    while (taken.has(demo) && tries < DEMO_MAX - DEMO_MIN + 1) {
      demo = demo >= DEMO_MAX ? DEMO_MIN : demo + 1
      tries++
    }
    if (taken.has(demo)) {
      dropped.push(`${t.number}${letter}`)
      continue
    }
    taken.add(demo)
    keys.push(teamKey(demo))
    remap[teamKey(demo)] = `${teamKey(t.number)}${letter}`
  }
  return { keys, remap, dropped }
}

async function postTrusted(
  creds: TbaTrustedCredentials,
  requestPath: string,
  body: string,
): Promise<TbaTrustedPushResult> {
  const sig = signTrustedRequest(creds.authSecret, requestPath, body)
  const res = await politeFetch(`https://www.thebluealliance.com${requestPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TBA-Auth-Id': creds.authId,
      'X-TBA-Auth-Sig': sig,
    },
    body,
  })
  const message = await res.text()
  return { ok: res.ok, httpStatus: res.status, message }
}

/**
 * Push a roster to `/event/{tbaKey}/team_list/update` (every trusted-API
 * write endpoint has an /update suffix; confirmed against TBA's own
 * api_trusted_v1.json — the version-1 team_list endpoint at
 * https://www.thebluealliance.com/apidocs/trusted does not exist without it,
 * and 404s with a generic "Invalid endpoint" rather than an auth error).
 *
 * B teams go up as demo numbers, followed by a second call to
 * `/event/{tbaKey}/info/update` with the remap (see tbaTeamKeys). The remap
 * is only sent when there is one, so a plain roster is one request as before.
 * The result is the first failure, or the last success.
 */
export async function pushTeamList(
  tbaKey: string,
  creds: TbaTrustedCredentials,
  teams: PushTeam[],
): Promise<TbaTrustedPushResult & { dropped: string[] }> {
  const { keys, remap, dropped } = tbaTeamKeys(teams)
  const list = await postTrusted(creds, `/api/trusted/v1/event/${tbaKey}/team_list/update`, JSON.stringify(keys))
  if (!list.ok || Object.keys(remap).length === 0) return { ...list, dropped }
  const info = await postTrusted(creds, `/api/trusted/v1/event/${tbaKey}/info/update`, JSON.stringify({ remap_teams: remap }))
  return { ...info, dropped }
}
