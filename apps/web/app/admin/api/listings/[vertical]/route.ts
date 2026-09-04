import { type NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { ADMIN_CREATE, isSubmitVertical, readAdminBody } from '@/lib/admin/create-listing'
import { formBool } from '@/lib/events/form-parse'

/**
 * POST /admin/api/listings/<vertical>
 *
 * The one door into every vertical that has no bot check on it, which makes
 * the admin check below the only thing holding it shut. See
 * lib/admin/create-listing.ts for what each vertical does behind it and why
 * this exists at all.
 *
 * <vertical> is one of: tool, robot_code, album, field, event, grant.
 *
 * It lives under /admin/api so middleware.ts covers it too: a request with no
 * admin session is bounced to the login page before it reaches this file, and
 * isAdmin() here is the second gate for anything that skips middleware.
 *
 * Fields are the same names the vertical's public form posts, sent either as
 * multipart form data or as JSON. Same normalising, same validation, same
 * hate-speech filter, because it is the same create function underneath. The
 * only two differences are the missing Turnstile check and the missing rate
 * limit.
 *
 * `publish: true` asks for it to go live in the same call. Where the vertical
 * can do that it runs the SAME publish path its Publish button runs, so the
 * publish bar still applies: an event with no pin is created pending and the
 * response names what is missing. Where the vertical cannot, because what was
 * filed is a lead a worker still has to read, the response says so instead of
 * quietly ignoring the flag.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ vertical: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 401 })
  }

  const { vertical } = await params
  if (!isSubmitVertical(vertical)) {
    return NextResponse.json(
      { error: `Unknown vertical "${vertical}". Expected one of: ${Object.keys(ADMIN_CREATE).join(', ')}.` },
      { status: 404 },
    )
  }
  const spec = ADMIN_CREATE[vertical]

  try {
    const form = await readAdminBody(req)
    const wantsPublish = formBool(form, 'publish')

    const created = await spec.create(form)
    if (created.error || !created.id) {
      return NextResponse.json({ error: created.error ?? `Could not create the ${spec.noun}.` }, { status: 400 })
    }

    if (!wantsPublish) {
      return NextResponse.json({
        vertical,
        id: created.id,
        status: 'pending',
        message: created.message ?? 'Created for review.',
      })
    }

    if (!spec.publish) {
      // Asked for something this vertical cannot do yet. The row exists, so
      // this is a 200 that explains, not an error that reads like nothing was
      // written and invites a retry that files a second copy.
      return NextResponse.json({ vertical, id: created.id, status: 'pending', message: spec.publishNote })
    }

    const published = await spec.publish(created.id)
    if (published.error) {
      return NextResponse.json({ vertical, id: created.id, status: 'pending', message: published.error })
    }

    return NextResponse.json({ vertical, id: created.id, status: 'published', message: 'Created and published.' })
  } catch (err) {
    console.error(`[admin/listings/${vertical}] create failed`, err)
    const message = err instanceof Error && err.message.includes('flat body') ? err.message : undefined
    return NextResponse.json({ error: message ?? `Could not create the ${spec.noun}.` }, { status: 500 })
  }
}
