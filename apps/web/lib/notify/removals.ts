/**
 * "Someone took their listing down" alerts for the moderators' Discord.
 *
 * The outreach email carries a one-click remove link that suppresses a listing
 * with no account and no review. That is the right amount of friction for the
 * event contact, and zero visibility for the admin: a listing just stops being
 * on the map. So every use of that link posts to the same Discord channel the
 * submissions go to, naming the listing, the address the email went to, and a
 * link to the suppressed row where an admin can restore it.
 *
 * Never throws. The suppress has already happened when this is called and a
 * dead webhook must not turn the contact's confirmation page into an error.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, practiceFields } from '@the-tool-pit/db'
import { eventListingUrl, fieldUrl, postApprovalNotice, reviewQueueUrl, siteUrl } from '@the-tool-pit/types'

export type RemovableListingType = 'event' | 'field'

export async function notifyListingRemovedByContact(type: RemovableListingType, id: string): Promise<void> {
  try {
    const db = getDb()
    if (type === 'event') {
      const [row] = await db
        .select({
          name: eventListings.name,
          slug: eventListings.slug,
          startDate: eventListings.startDate,
          city: eventListings.city,
          region: eventListings.region,
          hostTeams: eventListings.hostTeamNumbers,
          sentTo: eventListings.outreachSentTo,
          sentAt: eventListings.outreachSentAt,
        })
        .from(eventListings)
        .where(eq(eventListings.id, id))
        .limit(1)
      if (!row) return
      await postApprovalNotice({
        vertical: 'event',
        title: `REMOVED by the event contact: ${row.name}`,
        description:
          'Taken off the map with the one-click link in the outreach email. No account, no review. ' +
          'Restore it from the suppressed tab if this was a mistake.',
        reviewUrl: reviewQueueUrl(`/admin/event-listings?status=suppressed#event-${id}`),
        sourceUrl: `${siteUrl()}${eventListingUrl(row.slug)}`,
        facts: [
          { label: 'Dates', value: row.startDate ?? null, inline: true },
          { label: 'Where', value: [row.city, row.region].filter(Boolean).join(', ') || null, inline: true },
          { label: 'Host team(s)', value: (row.hostTeams ?? []).join(', ') || null, inline: true },
          { label: 'Email was sent to', value: row.sentTo ?? null },
          { label: 'Email sent', value: row.sentAt ? row.sentAt.toISOString().slice(0, 10) : null, inline: true },
        ],
        submitter: row.sentTo ? `Event contact (${row.sentTo})` : 'Event contact',
      })
    } else {
      const [row] = await db
        .select({
          name: practiceFields.name,
          slug: practiceFields.slug,
          city: practiceFields.city,
          region: practiceFields.region,
          sentTo: practiceFields.outreachSentTo,
          sentAt: practiceFields.outreachSentAt,
        })
        .from(practiceFields)
        .where(eq(practiceFields.id, id))
        .limit(1)
      if (!row) return
      await postApprovalNotice({
        vertical: 'field',
        title: `REMOVED by the field contact: ${row.name}`,
        description:
          'Taken off the map with the one-click link in the outreach email. No account, no review. ' +
          'Restore it from the suppressed tab if this was a mistake.',
        reviewUrl: reviewQueueUrl(`/admin/practice-fields?status=suppressed#field-${id}`),
        sourceUrl: `${siteUrl()}${fieldUrl(row.slug)}`,
        facts: [
          { label: 'Where', value: [row.city, row.region].filter(Boolean).join(', ') || null, inline: true },
          { label: 'Email was sent to', value: row.sentTo ?? null },
          { label: 'Email sent', value: row.sentAt ? row.sentAt.toISOString().slice(0, 10) : null, inline: true },
        ],
        submitter: row.sentTo ? `Field contact (${row.sentTo})` : 'Field contact',
      })
    }
  } catch (err) {
    console.error(`[discord] removal notice for ${type} ${id} failed:`, err)
  }
}
