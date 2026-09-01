'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { Queue } from 'bullmq'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import {
  teamProfiles,
  teamProfileMembers,
  userTeams,
  TEAM_ORG_TYPES,
  SCHOOL_TYPES,
  type NewTeamProfile,
} from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'
import { computeCompleteness, type ProfileFieldValues } from '@/components/me/profile-fields'
import { canEditProfile } from './queries'

/**
 * Team profile writes.
 *
 * Everything here is scoped to a team_profile_members row for the signed-in
 * user. A profile carries an EIN, a mailing address and a named contact, so
 * "which team do you say you are on" (accounts.userTeams, self-asserted) is not
 * the same permission as "you may edit this team's profile". The only bridge
 * between the two is createTeamProfile below, and it only ever creates the
 * FIRST membership, for a team that has no profile yet.
 */

// #region parsing

/** Text field: trimmed, and an empty box means null, not an empty string. */
function text(form: FormData, name: string, maxLength = 500): string | null {
  const raw = form.get(name)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Truncated rather than rejected. These are free-text boxes with no right
  // answer, and losing a whole save because a mission statement ran long would
  // be worse than storing a long-but-capped one. The cap is far above what a
  // real answer needs.
  return trimmed.slice(0, maxLength)
}

/**
 * Whole number, or null. Rejects the values Number() quietly accepts
 * ('12e3', '0x10', ' 12 ') by matching digits instead, so what is stored is
 * what was typed. Out-of-range comes back as an error rather than a clamp,
 * because silently storing a different number than the team typed is the kind
 * of thing that ends up on an application.
 */
function integer(
  form: FormData,
  name: string,
  min: number,
  max: number,
  label: string,
): { value: number | null } | { error: string } {
  const raw = form.get(name)
  if (typeof raw !== 'string' || raw.trim() === '') return { value: null }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return { error: `${label} must be a whole number.` }
  const parsed = Number(trimmed)
  if (parsed < min || parsed > max) return { error: `${label} must be between ${min} and ${max}.` }
  return { value: parsed }
}

/**
 * Tri-state yes/no.
 *
 * '' is "nobody has said" and stores null, which is what makes the matcher
 * return 'missing_info' instead of quietly reading an unanswered question as
 * "no". titleOne is the field this matters most for: a false stored by accident
 * rules a team out of equity-focused funding they may well qualify for.
 */
function triState(form: FormData, name: string): boolean | null {
  const raw = form.get(name)
  if (raw === 'yes') return true
  if (raw === 'no') return false
  return null
}

/** One of a fixed set, falling back to the column default rather than erroring. */
function enumValue<T extends string>(form: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const raw = form.get(name)
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/**
 * EIN, normalised to the IRS's own 12-3456789 shape when it is nine digits.
 * Anything else is stored as typed: a non-US team may have a registration
 * number in a completely different format, and refusing it would block them
 * from filling in a field that is only ever copied into a form by hand.
 */
function parseEin(form: FormData): string | null {
  const raw = text(form, 'ein', 40)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return raw
}

/**
 * Country. NOT NULL on the column with a 'US' default, and the matcher tests
 * grants against it, so an empty box falls back to 'US' rather than storing an
 * empty string that would compare against nothing. Two-letter codes are
 * uppercased; longer spellings are left alone because the matcher already folds
 * "USA" and "United States" itself.
 */
function parseCountry(form: FormData): string {
  const raw = text(form, 'country', 60)
  if (!raw) return 'US'
  return raw.length <= 3 ? raw.toUpperCase() : raw
}

/**
 * Reusable answers, read from `boilerplate.<key>` inputs.
 *
 * The keys are addressable by grant_form_fields.profilePath as
 * `boilerplate.<key>`, so they are read off the form field names rather than a
 * fixed list here: a team that has an answer under a key we never suggested
 * keeps it. Empty answers are dropped instead of stored as '', because prefill
 * treats an empty string as an answer and would send a blank to the funder.
 */
function parseBoilerplate(form: FormData): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('boilerplate.')) continue
    const key = name.slice('boilerplate.'.length).trim()
    if (!key || typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    out[key] = trimmed.slice(0, 5000)
  }
  return Object.keys(out).length > 0 ? out : null
}

// #endregion

// #region save

export interface ProfileActionResult {
  error?: string
  /** New completeness percentage, so the caller can show the change straight away. */
  completeness?: number
  profileId?: string
}

/** Sanity bound on a team number, matching /me/team's own check. */
const MAX_TEAM_NUMBER = 99_999

/** FIRST started in 1992, and a rookie year in the future is a typo. */
const MIN_ROOKIE_YEAR = 1992

