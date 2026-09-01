/**
 * "The thing you submitted is now live" emails, queued from the moderation
 * actions.
 *
 * ONE FUNCTION PER OUTCOME, and each one owns the whole job: work out who to
 * tell, load the detail that identifies the thing, build the link, queue the
 * row. The admin actions call one line and stay about moderation.
 *
 * THREE RULES EVERY FUNCTION IN HERE KEEPS.
 *
 *   1. NO USER, NO EMAIL. Anonymous submission is a first-class case on every
 *      one of these queues, and it stays anonymous: submittedByUserId is null,
 *      queueNotification writes nothing, and nobody hears about it. There is no
 *      fallback to submitterContact, which is a free-text field an admin reads,
 *      not an address anyone confirmed for mail.
 *   2. NEVER THROW. The approval has already happened by the time these are
 *      called. A missing row, a dropped connection or a bad payload must not
 *      turn a published listing into an error on the admin's screen, so every
 *      function is wrapped and a failure is one log line.
 *   3. SAY WHAT IT WAS. The payload carries the name, the identifying facts and
 *      an absolute link to the live page, because "your submission was
 *      approved" is useless in an inbox six weeks later.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  albumCandidates,
  albumSubmissions,
  crawlCandidates,
  eventListings,
  events,
  fieldEditProposals,
  grantCandidates,
  practiceFields,
  submissions,
  tools,
  queueNotification,
  type ClaimStatus,
  type FieldEditProposalData,
  type ListingEntityType,
} from '@the-tool-pit/db'
import {
  albumEventUrl,
  eventListingUrl,
  fieldUrl,
  grantListingUrl,
  myListingsUrl,
  toolUrl,
  type ApprovalEmailPayload,
  type EmailFact,
} from '@the-tool-pit/types'
import { listingFacts } from '@/lib/queries/listing-ownership'

// #region plumbing

/**
 * Run one notify function, swallow anything it throws.
 *
 * Rule 2 in one place. The label is what an admin greps for when somebody says
 * they never got the email.
 */
async function attempt(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.error(`[notify] ${label} failed: ${(err as Error).message}`)
  }
}

/** Drop empty rows so a half-filled listing does not email a table of blanks. */
function facts(rows: Array<{ label: string; value: string | null | undefined }>): EmailFact[] {
  return rows
    .filter((r): r is { label: string; value: string } => Boolean(r.value && r.value.trim()))
    .map((r) => ({ label: r.label, value: r.value.trim() }))
}

/** "Auckland, Waikato, NZ" from whichever parts we hold. */
function place(parts: Array<string | null | undefined>): string | null {
  const joined = parts.filter((p) => p && p.trim()).join(', ')
  return joined || null
}

/** "Team 3538" or the free-text org name, whichever we have. */
function team(number: number | null, name: string | null): string | null {
  if (number) return name ? `Team ${number} (${name})` : `Team ${number}`
  return name
}

/** "12 to 13 July 2026", or the single date, from ISO yyyy-mm-dd strings. */
function dateRange(start: string | null, end: string | null): string | null {
  const fmt = (iso: string) => {
    // Parsed as UTC on purpose. These are date-only columns with no time and no
    // zone, and letting the server's local zone shift them moves an event a day.
    const at = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(at.getTime())) return iso
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(at)
  }
  if (start && end && start !== end) return `${fmt(start)} to ${fmt(end)}`
  if (start) return fmt(start)
  if (end) return fmt(end)
  return null
}

// #endregion

// #region practice fields

