'use server'

import { redirect } from 'next/navigation'
import { suppressEmail, verifyUnsubscribe } from '@the-tool-pit/db'

/**
 * The accountless "stop all email to this address" action behind every footer.
 *
 * Called from the confirm page's form, never linked directly. The signed token
 * in the link is the only authorisation, so it is re-checked here rather than
 * trusted from the GET that rendered the page. Suppressing is idempotent, so a
 * double submit or a replayed link changes nothing the second time.
 */
export async function confirmUnsubscribe(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
  const token = String(formData.get('token') ?? '')

  if (!email || !verifyUnsubscribe(email, token)) {
    redirect('/unsubscribe?error=1')
  }

  await suppressEmail(email, 'unsubscribe_link')

  redirect(
    `/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&done=1`,
  )
}
