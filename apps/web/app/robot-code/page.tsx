import type { Metadata } from 'next'
import { getRobotCodeTeams, type RobotCodeProgram } from '@/lib/queries/robot-code'
import { RobotCodeArchive } from '@/components/robot-code/robot-code-archive'

export const metadata: Metadata = {
  title: 'Robot Code / CAD | The Tool Pit',
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
