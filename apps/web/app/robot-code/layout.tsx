import type { Metadata } from 'next'
import Link from 'next/link'
import { RobotCodeHeader } from '@/components/robot-code/robot-code-header'
import { VerticalFooterLinks } from '@/components/layout/vertical-switcher'
import { SiteCredit } from '@/components/layout/site-credit'

export const metadata: Metadata = {
  title: {
    default: 'Robot Code / CAD',
    template: '%s | Robot Code / CAD',
  },
  description:
    'Open-source robot code and CAD published by FRC and FTC teams, by team number and season.',
}

export default function RobotCodeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <RobotCodeHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <SiteCredit className="text-xs text-muted-2" />
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/robot-code/submit" className="hover:text-foreground">Add your team</Link>
            <Link href="/admin" className="hover:text-foreground">Admin</Link>
            <VerticalFooterLinks current="code" />
          </div>
        </div>
      </footer>
    </div>
  )
}
