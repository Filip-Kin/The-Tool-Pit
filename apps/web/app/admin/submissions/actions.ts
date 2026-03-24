'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { getSubmissionQueue } from '@/lib/submissions/queue'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

export async function rejectSubmission(submissionId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(submissions)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))
  revalidatePath('/admin/submissions')
}

export async function requeueSubmission(submissionId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()

  // Reset to pending and re-enqueue
  await db
    .update(submissions)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))

  await getSubmissionQueue().add('process-submission', { submissionId })
  revalidatePath('/admin/submissions')
}

export async function markNeedsReview(submissionId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(submissions)
    .set({ status: 'needs_review', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))
  revalidatePath('/admin/submissions')
}
