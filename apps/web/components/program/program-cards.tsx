import Link from 'next/link'
import { getDb } from '@/lib/db'
import { tools, toolPrograms, programs } from '@the-tool-pit/db'
import { eq, and, sql } from 'drizzle-orm'

const PROGRAMS = [
  {
    slug: 'frc',
    name: 'FRC',
    fullName: 'FIRST Robotics Competition',
    description: 'Full-size robots. Intense competition. Industry-level tools.',
    color: 'var(--color-frc)',
    href: '/frc',
  },
  {
    slug: 'ftc',
    name: 'FTC',
    fullName: 'FIRST Tech Challenge',
    description: 'Compact robots, big engineering challenges.',
    color: 'var(--color-ftc)',
    href: '/ftc',
  },
  {
    slug: 'fll',
    name: 'FLL',
    fullName: 'FIRST LEGO League',
    description: 'LEGO robotics and research projects for younger teams.',
    color: 'var(--color-fll)',
    href: '/fll',
  },
]

async function getToolCountsByProgram(): Promise<Record<string, number>> {
  const db = getDb()
  const rows = await db
    .select({ slug: programs.slug, count: sql<number>`count(distinct ${toolPrograms.toolId})::int` })
    .from(programs)
    .leftJoin(toolPrograms, eq(toolPrograms.programId, programs.id))
    .leftJoin(tools, and(eq(tools.id, toolPrograms.toolId), eq(tools.status, 'published')))
    .groupBy(programs.slug)
  return Object.fromEntries(rows.map((r) => [r.slug, r.count]))
}

export async function ProgramCards() {
  const counts = await getToolCountsByProgram()

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {PROGRAMS.map((p) => (
        <Link
          key={p.slug}
          href={p.href}
          className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 transition-all hover:border-border/80 hover:bg-surface-2"
          style={{ '--program-color': p.color } as React.CSSProperties}
        >
          <div
            className="h-1 w-12 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xl font-bold" style={{ color: p.color }}>{p.name}</span>
            <span className="text-sm font-medium text-foreground">{p.fullName}</span>
          </div>
          <p className="text-xs text-muted leading-relaxed">{p.description}</p>
          {counts[p.slug] != null && counts[p.slug] > 0 && (
            <p className="text-xs text-muted-2 mt-auto">{counts[p.slug]} tools</p>
          )}
        </Link>
      ))}
    </div>
  )
}
