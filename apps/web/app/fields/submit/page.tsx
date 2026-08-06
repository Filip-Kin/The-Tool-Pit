import type { Metadata } from 'next'
import Link from 'next/link'
import { FieldSubmitForm } from '@/components/fields/field-submit-form'

export const metadata: Metadata = {
  title: 'Add a field',
  description: 'Share your team practice field with the FRC community.',
}

export default function SubmitFieldPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Add a practice field</h1>
        <p className="mt-2 text-sm text-muted">
          Sharing your field helps nearby teams practise. Submissions are reviewed before they go on the
          map. Only the field details and photo are shown publicly - your contact details stay with the
          moderators.
        </p>
      </div>
      <FieldSubmitForm />
    </div>
  )
}
