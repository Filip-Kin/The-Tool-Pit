import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos, FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY, FIELD_PROGRAMS } from '@the-tool-pit/db'
import type { NewPracticeField } from '@the-tool-pit/db'
import { uniqueFieldSlug } from '@/lib/queries/fields'
import { sendApprovalNotice, reviewFieldUrl } from '@the-tool-pit/types'
import {
  COVERAGE_LABEL,
  ELEMENTS_LABEL,
  PERIMETER_LABEL,
  AVAILABILITY_LABEL,
  accessLabel,
  isLowCeiling,
} from '@/lib/fields/field-display'
import { wrapLongitude } from '@/lib/geo/longitude'
import { containsHateSpeech, urlContainsHateSpeech } from '@the-tool-pit/db/hate-filter'

export interface CreateFieldSubmissionInput {
  name: string
  teamNumber?: number
  teamName?: string
  program?: string
  latitude?: number
  longitude?: number
  address?: string
  city?: string
  region?: string
  country?: string
  coverage?: string
  perimeter?: string
  elements?: string
  hasFms?: boolean
  aprilTags?: boolean
  ceilingHeightFt?: number
  availability?: string
  hours?: string
  contactInfo?: string
  contactUrl?: string
  website?: string
  notes?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: submitting a
   * field never requires an account, an account only earns attribution and
   * lets the submitter find this again later.
   */
  submittedByUserId?: string
  /**
   * What the "just passing it along" box said, resolved by the route with
   * lib/listings/passing-along.ts. NULL for a signed-out submitter, TRUE means
   * the listing is theirs when a moderator approves it.
   */
  submitterOwns?: boolean | null
  /** Optional photos to attach and review before publish (gallery order). */
  photos?: { data: Buffer; contentType: string }[]
}

export interface CreateFieldSubmissionResult {
  fieldId?: string
  status: 'pending' | 'error'
  message: string
}

function pickEnum<T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback
}

const CURRENT_YEAR = new Date().getFullYear()

