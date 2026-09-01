/**
 * Discord notification for new off-season event submissions. Best-effort:
 * never throws, never blocks the submission. Webhook URL is an env var
 * (EVENT_SUBMISSION_DISCORD_WEBHOOK); if unset, notifications are skipped.
 */
import type { PublicEvent } from '@/lib/events/event-display'
import { eventDateRange, eventLocation, costLabel, EVENT_STATUS_LABEL, REGISTRATION_STATUS_LABEL } from '@/lib/events/event-display'

interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

function addField(fields: EmbedField[], name: string, value: string | null | undefined, inline = false): void {
  const v = value?.toString().trim()
  if (v) fields.push({ name, value: v.slice(0, 1024), inline })
}

export interface EventSubmissionNotice {
  listingId: string
  event: Pick<
    PublicEvent,
    | 'name'
    | 'program'
    | 'startDate'
    | 'endDate'
    | 'venueName'
    | 'city'
    | 'region'
    | 'country'
    | 'capacity'
    | 'costUsd'
    | 'costNote'
    | 'registrationStatus'
    | 'eventStatus'
    | 'website'
    | 'notes'
  >
  submitterName?: string | null
  submitterContact?: string | null
}

export async function notifyNewEventSubmission(s: EventSubmissionNotice): Promise<void> {
  const webhook = process.env.EVENT_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  // Admin lives on the main host (the vertical paths do not carry /admin).
  const adminUrl = 'https://frc.tools/admin/event-listings?status=pending'
  const ev = s.event
  const cost = costLabel(ev)
  const submitter = [s.submitterName, s.submitterContact].filter(Boolean).join(' · ')

  const fields: EmbedField[] = []
  addField(fields, 'Event', ev.name)
  if (ev.program !== 'frc') addField(fields, 'Program', ev.program.toUpperCase(), true)
  addField(fields, 'Status', EVENT_STATUS_LABEL[ev.eventStatus], true)
  addField(fields, 'Dates', eventDateRange(ev), true)
  addField(fields, 'Location', eventLocation(ev))
  addField(fields, 'Capacity', ev.capacity != null ? `${ev.capacity} teams` : null, true)
  addField(fields, 'Cost', cost, true)
  addField(fields, 'Registration', REGISTRATION_STATUS_LABEL[ev.registrationStatus], true)
  addField(fields, 'Website', ev.website)
  addField(fields, 'Notes', ev.notes)
  addField(fields, 'Submitter', submitter)

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'New off-season event submission',
            description: `Review it in the [admin queue](${adminUrl}).`,
            color: 0x7c3aed,
            fields,
          },
        ],
      }),
    })
  } catch {
    // ignore - a notification failure must never affect the submission
  }
}