/** A practice field submission was published to the map. */
export async function notifyFieldPublished(fieldId: string): Promise<void> {
  await attempt(`field_published ${fieldId}`, async () => {
    const db = getDb()
    const [row] = await db
      .select({
        id: practiceFields.id,
        name: practiceFields.name,
        city: practiceFields.city,
        region: practiceFields.region,
        country: practiceFields.country,
        teamNumber: practiceFields.teamNumber,
        teamName: practiceFields.teamName,
        userId: practiceFields.submittedByUserId,
      })
      .from(practiceFields)
      .where(eq(practiceFields.id, fieldId))
      .limit(1)
    if (!row?.userId) return

    const payload: ApprovalEmailPayload = {
      title: row.name,
      url: fieldUrl(row.id),
      facts: facts([
        { label: 'Where', value: place([row.city, row.region, row.country]) },
        { label: 'Host', value: team(row.teamNumber, row.teamName) },
      ]),
    }

    await queueNotification({
      userId: row.userId,
      kind: 'field_published',
      subjectType: 'practice_field',
      subjectId: row.id,
      payload,
    })
  })
}

/**
 * A suggested edit to a published field was applied.
 *
 * `changed` is the list of fields that actually moved, worked out by the caller
 * before it wrote the patch, because afterwards the before-state is gone. It is
 * the whole point of this email: the reader gets told which of their
 * suggestions was taken, not just that "an edit" went through.
 */
export async function notifyFieldEditApplied(proposalId: string, changed: string[]): Promise<void> {
  await attempt(`field_edit_applied ${proposalId}`, async () => {
    const db = getDb()
    const [row] = await db
      .select({
        id: fieldEditProposals.id,
        fieldId: fieldEditProposals.fieldId,
        userId: fieldEditProposals.submittedByUserId,
        fieldName: practiceFields.name,
        city: practiceFields.city,
        region: practiceFields.region,
      })
      .from(fieldEditProposals)
      .innerJoin(practiceFields, eq(practiceFields.id, fieldEditProposals.fieldId))
      .where(eq(fieldEditProposals.id, proposalId))
      .limit(1)
    if (!row?.userId) return

    const payload: ApprovalEmailPayload = {
      title: row.fieldName,
      url: fieldUrl(row.fieldId),
      facts: facts([{ label: 'Where', value: place([row.city, row.region]) }]),
      changes: changed,
    }

    await queueNotification({
      userId: row.userId,
      kind: 'field_edit_applied',
      subjectType: 'field_edit_proposal',
      subjectId: row.id,
      payload,
    })
  })
}

/**
 * Which columns a proposal actually changes, as reader-facing phrases.
 *
 * Compared against the field as it stands BEFORE the patch, so this has to be
 * called first. Only the columns the proposal carries are considered: a
 * proposal that says nothing about the ceiling height is not proposing to
 * change it.
 */
