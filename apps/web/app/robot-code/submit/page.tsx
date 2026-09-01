import type { Metadata } from 'next'
import Link from 'next/link'
import { RobotCodeSubmitForm } from '@/components/robot-code/robot-code-submit-form'

export const metadata: Metadata = {
  title: 'Add your team',
  description: "Add your team's robot code or CAD to the archive. No account needed.",
}

export default function SubmitRobotCodePage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/robot-code" className="text-sm text-muted hover:text-foreground">
          ← Back to the archive
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Add your team&apos;s code or CAD</h1>
        <p className="mt-2 text-sm text-muted">
          Published robot code and CAD is how the next team over learns to do the thing you already worked out.
          Tell us the team, the season and whether it is code or CAD, and it gets filed under exactly that
          rather than whatever a crawler guesses from the repo name. Someone checks the link before it goes on
          the list, so it will not appear straight away. No account needed.
        </p>
      </div>
      <RobotCodeSubmitForm />
    </div>
  )
}
