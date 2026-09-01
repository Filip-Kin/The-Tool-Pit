/**
 * Discord notification for new public album submissions. Best-effort: never
 * throws, never blocks the submission. The webhook URL is an env var
 * (PHOTO_SUBMISSION_DISCORD_WEBHOOK); if unset, notifications are skipped.
 */
import { fetchOgImage } from './og'

interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

function addField(fields: EmbedField[], name: string, value: string | null | undefined, inline = false): void {
  const v = value?.toString().trim()
  if (v) fields.push({ name, value: v.slice(0, 1024), inline })
}

interface SubmissionNotice {
  /** The URL the submitter provided (shown + linked in the embed). */
  url: string
  /** The canonical album URL to scrape a cover from (may differ from `url`). */
  coverUrl?: string
  eventHint?: string
  /** Resolved event name when the submitter picked a real event. */
  eventName?: string
  eventCode?: string
  year?: number
  program?: string
  provider?: string
  photographer?: string
  note?: string
}

export async function notifyNewSubmission(s: SubmissionNotice): Promise<void> {
  const webhook = process.env.PHOTO_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  // Admin lives on the main host, not the photos subdomain (which rewrites to /photos).
  const adminUrl = 'https://frc.tools/admin/album-candidates?status=submitted'

  // Best-effort album cover. og.ts already swallows all errors and returns null,
  // and this whole function is fire-and-forget, so a slow host never affects the
  // submission response. Not every host exposes an og:image (Google Drive /
  // Dropbox folders, Flickr from the cloud IP) - those just show no image.
  const cover = await fetchOgImage(s.coverUrl || s.url)

  const eventLabel =
    s.eventName || s.eventHint
      ? [s.eventName ?? s.eventHint, s.year].filter(Boolean).join(' · ')
      : null

  const fields: EmbedField[] = []
  addField(fields, 'Album URL', s.url)
  addField(fields, 'Event', eventLabel)
  addField(fields, 'Event code', s.eventCode, true)
  if (s.year) addField(fields, 'Year', String(s.year), true)
  if (s.program) addField(fields, 'Program', s.program.toUpperCase(), true)
  addField(fields, 'Provider', s.provider, true)
  addField(fields, 'Photographer', s.photographer, true)
  addField(fields, 'Note', s.note)

  const embed: Record<string, unknown> = {
    title: 'New photo album submission',
    url: s.url,
    description: `Review it in the [admin queue](${adminUrl}).`,
    color: 0x7c3aed,
    fields,
  }
  if (cover) embed.image = { url: cover }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })
  } catch {
    // ignore - notification failure must never affect the submission
  }
}
