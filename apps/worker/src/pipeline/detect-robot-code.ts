/**
 * Is a GitHub repo a specific team's season robot code? Decide from the repo's
 * SHAPE, not its blurb.
 *
 * A moderator was approving robot-code candidates by hand that the model left
 * under the bar, when the repo itself says plainly what it is: an FRC project
 * has `src/main/java/.../frc/robot/`, a `.wpilib` folder and `vendordeps`; an
 * FTC project has `org/firstinspires/ftc/teamcode`. Paired with a team number
 * read out of the owner or repo name, that is enough to classify and publish it
 * the same deterministic way the github_team_code connector already does.
 *
 * DELIBERATELY REQUIRES BOTH a project fingerprint AND a team number. A reusable
 * WPILib LIBRARY (YAGSL, PhotonVision, a vendordep) also carries build files and
 * an example Robot class, but it is a tool, not a team's robot. The team number
 * in the owner/repo is what separates "team 1678's 2024 robot" from a library,
 * so a fingerprint with no team number falls through to the model rather than
 * being published as somebody's robot.
 *
 * Pure and dependency-free: unit-testable, and the tree it reads is fetched by
 * the caller.
 */

export interface RobotCodeDetection {
  program: 'frc' | 'ftc'
  teamNumber: number
  seasonYear: number | null
}

const MAX_TEAM = 99_999

/** A team number from the owner or repo name, or null. Owner wins: an org is far more likely to be named for its team than a repo is, and a repo name is where a bare season year hides. */
function parseTeamNumber(owner: string, repo: string): number | null {
  const prefixed = (s: string): number | null => {
    const m = s.match(/(?:frc|ftc|team)[\s_-]?(\d{1,5})/i)
    const n = m ? Number(m[1]) : NaN
    return Number.isInteger(n) && n >= 1 && n <= MAX_TEAM ? n : null
  }
  const bare = (s: string): number | null => {
    for (const m of s.matchAll(/\d{1,5}/g)) {
      const n = Number(m[0])
      if (Number.isInteger(n) && n >= 1 && n <= MAX_TEAM) return n
    }
    return null
  }
  return prefixed(owner) ?? prefixed(repo) ?? bare(owner) ?? bare(repo)
}

/** Season year from the repo name (a 20xx in it), else the last-push year, else null. */
function parseSeasonYear(repo: string, pushedAt: string | null | undefined): number | null {
  const m = repo.match(/\b(20\d\d)\b/)
  if (m) return Number(m[1])
  if (pushedAt) {
    const y = new Date(pushedAt).getUTCFullYear()
    if (Number.isFinite(y) && y >= 1992) return y
  }
  return null
}

export function detectRobotCode(input: {
  owner: string
  repo: string
  topics?: string[]
  paths: string[]
  pushedAt?: string | null
}): RobotCodeDetection | null {
  const paths = input.paths.map((p) => p.toLowerCase())
  const topics = (input.topics ?? []).map((t) => t.toLowerCase())
  const some = (re: RegExp) => paths.some((p) => re.test(p))

  // FTC first: its teamcode package is unambiguous, and an FTC repo can also
  // carry gradle files that would otherwise read as FRC.
  const ftcProject =
    some(/(^|\/)teamcode\//) ||
    some(/org\/firstinspires\/ftc\/teamcode/) ||
    topics.includes('ftc') && some(/(^|\/)teamcode/)

  const frcProject =
    some(/(^|\/)frc\/robot\//) ||
    some(/(^|\/)\.wpilib(\/|$)/) ||
    some(/(^|\/)vendordeps\//) ||
    (some(/(^|\/)src\/main\/cpp\//) && some(/robot\.cpp$/)) ||
    (some(/(^|\/)robot\.py$/) && (topics.includes('robotpy') || topics.includes('frc') || some(/(^|\/)(subsystems|commands)\//)))

  const program: 'frc' | 'ftc' | null = ftcProject ? 'ftc' : frcProject ? 'frc' : null
  if (!program) return null

  const teamNumber = parseTeamNumber(input.owner, input.repo)
  if (teamNumber == null) return null

  return { program, teamNumber, seasonYear: parseSeasonYear(input.repo, input.pushedAt) }
}
