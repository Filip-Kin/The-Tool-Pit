import { describe, it, expect } from 'vitest'
import {
  LISTING_FORMS,
  OWNER_LINK_TYPES,
  linkFieldKey,
  listingFormSpec,
  parseListingValues,
} from '@/components/me/listing-fields'

/**
 * The owner listing editor's rules, checked where they are actually enforced.
 *
 * Every one of these is a way an owner's edit could be lost or a value the
 * server should have refused could be stored, and none of them shows up in a
 * type error: a spec is data, and a FormData is strings.
 *
 * The db package is deliberately NOT imported here. It re-exports the postgres
 * client, which needs a connection string to load, and the point of the spec
 * module is that it stands on its own.
 */

const TOOL_TYPES = ['web_app', 'github_project', 'other'] as const

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

/** A minimum-viable post for a vertical: just the fields it refuses to lose. */
function minimal(entityType: 'tool' | 'album' | 'field' | 'event'): FormData {
  const fd = new FormData()
  for (const field of listingFormSpec(entityType).fields) {
    if (field.required) fd.set(field.key, 'Something')
  }
  return fd
}

describe('the spec itself', () => {
  it('gives every vertical a name it cannot lose', () => {
    // A listing whose title can be blanked renders as an empty card, and the
    // owner form is the only place that could do it.
    for (const entityType of ['tool', 'field', 'event'] as const) {
      const required = LISTING_FORMS[entityType].fields.filter((f) => f.required)
      expect(required.map((f) => f.key)).toEqual(['name'])
    }
  })

  it('puts every field in a group the form will render', () => {
    // A field whose group has no heading is declared, parsed and saved, and
    // never shown, which is the worst of the three.
    for (const spec of Object.values(LISTING_FORMS)) {
      const groups = new Set(spec.groups.map((g) => g.key))
      for (const field of spec.fields) expect(groups.has(field.group)).toBe(true)
    }
  })

  it('never declares the same key twice in one vertical', () => {
    for (const spec of Object.values(LISTING_FORMS)) {
      const keys = spec.fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('keeps admin-only columns out of every form', () => {
    // The line an owner does not cross: an owner controls the CONTENT of their
    // listing, not its moderation state and not the numbers we rank it by.
    //
    // WHAT MOVED OUT OF THIS LIST, AND WHY. A practice field's location and
    // spec, and an event's map pin, used to be here: they were held back to
    // field_edit_proposals so a move got a second look. They are now boxes on
    // the owner's form, because an owner queueing behind a moderator to correct
    // their own address was the gate this whole change exists to remove. The
    // proposal route is unchanged and is still the path for a STRANGER
    // suggesting an edit to somebody else's field.
    const forbidden = [
      'status',
      'isOfficial',
      'isVendor',
      'isRookieFriendly',
      'confidenceScore',
      'popularityScore',
      'githubStars',
      'chiefDelphiLikes',
      'freshnessState',
      'adminNotes',
      'slug',
      'provider',
      'sourceType',
      'canonicalUrl',
      'eventId',
      'source',
      'rejectionReason',
      'tbaKey',
      'registeredTeamCount',
      'submitterName',
      'submitterContact',
      'submitterIpHash',
      'submittedByUserId',
      // Every practice field is assumed to have AprilTags set up, so it is not
      // a per-field toggle for anybody, owner or admin.
      'aprilTags',
      // A grant's dates and amounts are a reviewer's verified reading of the
      // funder's page. A wrong deadline costs a team an application.
      'verifiedAt',
      'verifiedBy',
    ]
    for (const spec of Object.values(LISTING_FORMS)) {
      for (const field of spec.fields) expect(forbidden).not.toContain(field.key)
    }
  })

  it('gives a field owner the location and spec, with no review in front of it', () => {
    // The other half of the rule above, asserted positively, because a form
    // that silently loses a field is exactly as broken as one that gains a
    // forbidden column and neither shows up in a type error.
    const keys = LISTING_FORMS.field.fields.map((f) => f.key)
    for (const key of [
      'latitude',
      'longitude',
      'address',
      'city',
      'region',
      'country',
      'coverage',
      'perimeter',
      'elements',
      'hasFms',
      'ceilingHeightFt',
      'teamNumber',
    ]) {
      expect(keys).toContain(key)
    }
  })

  it('lets an event owner move their own map pin', () => {
    const keys = LISTING_FORMS.event.fields.map((f) => f.key)
    expect(keys).toContain('latitude')
    expect(keys).toContain('longitude')
  })

  it('keeps coordinates decimal, because rounding one moves the pin 100 km', () => {
    for (const vertical of ['field', 'event'] as const) {
      const lat = LISTING_FORMS[vertical].fields.find((f) => f.key === 'latitude')
      const lng = LISTING_FORMS[vertical].fields.find((f) => f.key === 'longitude')
      expect(lat?.kind).toBe('number')
      expect(lng?.kind).toBe('number')
      expect(lat?.min).toBe(-90)
      expect(lat?.max).toBe(90)
      expect(lng?.min).toBe(-180)
      expect(lng?.max).toBe(180)
    }
  })

  it('offers a box for every link type an owner controls, GitHub included', () => {
    // The gap that started this: no link fields at all, so an owner could not
    // fix the repository URL, which is the most load-bearing field on a tool.
    const keys = new Set(LISTING_FORMS.tool.fields.map((f) => f.key))
    for (const type of OWNER_LINK_TYPES) expect(keys.has(linkFieldKey(type))).toBe(true)
    expect(keys.has('link_github')).toBe(true)
  })
})

describe('parseListingValues', () => {
  it('refuses a blank name rather than storing one', () => {
    const res = parseListingValues(listingFormSpec('tool'), form({ name: '   ' }), {
      toolType: TOOL_TYPES,
    })
    expect(res).toEqual({ error: 'Name cannot be empty.' })
  })

  it('reads a cleared box as null, so an owner can take a value down', () => {
    const fd = minimal('field')
    fd.set('notes', '')
    const res = parseListingValues(listingFormSpec('field'), fd)
    expect('values' in res && res.values.notes).toBeNull()
  })

  it('leaves a blank select alone instead of nulling a NOT NULL column', () => {
    const res = parseListingValues(listingFormSpec('event'), minimal('event'))
    expect('values' in res && res.values.registrationStatus).toBeUndefined()
  })

  it('refuses a select value that is not on the list', () => {
    const fd = minimal('event')
    fd.set('registrationStatus', 'definitely_open')
    const res = parseListingValues(listingFormSpec('event'), fd)
    expect(res).toEqual({ error: 'Registration is not one of the choices.' })
  })

  it('takes the allowed tool types from the caller, because the db barrel is server-only', () => {
    const fd = minimal('tool')
    fd.set('toolType', 'github_project')
    expect(parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })).toMatchObject({
      values: { toolType: 'github_project' },
    })
    // With no tuple supplied there is nothing to check against, so nothing passes.
    expect(parseListingValues(listingFormSpec('tool'), fd)).toEqual({
      error: 'Type is not one of the choices.',
    })
  })

  it('refuses a number outside its declared range', () => {
    const fd = minimal('event')
    fd.set('capacity', '5000')
    expect(parseListingValues(listingFormSpec('event'), fd)).toEqual({
      error: 'Team slots has to be between 1 and 999.',
    })
  })

  it('refuses a number that is not one', () => {
    const fd = minimal('tool')
    fd.set('teamNumber', '3538a')
    expect(parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })).toEqual({
      error: 'Team number has to be a whole number.',
    })
  })

  it('accepts zero cost, because free is a real answer', () => {
    const fd = minimal('event')
    fd.set('costUsd', '0')
    expect(parseListingValues(listingFormSpec('event'), fd)).toMatchObject({ values: { costUsd: 0 } })
  })

  it('refuses a link that is not http or https', () => {
    // These end up as the href of a link somebody clicks.
    const fd = minimal('tool')
    fd.set('link_github', 'javascript:alert(1)')
    expect(parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })).toEqual({
      error: 'GitHub repository has to start with http:// or https://.',
    })
  })

  it('accepts a real repository URL', () => {
    const fd = minimal('tool')
    fd.set('link_github', 'https://github.com/Filip-Kin/the-tool-pit')
    expect(parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })).toMatchObject({
      values: { link_github: 'https://github.com/Filip-Kin/the-tool-pit' },
    })
  })

  it('refuses a date that is not one', () => {
    const fd = minimal('event')
    fd.set('startDate', '12 September')
    expect(parseListingValues(listingFormSpec('event'), fd)).toEqual({
      error: 'First day has to be a date.',
    })
  })

  it('truncates text to the cap the input already enforces', () => {
    const fd = minimal('tool')
    fd.set('summary', 'x'.repeat(900))
    const res = parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })
    expect('values' in res && (res.values.summary as string).length).toBe(500)
  })

  it('reads an absent checkbox as false rather than leaving it alone', () => {
    // An unticked box is simply missing from a FormData, and the form posts
    // every field, so absent has to mean off or a box could never be unticked.
    const res = parseListingValues(listingFormSpec('tool'), minimal('tool'), {
      toolType: TOOL_TYPES,
    })
    expect('values' in res && res.values.isTeamCode).toBe(false)
  })

  it('reads a ticked checkbox as true', () => {
    const fd = minimal('tool')
    fd.set('isTeamCode', 'true')
    expect(parseListingValues(listingFormSpec('tool'), fd, { toolType: TOOL_TYPES })).toMatchObject({
      values: { isTeamCode: true },
    })
  })

  it('returns a value for every field, so a partial post cannot blank the rest', () => {
    // The save path writes the whole set. A key the parser skipped would be
    // written as undefined and silently dropped from the update.
    const spec = listingFormSpec('event')
    const res = parseListingValues(spec, minimal('event'))
    expect('values' in res).toBe(true)
    if ('values' in res) {
      for (const field of spec.fields) expect(Object.hasOwn(res.values, field.key)).toBe(true)
    }
  })
})