export async function createFieldSubmission(
  input: CreateFieldSubmissionInput,
): Promise<CreateFieldSubmissionResult> {
  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'A field name is required.' }

  if (
    containsHateSpeech(input.name, input.notes, input.teamName, input.city, input.contactInfo, input.submitterName) ||
    urlContainsHateSpeech(input.website)
  ) {
    return { status: 'error', message: "This submission can't be accepted." }
  }

  const db = getDb()

  const coverage = pickEnum(input.coverage, FIELD_COVERAGE, 'full')
  const elements = pickEnum(input.elements, FIELD_ELEMENTS, 'wood')
  const perimeter = pickEnum(input.perimeter, FIELD_PERIMETER, 'none')
  const availability = pickEnum(input.availability, FIELD_AVAILABILITY, 'unknown')
  const hasFms = Boolean(input.hasFms)

  // Sanity-clamp coordinates; drop them if out of range so the map never gets junk.
  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  // Folded, not dropped. A longitude arriving outside [-180, 180] is a real
  // position on a repeated copy of the world, and discarding it filed the
  // record with NO coordinates at all, so the pin never appeared again and
  // nothing said why. The client normalises too; this is the backstop, and it
  // is the one that matters because an API caller never touches the picker.
  const lng = typeof input.longitude === 'number' ? wrapLongitude(input.longitude) : null

  const teamNumber =
    typeof input.teamNumber === 'number' && Number.isInteger(input.teamNumber) && input.teamNumber > 0
      ? input.teamNumber
      : null

  const ceiling =
    typeof input.ceilingHeightFt === 'number' && input.ceilingHeightFt > 0 && input.ceilingHeightFt < 200
      ? input.ceilingHeightFt
      : null

  // A stable human slug, built from the team number and name once. A later
  // rename keeps it, the same rule tools and grants use.
  const slug = await uniqueFieldSlug([teamNumber, name].filter(Boolean).join(' '))

  const values: NewPracticeField = {
    name,
    slug,
    teamNumber,
    teamName: input.teamName?.trim() || null,
    program: pickEnum(input.program, FIELD_PROGRAMS, 'frc'),
    latitude: lat,
    longitude: lng,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    country: input.country?.trim() || null,
    coverage,
    perimeter,
    elements,
    hasFms,
    // Every practice field is assumed to have AprilTags set up, so it's no
    // longer a per-field toggle - always true.
    aprilTags: true,
    ceilingHeightFt: ceiling,
    availability,
    hours: input.hours?.trim() || null,
    contactInfo: input.contactInfo?.trim() || null,
    contactUrl: input.contactUrl?.trim() || null,
    website: input.website?.trim() || null,
    notes: input.notes?.trim() || null,
    submitterName: input.submitterName?.trim() || null,
    submitterContact: input.submitterContact?.trim() || null,
    submitterIpHash: input.submitterIpHash,
    submittedByUserId: input.submittedByUserId ?? null,
    submitterOwns: input.submitterOwns ?? null,
    status: 'pending',
    source: 'submission',
  }

  const [row] = await db.insert(practiceFields).values(values).returning({ id: practiceFields.id })

  // Store the uploaded photos (reviewed before the field is published) in
  // gallery order. Keep the first id for the Discord embed preview.
  let firstPhotoId: string | null = null
  const photos = input.photos ?? []
  if (photos.length > 0) {
    const inserted = await db
      .insert(fieldPhotos)
      .values(photos.map((p, i) => ({ fieldId: row.id, contentType: p.contentType, data: p.data, sortOrder: i })))
      .returning({ id: fieldPhotos.id })
    firstPhotoId = inserted[0]?.id ?? null
  }

  // The photo is served from the public fields host, which serves it whatever
  // the moderation state, so the embed shows the uploaded picture while the
  // field is still pending. That is most of the review right there.
  sendApprovalNotice({
    vertical: 'field',
    title: name,
    reviewUrl: reviewFieldUrl(row.id),
    imageUrl: firstPhotoId ? `https://fields.filipkin.com/api/fields/photo/${firstPhotoId}` : null,
    submitter: [values.submitterName, values.submitterContact].filter(Boolean).join(' · ') || null,
    facts: [
      { label: 'Team', value: teamNumber ? `#${teamNumber}${values.teamName ? ` ${values.teamName}` : ''}` : values.teamName, inline: true },
      { label: 'Program', value: values.program && values.program !== 'frc' ? values.program.toUpperCase() : null, inline: true },
      { label: 'FMS', value: hasFms ? 'Yes' : 'No', inline: true },
      { label: 'Spec', value: [COVERAGE_LABEL[coverage], ELEMENTS_LABEL[elements], PERIMETER_LABEL[perimeter]].filter(Boolean).join(' · ') },
      { label: 'Ceiling', value: ceiling != null ? `${ceiling} ft${isLowCeiling(ceiling) ? ' ⚠️ low' : ''}` : null, inline: true },
      { label: 'Availability', value: [AVAILABILITY_LABEL[availability], values.hours].filter(Boolean).join(' · '), inline: true },
      { label: 'Location', value: [values.city, values.region, values.country].filter(Boolean).join(', ') },
      { label: 'Address', value: values.address },
      { label: 'Access', value: [accessLabel({ contactUrl: values.contactUrl ?? null }), values.contactInfo].filter(Boolean).join(' · ') },
      { label: 'Sign-up link', value: values.contactUrl },
      { label: 'Website', value: values.website },
      { label: 'Notes', value: values.notes },
      { label: 'Photos', value: photos.length > 1 ? `${photos.length} uploaded` : null, inline: true },
    ],
  })

  return {
    fieldId: row.id,
    status: 'pending',
    message: "Thanks! We'll review this field and add it to the map.",
  }
}

export { CURRENT_YEAR }
