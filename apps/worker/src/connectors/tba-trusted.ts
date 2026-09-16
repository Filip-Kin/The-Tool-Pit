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

const TBA_TRUSTED_BASE = 'https://www.thebluealliance.com/api/trusted/v1'

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

/**
 * Push a team list to `/event/{tbaKey}/team_list`. `teamNumbers` are plain FRC
 * team numbers (e.g. 254); TBA wants them as `frc254` team keys.
 */
export async function pushTeamList(
  tbaKey: string,
  creds: TbaTrustedCredentials,
  teamNumbers: number[],
): Promise<TbaTrustedPushResult> {
  const requestPath = `/api/trusted/v1/event/${tbaKey}/team_list`
  const body = JSON.stringify(teamNumbers.map((n) => `frc${n}`))
  const sig = signTrustedRequest(creds.authSecret, requestPath, body)

  const res = await politeFetch(`${TBA_TRUSTED_BASE}/event/${tbaKey}/team_list`, {
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
