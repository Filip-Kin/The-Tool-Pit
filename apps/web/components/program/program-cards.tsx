import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

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

export function ProgramCards() {
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
        </Link>
      ))}
    </div>
  )
}
