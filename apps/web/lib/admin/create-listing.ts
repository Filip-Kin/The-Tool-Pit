import type { NextRequest } from 'next/server'
import type { SubmitVertical } from '@/lib/listings/passing-along'
import { formStr as str, formNum as num, formBool as bool, formNumList as numList } from '@/lib/events/form-parse'
import { createSubmission } from '@/lib/submissions/create'
import { createRobotCodeSubmission } from '@/lib/robot-code/create-submission'
import { createAlbumSubmission } from '@/lib/albums/create-submission'
import { createFieldSubmission } from '@/lib/fields/create-submission'
import { createEventSubmission } from '@/lib/events/create-submission'
import { createGrantSubmission } from '@/lib/grants/create-submission'
import { approveEvent } from '@/app/admin/event-listings/actions'
import { approveField } from '@/app/admin/practice-fields/actions'

/**
 * Creating a listing as an admin, for every vertical at once.
 *
 * WHY THIS EXISTS. Six public forms feed the six queues, and every one of them
 * is behind Turnstile. That is right for a form on the public internet and
 * wrong for the two callers who are not the public: a moderator entering
 * something that arrived by email, and a script run by whoever holds the admin
 * session. Both had to drive a browser and solve a bot check to write a row
 * they are already allowed to write. A bot check that staff have to defeat to
 * do their job is one that gets worked around rather than respected.
 *
 * ONE IMPLEMENTATION, SIX ENTRIES, on purpose. The auth gate, the body
 * parsing, the publish semantics and the response shape are the parts that
 * must not drift between verticals, because a vertical that drifts is the one
 * where the admin check quietly ends up after the insert. What each entry
 * keeps to itself is only the two things that genuinely differ: which fields
 * it reads off the body, and what publishing it means.
 *
 * The registry is keyed by SubmitVertical, the same type the passing-along
 * default is keyed by, so "all six are covered" is checked by the compiler
 * rather than remembered.
 *
 * TWO SHAPES, NOT ONE, because the verticals are not the same underneath and
 * pretending otherwise would be the lie that breaks first:
 *
 *   - Events and practice fields write the finished row. An admin has typed
 *     every field, so `publish: true` can put it on the map in the same call,
 *     through the vertical's own approve action and therefore its publish bar.
 *
 *   - Tools, robot code, albums and grants file a LEAD. The public form there
 *     only ever posts a URL and a hint, and a worker or a reviewer builds the
 *     listing from it later. There is nothing to publish yet at this point in
 *     time, so those entries have no publish step and say so, rather than
 *     offering a switch that would quietly do nothing.
 */

/** What a vertical's create call gives back. */
export interface AdminCreateOutcome {
  /** The new row, when one was written. */
  id?: string
  /** Why nothing was written. Becomes a 400. */
  error?: string
  /** Said back to the caller when there is something worth saying. */
  message?: string
}

export interface AdminCreateSpec {
  /** What this vertical calls one of its rows, for the response messages. */
  noun: string
  /** Write the row, or the lead, from the posted body. */
  create: (form: FormData) => Promise<AdminCreateOutcome>
  /**
   * Put it live, when the caller asked for that. It is the SAME function the
   * vertical's own Publish button calls, never a second UPDATE: the publish
   * bar and the notifications live in there, and a second writer would be a
   * second set of rules for the same column.
   *
   * Absent where creating a thing does not yet produce a publishable row.
   */
  publish?: (id: string) => Promise<{ error?: string }>
  /**
   * Why there is no publish step, for the verticals that have none. Said back
   * to a caller who asked to publish, so the answer is a reason rather than
   * silence.
   */
  publishNote?: string
}

/** Filed as staff-entered, and no "please review this" notice to the person who just typed it. */
const AS_ADMIN = { source: 'admin', notify: false } as const