export function describeFieldEditChanges(
  proposed: FieldEditProposalData,
  current: Record<string, unknown>,
): string[] {
  const LABELS: Array<[keyof FieldEditProposalData, string]> = [
    ['name', 'Name'],
    ['teamNumber', 'Team number'],
    ['teamName', 'Team name'],
    ['program', 'Programme'],
    ['latitude', 'Pin location'],
    ['longitude', 'Pin location'],
    ['address', 'Address'],
    ['city', 'City'],
    ['region', 'Region'],
    ['country', 'Country'],
    ['coverage', 'Coverage'],
    ['perimeter', 'Perimeter'],
    ['elements', 'Field elements'],
    ['hasFms', 'FMS'],
    ['ceilingHeightFt', 'Ceiling height'],
    ['availability', 'Availability'],
    ['hours', 'Hours'],
    ['contactInfo', 'Contact'],
    ['contactUrl', 'Contact link'],
    ['website', 'Website'],
    ['notes', 'Notes'],
  ]

  const out: string[] = []
  const seen = new Set<string>()
  for (const [key, label] of LABELS) {
    const next = proposed[key]
    if (next === undefined) continue
    // Loose compare: a proposal carries '' where the column holds null, and
    // reporting "Notes changed" when both are empty is noise.
    const before = current[key] ?? null
    const after = next ?? null
    if (String(before ?? '') === String(after ?? '')) continue
    if (seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  // One phrase, not a diff. The email links to the field, and the live page is
  // a better answer to "what does it say now" than a before/after table that
  // has to escape somebody's free-text notes.
  return out.map((label) => `${label} updated`)
}

// #endregion

// #region event listings

/** An off-season event listing was published. */
export async function notifyEventPublished(listingId: string): Promise<void> {
  await attempt(`event_published ${listingId}`, async () => {
    const db = getDb()
    const [row] = await db
      .select({
        id: eventListings.id,
        name: eventListings.name,
        venueName: eventListings.venueName,
        city: eventListings.city,
        region: eventListings.region,
        country: eventListings.country,
        startDate: eventListings.startDate,
        endDate: eventListings.endDate,
        hostTeamNumber: eventListings.hostTeamNumber,
        userId: eventListings.submittedByUserId,
      })
      .from(eventListings)
      .where(eq(eventListings.id, listingId))
      .limit(1)
    if (!row?.userId) return

    const payload: ApprovalEmailPayload = {
      title: row.name,
      url: eventListingUrl(row.id),
      facts: facts([
        { label: 'Dates', value: dateRange(row.startDate, row.endDate) },
        { label: 'Where', value: place([row.venueName, row.city, row.region, row.country]) },
        { label: 'Host', value: row.hostTeamNumber ? `Team ${row.hostTeamNumber}` : null },
      ]),
    }

    await queueNotification({
      userId: row.userId,
      kind: 'event_published',
      subjectType: 'event_listing',
      subjectId: row.id,
      payload,
    })
  })
}

// #endregion

// #region tools, robot code and CAD

/**
 * A tool, robot code or CAD submission reached the directory.
 *
 * Keyed on the SUBMISSION, not the crawl candidate, for two reasons: the
 * submission is where the submitter's user id lives, and a candidate found by a
 * crawler has no submitter at all, so a crawl publish falls straight through
 * this function without a query.
 */
export async function notifyToolPublished(candidateId: string, toolId: string): Promise<void> {
  await attempt(`tool_published ${candidateId}`, async () => {
    const db = getDb()
    const [candidate] = await db
      .select({ submissionId: crawlCandidates.submissionId })
      .from(crawlCandidates)
      .where(eq(crawlCandidates.id, candidateId))
      .limit(1)
    if (!candidate?.submissionId) return

    const [submission] = await db
      .select({
        id: submissions.id,
        userId: submissions.submittedByUserId,
        teamNumber: submissions.teamNumber,
        seasonYear: submissions.seasonYear,
        artifactKind: submissions.artifactKind,
      })
      .from(submissions)
      .where(eq(submissions.id, candidate.submissionId))
      .limit(1)
    if (!submission?.userId) return

    const [tool] = await db
      .select({ name: tools.name, slug: tools.slug, summary: tools.summary })
      .from(tools)
      .where(eq(tools.id, toolId))
      .limit(1)
    if (!tool) return

    const artifact =
      submission.artifactKind === 'cad' ? 'CAD' : submission.artifactKind === 'code' ? 'Robot code' : null

    const payload: ApprovalEmailPayload = {
      title: tool.name,
      url: toolUrl(tool.slug),
      facts: facts([
        { label: 'What it says', value: tool.summary },
        { label: 'Team', value: submission.teamNumber ? `Team ${submission.teamNumber}` : null },
        { label: 'Season', value: submission.seasonYear ? String(submission.seasonYear) : null },
        { label: 'Filed as', value: artifact },
      ]),
    }

    await queueNotification({
      userId: submission.userId,
      kind: 'tool_published',
      subjectType: 'submission',
      subjectId: submission.id,
      payload,
    })
  })
}

// #endregion

// #region albums

/**
 * A photo album submission was attached to its event and published.
 *
 * Albums have no page of their own on this site, so the link is the event page
 * the album now appears on. When the event has no TBA key there is nothing
 * stable to link to, and the email goes out without a button rather than with a
 * broken one.
 */
export async function notifyAlbumPublished(candidateId: string, eventId: string): Promise<void> {
  await attempt(`album_published ${candidateId}`, async () => {
    const db = getDb()
    const [candidate] = await db
      .select({
        submissionId: albumCandidates.submissionId,
        rawMetadata: albumCandidates.rawMetadata,
        canonicalUrl: albumCandidates.canonicalUrl,
      })
      .from(albumCandidates)
      .where(eq(albumCandidates.id, candidateId))
      .limit(1)
    if (!candidate?.submissionId) return

    const [submission] = await db
      .select({ id: albumSubmissions.id, userId: albumSubmissions.submittedByUserId })
      .from(albumSubmissions)
      .where(eq(albumSubmissions.id, candidate.submissionId))
      .limit(1)
    if (!submission?.userId) return

    const [event] = await db
      .select({ name: events.name, year: events.year, tbaKey: events.tbaKey })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)

    const meta = candidate.rawMetadata ?? {}
    const eventLabel = event ? [event.name, event.year ? String(event.year) : null].filter(Boolean).join(' ') : null

    const payload: ApprovalEmailPayload = {
      // A title is not guaranteed on an album, so fall back to the event it is
      // now filed under, which is what the reader recognises anyway.
      title: meta.title?.trim() || eventLabel || 'Your album',
      url: event?.tbaKey ? albumEventUrl(event.tbaKey) : null,
      facts: facts([
        { label: 'Event', value: eventLabel },
        { label: 'Photographer', value: meta.photographer ?? null },
        { label: 'Album', value: candidate.canonicalUrl },
      ]),
    }

    await queueNotification({
      userId: submission.userId,
      kind: 'album_published',
      subjectType: 'album_submission',
      subjectId: submission.id,
      payload,
    })
  })
}

// #endregion

// #region grants

/**
 * A submitted grant was checked and listed.
 *
 * The title is the grant AS PUBLISHED, not as submitted. A moderator reads the
 * funder's page and corrects the form before publishing, so the name on the
 * listing is the one the reader will see, and telling them the name they typed
 * would be telling them something that is no longer true.
 */
export async function notifyGrantPublished(
  candidateId: string,
  grant: { name: string; slug: string; funderName?: string | null },
): Promise<void> {
  await attempt(`grant_published ${candidateId}`, async () => {
    const db = getDb()
    const [candidate] = await db
      .select({ id: grantCandidates.id, userId: grantCandidates.submittedByUserId })
      .from(grantCandidates)
      .where(eq(grantCandidates.id, candidateId))
      .limit(1)
    if (!candidate?.userId) return

    const payload: ApprovalEmailPayload = {
      title: grant.name,
      url: grantListingUrl(grant.slug),
      facts: facts([{ label: 'Funder', value: grant.funderName ?? null }]),
    }

    await queueNotification({
      userId: candidate.userId,
      kind: 'grant_published',
      subjectType: 'grant_candidate',
      subjectId: candidate.id,
      payload,
    })
  })
}

// #endregion

// #region listing claims

/**
 * An admin settled a claim, either way.
 *
 * The only path here with a guaranteed address: listing_claims.user_id is NOT
 * NULL, because you have to be signed in to file one. A rejection gets its own
 * kind and its own body, and carries the reviewer's note verbatim when there is
 * one, because "no" with no reason is the thing people write back about.
 */
export async function notifyClaimResolved(
  claimId: string,
  entityType: ListingEntityType,
  entityId: string,
  userId: string,
  status: ClaimStatus,
  reviewerNote: string | null,
): Promise<void> {
  await attempt(`claim_${status} ${claimId}`, async () => {
    const listing = await listingFacts(entityType, entityId)

    const payload: ApprovalEmailPayload = {
      title: listing?.title ?? 'the listing you claimed',
      // Always /me/listings rather than the listing itself: on an approval that
      // is where the edit form is, and on a rejection the listing page would
      // say nothing about the decision.
      url: myListingsUrl(),
      facts: facts([{ label: 'Listing', value: listing?.subtitle ?? null }]),
      reviewerNote,
    }

    await queueNotification({
      userId,
      kind: status === 'verified' ? 'claim_approved' : 'claim_rejected',
      subjectType: 'listing_claim',
      subjectId: claimId,
      payload,
    })
  })
}

// #endregion
