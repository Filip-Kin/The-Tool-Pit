/**
 * Whether the "this is not mine, I am just passing it along" box starts ticked,
 * per public submit form, and how a posted value is read back.
 *
 * ONE STATEMENT OF THE DEFAULT, read by the form that renders the box and by
 * the route that reads it back. A default declared in the form alone would be a
 * default the server could not fall back to, and a form that failed to post the
 * field would silently flip somebody into owning a listing they disclaimed.
 *
 * IT IS UNTICKED EVERYWHERE, AND THAT IS THE POINT. Any submission made while
 * signed in belongs to the person who made it, whatever the vertical: album,
 * event, field, tool, grant, robot code. The box is the way to say no, and
 * nothing more than that. It is deliberately not tuned per vertical: a guess
 * about who "usually" fills a form in is exactly the guess that left a
 * photographer's own album listed under nobody.
 *
 * The map below is kept, rather than collapsed to a constant, because it is the
 * one place to change if a vertical ever earns a different answer, and because
 * it makes "all six are the same" a fact you can read rather than assume.
 *
 * Zero dependencies on purpose: a client component imports this.
 */

/** The public submit forms. Not the same list as ListingEntityType. */
export type SubmitVertical = 'tool' | 'robot_code' | 'album' | 'field' | 'event' | 'grant'

/** TRUE would mean the box starts TICKED, which means "do not give this to me". */
export const PASSING_ALONG_DEFAULT: Record<SubmitVertical, boolean> = {
  tool: false,
  grant: false,
  robot_code: false,
  album: false,
  field: false,
  event: false,
}

/**
 * What to write to submitter_owns, from what the form posted.
 *
 * Returns null for a signed-out submitter: there is no account to hang a
 * listing on, so the column records "not applicable" rather than a decision
 * nobody made. An absent or unparseable value falls back to the vertical's
 * default, never to a value the form did not express.
 */
export function submitterOwnsFromForm(
  raw: string | boolean | null | undefined,
  vertical: SubmitVertical,
  signedIn: boolean,
): boolean | null {
  if (!signedIn) return null
  const passingAlong =
    typeof raw === 'boolean'
      ? raw
      : raw === 'true' || raw === 'on' || raw === '1'
        ? true
        : raw === 'false' || raw === 'off' || raw === '0'
          ? false
          : PASSING_ALONG_DEFAULT[vertical]
  return !passingAlong
}