export const ADMIN_CREATE: Record<SubmitVertical, AdminCreateSpec> = {
  event: {
    noun: 'event',
    create: async (form) => {
      const name = str(form, 'name')
      if (!name) return { error: 'An event name is required.' }
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
        AS_ADMIN,
      )
      return result.status === 'error' ? { error: result.message } : { id: result.listingId }
    },
    publish: approveEvent,
  },

  field: {
    noun: 'practice field',
    create: async (form) => {
      const name = str(form, 'name')
      if (!name) return { error: 'A field name is required.' }
      const result = await createFieldSubmission(
        {
          name,
          teamNumber: num(form, 'teamNumber'),
          teamName: str(form, 'teamName'),
          program: str(form, 'program'),
          latitude: num(form, 'latitude'),
          longitude: num(form, 'longitude'),
          address: str(form, 'address'),
          city: str(form, 'city'),
          region: str(form, 'region'),
          country: str(form, 'country'),
          coverage: str(form, 'coverage'),
          perimeter: str(form, 'perimeter'),
          elements: str(form, 'elements'),
          hasFms: bool(form, 'hasFms'),
          ceilingHeightFt: num(form, 'ceilingHeightFt'),
          availability: str(form, 'availability'),
          hours: str(form, 'hours'),
          contactInfo: str(form, 'contactInfo'),
          contactUrl: str(form, 'contactUrl'),
          website: str(form, 'website'),
          notes: str(form, 'notes'),
        },
        AS_ADMIN,
      )
      return result.status === 'error' ? { error: result.message } : { id: result.fieldId }
    },
    publish: approveField,
  },

  tool: {
    noun: 'tool',
    create: async (form) => {
      const url = str(form, 'url')
      if (!url) return { error: 'A URL is required.' }
      const result = await createSubmission({ url, note: str(form, 'note') })
      if (result.status === 'rejected') return { error: result.message }
      return { id: result.submissionId, message: result.message }
    },
    publishNote:
      'A tool is read off its own page by the pipeline before it can be published, so this files it for that and the Candidates queue picks it up.',
  },

  robot_code: {
    noun: 'robot code entry',
    create: async (form) => {
      const url = str(form, 'url')
      if (!url) return { error: 'A URL is required.' }
      const teamNumber = num(form, 'teamNumber')
      const seasonYear = num(form, 'seasonYear')
      if (teamNumber === undefined || seasonYear === undefined) {
        return { error: 'A team number and a season year are required.' }
      }
      const result = await createRobotCodeSubmission({
        url,
        program: str(form, 'program') ?? 'frc',
        teamNumber,
        seasonYear,
        artifactKind: str(form, 'artifactKind') ?? 'code',
        note: str(form, 'note'),
      })
      if (result.status === 'error') return { error: result.message }
      if (result.status === 'duplicate') return { error: result.message }
      return { id: result.submissionId, message: result.message }
    },
    publishNote:
      'Robot code shares the tools pipeline, which reads the repository before it can be published, so this files it for that.',
  },

  album: {
    noun: 'album',
    create: async (form) => {
      const url = str(form, 'url')
      if (!url) return { error: 'An album URL is required.' }
      const result = await createAlbumSubmission({
        url,
        eventHint: str(form, 'eventHint'),
        code: str(form, 'code'),
        year: num(form, 'year'),
        program: str(form, 'program') === 'ftc' ? 'ftc' : 'frc',
        tbaKey: str(form, 'tbaKey'),
        photographerHint: str(form, 'photographer') ?? str(form, 'photographerHint'),
        note: str(form, 'note'),
      })
      // 'duplicate' covers both "already listed" and a URL that is not an
      // album at all, and both are things the caller needs told.
      if (result.status === 'duplicate') return { error: result.message }
      return { id: result.submissionId, message: result.message }
    },
    publishNote:
      'An album is matched to its event and given a cover by the enrich job first, so this files it and the Album candidates queue picks it up.',
  },

  grant: {
    noun: 'grant',
    create: async (form) => {
      const name = str(form, 'name')
      const infoUrl = str(form, 'infoUrl')
      if (!name || !infoUrl) return { error: 'A grant name and an info URL are required.' }
      const result = await createGrantSubmission({
        name,
        infoUrl,
        funderName: str(form, 'funderName'),
        applicationUrl: str(form, 'applicationUrl'),
        summary: str(form, 'summary'),
        notes: str(form, 'notes'),
      })
      if (result.status === 'error' || result.status === 'duplicate') return { error: result.message }
      return { id: result.candidateId, message: result.message }
    },
    publishNote:
      'A grant is published from its candidate screen, where the amount, the deadline and the eligibility are filled in and verified, so this files it there.',
  },
}

/**
 * The body, whichever way it was sent.
 *
 * A browser form posts multipart. A script reaches for JSON, and making it
 * build a multipart body to talk to its own admin API is busywork. Both end up
 * as FormData so each entry above has one set of getters, not two.
 *
 * A nested object would flatten to the string "[object Object]", so it is
 * refused here rather than stored as that.
 */
export async function readAdminBody(req: NextRequest): Promise<FormData> {
  if (!req.headers.get('content-type')?.includes('application/json')) return req.formData()

  const body = (await req.json()) as Record<string, unknown>
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item))
    } else if (typeof value === 'object') {
      throw new Error(`"${key}" is an object; send a flat body`)
    } else {
      form.set(key, String(value))
    }
  }
  return form
}

/** True when `value` names one of the six verticals. */
export function isSubmitVertical(value: string): value is SubmitVertical {
  return Object.prototype.hasOwnProperty.call(ADMIN_CREATE, value)
}
