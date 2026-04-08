import type { Metadata } from 'next'
import { getRobotCodeTools, getAvailableSeasonYears, getRobotCodeStats } from '@/lib/queries/robot-code'
import { RobotCodeArchive } from '@/components/robot-code/robot-code-archive'

export const metadata: Metadata = {
  title: 'Robot Code Archive | The Tool Pit',
  description: 'Browse open-source FRC, FTC, and FLL team robot code repositories by program, season, and team number.',
}

interface PageProps {
  searchParams: Promise<{
    program?: string
    year?: string
    team?: string
    page?: string
  }>
}

export default async function RobotCodePage({ searchParams }: PageProps) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const seasonYear = params.year ? parseInt(params.year, 10) : undefined
  const teamNumber = params.team ? parseInt(params.team, 10) : undefined

  const [results, availableYears, stats] = await Promise.all([
    getRobotCodeTools({
      program: params.program,
      seasonYear,
      teamNumber,
      page,
    }),
    getAvailableSeasonYears(),
    getRobotCodeStats(),
  ])

  return (
    <RobotCodeArchive
      results={results}
      availableYears={availableYears}
      stats={stats}
      program={params.program}
      seasonYear={seasonYear}
      teamNumber={teamNumber}
      page={page}
    />
  )
}
