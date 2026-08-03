'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { crawlCandidates } from '@the-tool-pit/db'
import { adminPublishCandidate } from '@/lib/admin/publish-candidate'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

export async function approveCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await adminPublishCandidate(candidateId)
  revalidatePath('/admin/candidates')
  revalidatePath(`/admin/candidates/${candidateId}`)
  revalidatePath('/admin/tools')
  if ('error' in result) return { error: result.error }
  return {}
}

export async function suppressCandidate(candidateId: string, rejectionReason?: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(crawlCandidates)
    .set({
      status: 'suppressed',
      rejectionReason: rejectionReason?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(crawlCandidates.id, candidateId))
  revalidatePath('/admin/candidates')
  revalidatePath(`/admin/candidates/${candidateId}`)
}
