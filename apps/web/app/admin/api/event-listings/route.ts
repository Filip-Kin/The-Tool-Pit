import { type NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { createEventSubmission } from '@/lib/events/create-submission'
import { approveEvent } from '@/app/admin/event-listings/actions'
import { formStr as str, formNum as num, formBool as bool, formNumList as numList } from '@/lib/events/form-parse'

/**
 * Create an off-season event as an admin.
 *
 * WHY THIS EXISTS. Until now the only way a row entered this table was the
 * public form at /events/submit, and that form is behind Turnstile. Turnstile
 * is right for the public and wrong for the two callers who are not the
 * public: a moderator typing in an event somebody emailed over, and a script
 * run by whoever holds the admin session. Both of those had to drive a browser
 * and solve a bot check to write a row they are allowed to write, and a bot
 * check that staff have to defeat to do their job is a bot check that gets
 * worked around rather than respected.
 *
 * It lives under /admin/api so middleware.ts covers it: a request without an
 * admin session is bounced to the login page before it reaches this file, and
 * isAdmin() below is the second gate for anything that skips middleware.
 *
 * The row is filed with source 'admin', so the directory can still tell a
 * staff-entered event from a public submission and from a scraped one.
 *
 * Takes the same field names as the public form, as multipart form data or as
 * JSON. Same normalising, same validation, same hate-speech filter, because it
 * is the same function underneath. The only two differences are the missing
 * Turnstile check and the missing rate limit.
 *
 * Send `publish: true` to put it straight on the map. That runs the SAME
 * publish path the Publish button runs, so the publish bar still applies: an
 * event with no pin or no start date is created pending and the response says
 * what it is missing, rather than being published half-filled.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 401 })
  }

  try {
    const form = await readForm(req)

    const name = str(form, 'name')
    if (!name) return NextResponse.json({ error: 'An event name is required.' }, { status: 400 })

    const result = await createEventSubmission(
      {
        name,
        program: str(form, 'program'),
        hostTeamNumber: num(form, 'hostTeamNumber'),
        hostTeamNumbers: numList(form, 'hostTeamNumbers'),
        latitude: num(form, 'latitude'),
        longitude: num(form, 'longitude'),
        venueName: str(form, 'venueName'),
        address: str(form, 'address'),
        city: str(form, 'city'),
        region: str(form, 'region'),
        country: str(form, 'country'),
        startDate: str(form, 'startDate'),
        endDate: str(form, 'endDate'),
        days: num(form, 'days'),
        parallelDivisions: bool(form, 'parallelDivisions'),
        capacity: num(form, 'capacity'),
        costUsd: num(form, 'costUsd'),
        costNote: str(form, 'costNote'),
        registrationStatus: str(form, 'registrationStatus'),
        registrationOpensAt: str(form, 'registrationOpensAt'),
        registrationClosesAt: str(form, 'registrationClosesAt'),
        volunteerStatus: str(form, 'volunteerStatus'),
        eventStatus: str(form, 'eventStatus'),
        website: str(form, 'website'),
        registrationUrl: str(form, 'registrationUrl'),
        teamListUrl: str(form, 'teamListUrl'),
        volunteerUrl: str(form, 'volunteerUrl'),
        chiefDelphiUrl: str(form, 'chiefDelphiUrl'),
        contactEmail: str(form, 'contactEmail'),
        notes: str(form, 'notes'),
        // No submitter and no IP hash on purpose. Nobody submitted this: an
        // admin entered it, and source 'admin' is what records that.
      },
      { source: 'admin', notify: false },
    )

    if (result.status === 'error' || !result.listingId) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    if (!bool(form, 'publish')) {
      return NextResponse.json({ id: result.listingId, status: 'pending', message: 'Created for review.' })
    }

    const published = await approveEvent(result.listingId)
    if (published.error) {
      // The row exists and is pending. That is the honest outcome, so it is a
      // 200 with the reason rather than an error that reads like nothing was
      // written and invites a retry that files a second copy.
      return NextResponse.json({ id: result.listingId, status: 'pending', message: published.error })
    }

    return NextResponse.json({ id: result.listingId, status: 'published', message: 'Created and published.' })
  } catch (err) {
    console.error('[admin/event-listings] create failed', err)
    return NextResponse.json({ error: 'Could not create the event.' }, { status: 500 })
  }
}

/**
 * The body, whichever way it was sent.
 *
 * A browser form posts multipart. A script reaches for JSON, and making it
 * build a multipart body to talk to its own admin API is busywork. Both end up
 * as FormData so there is one set of getters below, not two.
 */
async function readForm(req: NextRequest): Promise<FormData> {
  if (!req.headers.get('content-type')?.includes('application/json')) return req.formData()

  const body = (await req.json()) as Record<string, unknown>
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item))
    } else {
      form.set(key, typeof value === 'boolean' ? String(value) : String(value))
    }
  }
  return form
}