export async function saveTeamProfile(formData: FormData): Promise<ProfileActionResult> {
  const user = await getCurrentUser()
  // Returned as a value, not a redirect: the caller is a client form mid
  // transition and a message it can render beats tripping the error boundary.
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }

  const profileId = String(formData.get('profileId') ?? '')
  if (!profileId) return { error: 'Missing profile.' }
  if (!(await canEditProfile(user.id, profileId))) {
    // Same message for "no such profile" and "not yours", so a guessed UUID
    // cannot be used to find out which teams have profiles.
    return { error: 'You do not have edit access to that team profile.' }
  }

  const rookieYear = integer(formData, 'rookieYear', MIN_ROOKIE_YEAR, new Date().getFullYear() + 1, 'Rookie year')
  if ('error' in rookieYear) return { error: rookieYear.error }
  const studentCount = integer(formData, 'studentCount', 0, 1000, 'Number of students')
  if ('error' in studentCount) return { error: studentCount.error }
  const mentorCount = integer(formData, 'mentorCount', 0, 500, 'Number of mentors')
  if ('error' in mentorCount) return { error: mentorCount.error }
  const annualBudget = integer(formData, 'annualBudget', 0, 10_000_000, 'Annual budget')
  if ('error' in annualBudget) return { error: annualBudget.error }

  // Written out field by field rather than looped, because the columns have
  // genuinely different rules and a generic loop would hide them.
  const values = {
    teamName: text(formData, 'teamName', 120),
    orgType: enumValue(formData, 'orgType', TEAM_ORG_TYPES, 'unknown'),
    ein: parseEin(formData),
    fiscalSponsorName: text(formData, 'fiscalSponsorName', 200),
    schoolType: enumValue(formData, 'schoolType', SCHOOL_TYPES, 'unknown'),
    schoolName: text(formData, 'schoolName', 200),
    titleOne: triState(formData, 'titleOne'),
    country: parseCountry(formData),
    region: text(formData, 'region', 60),
    city: text(formData, 'city', 120),
    postalCode: text(formData, 'postalCode', 20),
    mailingAddress: text(formData, 'mailingAddress', 400),
    rookieYear: rookieYear.value,
    studentCount: studentCount.value,
    mentorCount: mentorCount.value,
    annualBudget: annualBudget.value,
    contactName: text(formData, 'contactName', 120),
    contactEmail: text(formData, 'contactEmail', 200),
    contactPhone: text(formData, 'contactPhone', 40),
    website: text(formData, 'website', 300),
    missionStatement: text(formData, 'missionStatement', 5000),
    boilerplate: parseBoilerplate(formData),
    updatedAt: new Date(),
  }

  // Stored rather than computed on read so a later digest job can find thin
  // profiles in SQL without loading and scoring every row. The one list in
  // components/me/profile-fields.ts is the source of truth for both.
  const completeness = computeCompleteness(values as ProfileFieldValues)

  const db = getDb()
  await db
    .update(teamProfiles)
    .set({ ...values, completeness })
    .where(eq(teamProfiles.id, profileId))

  // Eligibility depends on these exact fields, so a stale match set after an
  // edit is the difference between "we need your state" and a list of state
  // grants. Best effort: a save must not fail because Redis is down, but the
  // failure is logged rather than swallowed.
  await requestRematch(profileId)

  revalidatePath('/me/team/profile')
  revalidatePath('/me')
  return { completeness }
}

// #endregion

// #region create

/**
 * Start a profile for a team the user has already claimed on /me/team.
 *
 * Two gates. The claim has to exist, so a profile cannot be conjured for an
 * arbitrary team number, and the team must not already have a profile: if it
 * does, someone else has entered private details and an existing member has to
 * add this person. There is no invite flow yet, so that case is an honest dead
 * end with an explanation rather than a silent join.
 */
export async function createTeamProfile(formData: FormData): Promise<ProfileActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }

  const program = String(formData.get('program') ?? '').trim()
  const rawNumber = String(formData.get('teamNumber') ?? '').trim()
  if (!/^\d+$/.test(rawNumber)) return { error: 'Team number must be a whole number.' }
  const teamNumber = Number(rawNumber)
  if (teamNumber < 1 || teamNumber > MAX_TEAM_NUMBER) return { error: 'That team number is out of range.' }

  const db = getDb()

  const [claim] = await db
    .select({ id: userTeams.id })
    .from(userTeams)
    .where(
      and(
        eq(userTeams.userId, user.id),
        eq(userTeams.program, program),
        eq(userTeams.teamNumber, teamNumber),
      ),
    )
    .limit(1)
  if (!claim) return { error: 'Add that team on the My teams tab first.' }

  const seed: NewTeamProfile = { program, teamNumber }
  // onConflictDoNothing against the (program, teamNumber) unique index, so two
  // people setting the team up at the same moment cannot create two profiles.
  // The loser of that race falls through to the "already exists" branch below.
  const [created] = await db.insert(teamProfiles).values(seed).onConflictDoNothing().returning()

  if (!created) {
    return {
      error:
        'Someone on that team has already set up its profile. Ask them to add you, since it holds details we will not hand out on a team number alone.',
    }
  }

  await db.insert(teamProfileMembers).values({
    profileId: created.id,
    userId: user.id,
    // First member owns it. Only an owner should be able to hand out access
    // once an invite flow exists.
    role: 'owner',
  })

  await requestRematch(created.id)

  revalidatePath('/me/team/profile')
  revalidatePath('/me')
  return { profileId: created.id }
}

// #endregion

// #region rematch

/**
 * Queue name shared with the worker. The worker registers the consumer; this
 * side only ever produces, so the two must agree on the string.
 */
const GRANT_MATCH_QUEUE = 'grant-match'

let _matchQueue: Queue<{ profileId: string }> | undefined

function getGrantMatchQueue(): Queue<{ profileId: string }> {
  if (!_matchQueue) {
    _matchQueue = new Queue<{ profileId: string }>(GRANT_MATCH_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    })
  }
  return _matchQueue
}

/**
 * Ask the worker to recompute this profile's matches.
 *
 * jobId is the profile id, so a team hammering Save does not queue twenty
 * identical passes: BullMQ drops a duplicate jobId while the first is still
 * pending. The nightly sweep is the safety net if this never lands.
 */
async function requestRematch(profileId: string): Promise<void> {
  try {
    await getGrantMatchQueue().add(
      'match-profile',
      { profileId },
      { jobId: `profile:${profileId}`, removeOnComplete: true },
    )
  } catch (err) {
    console.warn(`[team-profile] could not queue a rematch for ${profileId}:`, err)
  }
}

// #endregion
