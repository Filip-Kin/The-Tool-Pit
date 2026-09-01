import type { Metadata } from 'next'
import Link from 'next/link'
import { GrantSubmitForm } from '@/components/grants/grant-submit-form'

export const metadata: Metadata = {
  title: 'Submit a grant',
  description: 'Tell us about funding a FIRST team can apply for. No account needed.',
}

export default function SubmitGrantPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← All grants
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Submit a grant</h1>
        <p className="mt-2 text-sm text-muted">
          Know a foundation, company or agency that funds robotics teams? Send us the link. Someone reads the
          funder&apos;s own page and confirms the dates before it goes on the list, so it will not appear
          straight away, and a listing that is late beats a deadline that is wrong. No account needed, and your
          contact details stay with the moderators.
        </p>
      </div>
      <GrantSubmitForm />
    </div>
  )
}
