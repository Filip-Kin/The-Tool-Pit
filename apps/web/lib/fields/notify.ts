/**
 * Discord notification for new practice field submissions. Best-effort: never
 * throws, never blocks the submission. Webhook URL is an env var
 * (FIELD_SUBMISSION_DISCORD_WEBHOOK); if unset, notifications are skipped.
 */
import type { FieldCoverage, FieldElements, FieldPerimeter, FieldAvailability } from '@the-tool-pit/db'
import {
  COVERAGE_LABEL,
  ELEMENTS_LABEL,
  PERIMETER_LABEL,
  AVAILABILITY_LABEL,
  accessLabel,
  isLowCeiling,
} from '@/lib/fields/field-display'

// Photos are served from the public fields host (the photo route works
// regardless of moderation state), so the embed can show the uploaded image
// even while the field is still pending.
const FIELDS_PUBLIC_BASE = 'https://fields.filipkin.com'

interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

/** Push a Discord embed field only when the value is present (Discord rejects empty values). */
function addField(fields: EmbedField[], name: string, value: string | null | undefined, inline = false): void {
  const v = value?.toString().trim()
  if (v) fields.push({ name, value: v.slice(0, 1024), inline })
}

interface FieldSubmissionNotice {
  /** Field row id - used to build the public photo URL. */
  fieldId: string
  name: string
  teamNumber?: number | null
  teamName?: string | null
  program?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  address?: string | null
  coverage: FieldCoverage
  perimeter: FieldPerimeter
  elements: FieldElements
  hasFms: boolean
  ceilingHeightFt?: number | null
  availability: FieldAvailability
  hours?: string | null
  contactInfo?: string | null
  contactUrl?: string | null
  website?: string | null
  notes?: string | null
  submitterName?: string | null
  submitterContact?: string | null
  /** First uploaded photo's id, for the embed preview (null if none). */
  photoId?: string | null
  /** How many photos were uploaded. */
  photoCount?: number
}

export async function notifyNewFieldSubmission(s: FieldSubmissionNotice): Promise<void> {
  const webhook = process.env.FIELD_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  // Admin lives on the main host, not the fields subdomain (which rewrites to /fields).
  const adminUrl = 'https://frc.tools/admin/practice-fields?status=pending'

  const location = [s.city, s.region, s.country].filter(Boolean).join(', ')
  const spec = [COVERAGE_LABEL[s.coverage], ELEMENTS_LABEL[s.elements], PERIMETER_LABEL[s.perimeter]]
    .filter(Boolean)
    .join(' · ')
  const team = s.teamNumber
    ? `#${s.teamNumber}${s.teamName ? ` ${s.teamName}` : ''}`
    : s.teamName || null
  const ceiling =
    typeof s.ceilingHeightFt === 'number'
      ? `${s.ceilingHeightFt} ft${isLowCeiling(s.ceilingHeightFt) ? ' ⚠️ low' : ''}`
      : null
  const availability = [AVAILABILITY_LABEL[s.availability], s.hours].filter(Boolean).join(' · ')
  const access = [accessLabel({ contactUrl: s.contactUrl ?? null }), s.contactInfo].filter(Boolean).join(' · ')
  const submitter = [s.submitterName, s.submitterContact].filter(Boolean).join(' · ')

  const fields: EmbedField[] = []
  addField(fields, 'Field', s.name)
  addField(fields, 'Team', team, true)
  if (s.program && s.program !== 'frc') addField(fields, 'Program', s.program.toUpperCase(), true)
  addField(fields, 'FMS', s.hasFms ? 'Yes' : 'No', true)
  addField(fields, 'Spec', spec)
  addField(fields, 'Ceiling', ceiling, true)
  addField(fields, 'Availability', availability, true)
  addField(fields, 'Location', location)
  addField(fields, 'Address', s.address)
  addField(fields, 'Access', access)
  addField(fields, 'Sign-up link', s.contactUrl)
  addField(fields, 'Website', s.website)
  addField(fields, 'Notes', s.notes)
  addField(fields, 'Submitter', submitter)
  if (s.photoCount && s.photoCount > 1) addField(fields, 'Photos', `${s.photoCount} uploaded`, true)

  const embed: Record<string, unknown> = {
    title: 'New practice field submission',
    description: `Review it in the [admin queue](${adminUrl}).`,
    color: 0x6366f1,
    fields,
  }
  if (s.photoId) {
    embed.image = { url: `${FIELDS_PUBLIC_BASE}/api/fields/photo/${s.photoId}` }
  }

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

/** Discord ping for a community edit proposal. Same webhook, best-effort. */
export async function notifyFieldEdit(s: {
  fieldName: string
  note?: string
  addedPhotos?: number
  removedPhotos?: number
}): Promise<void> {
  const webhook = process.env.FIELD_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  const adminUrl = 'https://frc.tools/admin/field-edits'
  const photoChange = [
    s.addedPhotos ? `+${s.addedPhotos} photo${s.addedPhotos > 1 ? 's' : ''}` : null,
    s.removedPhotos ? `-${s.removedPhotos} photo${s.removedPhotos > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  const fields: EmbedField[] = []
  addField(fields, 'Field', s.fieldName)
  addField(fields, 'What changed', s.note)
  addField(fields, 'Photos', photoChange || null)
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'New practice field edit proposal',
            description: `Review it in the [admin queue](${adminUrl}).`,
            color: 0xf59e0b,
            fields,
          },
        ],
      }),
    })
  } catch {
    // ignore
  }
}
