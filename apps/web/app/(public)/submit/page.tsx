import type { Metadata } from 'next'
import { SubmitForm } from '@/components/submit/submit-form'
import { GithubLinkCard } from '@/components/me/github-link-card'

export const metadata: Metadata = {
  title: 'Submit a Tool',
  description: 'Know a tool that should be listed? Submit it here.',
}

export default function SubmitPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-16">
      <div className="mb-10 flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Submit a Tool</h1>
        <p className="text-muted">
          Know something useful that should be here? Paste the URL and we&apos;ll take care of the
          rest. No account required.
        </p>
      </div>
      {/* Renders nothing for a signed-out visitor, and nothing for somebody
          already linked. Here because a person submitting a tool is usually
          holding the repo it is built from. */}
      <div className="mb-8">
        <GithubLinkCard />
      </div>
      <SubmitForm />
    </div>
  )
}
