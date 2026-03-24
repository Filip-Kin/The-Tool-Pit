import { Suspense } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { ToolGrid } from '@/components/tools/tool-grid'
import { SectionHeader } from '@/components/ui/section-header'
import { searchTools } from '@/lib/search/search'
import { getRookieFriendlyTools, getOfficialTools } from '@/lib/queries/tools'

const PROGRAM_META: Record<string, { name: string; color: string; description: string }> = {
  frc: {
    name: 'FRC',
    color: 'var(--color-frc)',
    description: 'Tools for FIRST Robotics Competition teams — programming, CAD, scouting, strategy, and more.',
  },
  ftc: {
    name: 'FTC',
    color: 'var(--color-ftc)',
    description: 'Tools for FIRST Tech Challenge teams — autonomous, teleop, build systems, and resources.',
  },
  fll: {
    name: 'FLL',
    color: 'var(--color-fll)',
    description: 'Tools for FIRST LEGO League teams — mission planning, research, and team resources.',
  },
}

interface ProgramPageProps {
  program: 'frc' | 'ftc' | 'fll'
}

export async function ProgramPage({ program }: ProgramPageProps) {
  const meta = PROGRAM_META[program]

  const [topTools, rookieTools, officialTools] = await Promise.all([
    searchTools({ query: '', program, page: 1, pageSize: 12 }),
    getRookieFriendlyTools(6).then((tools) =>
      tools.filter((t) => t.programs.includes(program)),
    ),
    getOfficialTools(6).then((tools) =>
      tools.filter((t) => t.programs.includes(program)),
    ),
  ])

  return (
    <div className="flex flex-col gap-16 pb-16">
      {/* Hero */}
      <section
        className="border-b border-border-subtle py-12"
        style={{ '--program-color': meta.color } as React.CSSProperties}
      >
        <div className="container mx-auto max-w-6xl px-4 flex flex-col gap-4">
          <div className="h-1 w-16 rounded-full" style={{ backgroundColor: meta.color }} />
          <h1 className="text-4xl font-bold" style={{ color: meta.color }}>
            {meta.name}
          </h1>
          <p className="max-w-xl text-muted">{meta.description}</p>
          <div className="mt-2 max-w-lg">
            <Suspense>
              <SearchBar
                placeholder={`Search ${meta.name} tools…`}
                size="md"
              />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Top tools */}
      <section className="container mx-auto max-w-6xl px-4">
        <SectionHeader
          title={`Top ${meta.name} Tools`}
          href={`/search?program=${program}`}
          linkLabel="See all"
        />
        <ToolGrid tools={topTools.tools} />
      </section>

      {/* Rookie friendly */}
      {rookieTools.length > 0 && (
        <section className="container mx-auto max-w-6xl px-4">
          <SectionHeader
            title="Rookie Friendly"
            description="Good starting points for new teams"
            href={`/search?program=${program}&rookie=true`}
            linkLabel="See all"
          />
          <ToolGrid tools={rookieTools} />
        </section>
      )}

      {/* Official */}
      {officialTools.length > 0 && (
        <section className="container mx-auto max-w-6xl px-4">
          <SectionHeader
            title="Official FIRST Resources"
            href={`/search?program=${program}&official=true`}
            linkLabel="See all"
          />
          <ToolGrid tools={officialTools} />
        </section>
      )}
    </div>
  )
}
