import type { Metadata } from 'next'
import { getRobotCodeTeams, type RobotCodeProgram } from '@/lib/queries/robot-code'
import { RobotCodeArchive } from '@/components/robot-code/robot-code-archive'

/**
 * Not frozen at build time.
 *
 * Without this the page is statically rendered once during the build and
 * served with a year-long cache, so it shows whatever the database said at
 * build time forever. That is how a tool kept showing "Stale" on the home page
 * after the freshness thresholds were widened and the rows had already been
 * recomputed, and how a suppressed listing can keep appearing until the next
 * unrelated deploy. Sixty seconds is far fresher than a deploy and still cheap.
 */
export const revalidate = 60


export const metadata: Metadata = {
  // `absolute` bypasses every ancestor title.template (this layout's own
  // "%s | Robot Code / CAD" AND the root's "%s | FRCTools") so this renders
  // exactly once. A plain string here previously got both templates applied
  // on top of an already-stale "The Tool Pit" suffix: "Robot Code / CAD |
  // The Tool Pit | FRC.Tools".
  title: { absolute: 'Robot Code / CAD | FRCTools' },
  description: 'Browse open-source FRC, FTC, and FLL team robot code and CAD by team number and season.',
}

const PROGRAMS: RobotCodeProgram[] = ['frc', 'ftc', 'fll']

interface PageProps {
  searchParams: Promise<{ program?: string }>
}

export default async function RobotCodePage({ searchParams }: PageProps) {
  const params = await searchParams
  const program: RobotCodeProgram = PROGRAMS.includes(params.program as RobotCodeProgram)
    ? (params.program as RobotCodeProgram)
    : 'frc'

  const teams = await getRobotCodeTeams(program)

  return <RobotCodeArchive teams={teams} program={program} />
}
