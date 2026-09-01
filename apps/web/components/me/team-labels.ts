// Type-only imports, so this module stays free of any runtime dependency on
// the db package. TEAM_MEMBER_ROLES lives in the schema barrel, and importing
// that barrel for its VALUE would drag drizzle and postgres into the client
// bundle. Keying the label records by the schema's types instead gives the same
// protection: add a role or a program to the schema and these fail to compile.
import type { TeamMemberRole } from '@the-tool-pit/db'
import type { FieldProgram } from '@the-tool-pit/db'

export const ROLE_LABEL: Record<TeamMemberRole, string> = {
  student: 'Student',
  mentor: 'Mentor',
  lead_mentor: 'Lead mentor',
  alum: 'Alum',
  supporter: 'Supporter',
}

/** userTeams.program matches events.program, so the three FIRST programs. */
export const PROGRAM_LABEL: Record<FieldProgram, string> = {
  frc: 'FRC',
  ftc: 'FTC',
  fll: 'FLL',
}

/** Option lists for the pickers, in the order they should be offered. */
export const ROLE_OPTIONS = Object.keys(ROLE_LABEL) as TeamMemberRole[]
export const PROGRAM_OPTIONS = Object.keys(PROGRAM_LABEL) as FieldProgram[]

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as TeamMemberRole] ?? role
}

export function programLabel(program: string): string {
  return PROGRAM_LABEL[program as FieldProgram] ?? program.toUpperCase()
}
