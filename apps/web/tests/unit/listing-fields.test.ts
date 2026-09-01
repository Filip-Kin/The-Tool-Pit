import { describe, it, expect } from 'vitest'
import {
  LISTING_FORMS,
  OWNER_LINK_TYPES,
  TOOL_TAG_KEYS,
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

describe('the tool archive variant', () => {
  /**
   * WHAT WENT WRONG, AND WHY IT IS A SPEC RULE RATHER THAN A RENDER ONE.
   *
   * The team group rendered on every tool's edit form, so every owner of a
   * calculator was invited to tick "this is a team's robot code". Taking the
   * group out of the RENDER alone would have been worse than leaving it: an
   * absent checkbox parses as false, the whole form posts on every autosave, so
   * the first time the owner of a real robot-code listing fixed a typo, the two
   * boxes nobody showed them would have gone false and dropped the repository
   * out of the archive. So the variant reaches the parser, and these tests are
   * about the parser, not about what is on screen.
   */

  it('gives an ordinary tool no team group at all', () => {
    const spec = listingFormSpec('tool')
    expect(spec.groups.map((g) => g.key)).not.toContain('archive')
    const keys = spec.fields.map((f) => f.key)
    for (const key of ['isTeamCode', 'isTeamCad', 'teamNumber', 'seasonYear']) {
      expect(keys).not.toContain(key)
    }
  })

  it('keeps the team number and season on a robot-code listing', () => {
    // The archive quality we want: an owner fixing a wrong team number.
    const spec = listingFormSpec('tool', { inTeamArchive: true })
    expect(spec.groups.map((g) => g.key)).toContain('archive')
    const keys = spec.fields.map((f) => f.key)
    expect(keys).toContain('teamNumber')
    expect(keys).toContain('seasonYear')
  })

  it('keeps the two archive flags off both variants, because they are a moderation call', () => {
    // Which archive a listing belongs in decides where it appears for everyone,
    // not just on its own page, so it is not an owner's box to tick.
    for (const context of [{}, { inTeamArchive: true }]) {
      const keys = listingFormSpec('tool', context).fields.map((f) => f.key)
      expect(keys).not.toContain('isTeamCode')
      expect(keys).not.toContain('isTeamCad')
    }
  })

  it('cannot clear isTeamCode when an ordinary tool saves', () => {
    // The trap, asserted directly. The key must be ABSENT from the parsed
    // values, not false: the update set is built from these keys, and a false
    // would be written.
    const res = parseListingValues(listingFormSpec('tool'), minimal('tool'), {
      toolType: TOOL_TYPES,
    })
    expect('values' in res).toBe(true)
    if ('values' in res) {
      expect(Object.hasOwn(res.values, 'isTeamCode')).toBe(false)
      expect(Object.hasOwn(res.values, 'isTeamCad')).toBe(false)
      expect(Object.hasOwn(res.values, 'teamNumber')).toBe(false)
      expect(Object.hasOwn(res.values, 'seasonYear')).toBe(false)
    }
  })

  it('cannot clear isTeamCode when a robot-code listing saves either', () => {
    // Same assertion on the other variant. The archive form has the team number
    // and the season, and still never speaks for the flags.
    const spec = listingFormSpec('tool', { inTeamArchive: true })
    const fd = minimal('tool')
    fd.set('isTeamCode', 'true')
    fd.set('teamNumber', '3538')
    const res = parseListingValues(spec, fd, { toolType: TOOL_TYPES })
    expect('values' in res).toBe(true)
    if ('values' in res) {
      expect(Object.hasOwn(res.values, 'isTeamCode')).toBe(false)
      expect(res.values.teamNumber).toBe(3538)
    }
  })

  it('holds the archive variant to every rule the plain forms follow', () => {
    // The invariants above walk LISTING_FORMS, which the variant is not in.
    const spec = listingFormSpec('tool', { inTeamArchive: true })
    const groups = new Set(spec.groups.map((g) => g.key))
    for (const field of spec.fields) expect(groups.has(field.group)).toBe(true)
    const keys = spec.fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((k) => LISTING_FORMS.tool.fields.every((f) => f.key !== k))).toEqual([
      'teamNumber',
      'seasonYear',
    ])
  })
})

describe('tag fields', () => {
  const PROGRAMS = ['frc', 'ftc', 'fll'] as const
  const ROLES = ['student', 'mentor', 'volunteer'] as const

  it('offers a picker for each of the three taxonomies', () => {
    const tags = LISTING_FORMS.tool.fields.filter((f) => f.kind === 'tags')
    expect(tags.map((f) => f.key)).toEqual([...TOOL_TAG_KEYS])
  })

  it('takes the choices from the caller, the way the tool type does', () => {
    // The rows are seed data in the database. A hardcoded copy here would be
    // the fourth in the repo and the second to drift.
    for (const field of LISTING_FORMS.tool.fields.filter((f) => f.kind === 'tags')) {
      expect(field.options).toBeNull()
    }
  })

  it('reads a repeated key as a set of slugs', () => {
    const fd = minimal('tool')
    fd.append('programs', 'frc')
    fd.append('programs', 'fll')
    const res = parseListingValues(listingFormSpec('tool'), fd, {
      toolType: TOOL_TYPES,
      programs: PROGRAMS,
      audienceRoles: ROLES,
    })
    // Declared order, not posted order, so the same set always serialises the
    // same way and an autosave that changed nothing is not a diff.
    expect('values' in res && res.values.programs).toEqual(['frc', 'fll'])
  })

  it('drops a slug that is not one of the choices', () => {
    const fd = minimal('tool')
    fd.append('programs', 'frc')
    fd.append('programs', 'vex')
    const res = parseListingValues(listingFormSpec('tool'), fd, {
      toolType: TOOL_TYPES,
      programs: PROGRAMS,
    })
    expect('values' in res && res.values.programs).toEqual(['frc'])
  })

  it('reads no tags at all as an empty set, so an owner can clear one', () => {
    const res = parseListingValues(listingFormSpec('tool'), minimal('tool'), {
      toolType: TOOL_TYPES,
      programs: PROGRAMS,
    })
    expect('values' in res && res.values.programs).toEqual([])
  })

  it('dedupes a key posted twice with the same value', () => {
    const fd = minimal('tool')
    fd.append('audienceRoles', 'mentor')
    fd.append('audienceRoles', 'mentor')
    const res = parseListingValues(listingFormSpec('tool'), fd, {
      toolType: TOOL_TYPES,
      audienceRoles: ROLES,
    })
    expect('values' in res && res.values.audienceRoles).toEqual(['mentor'])
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
    // On the archive variant, because teamNumber is only a field there now.
    const spec = listingFormSpec('tool', { inTeamArchive: true })
    const fd = minimal('tool')
    fd.set('teamNumber', '3538a')
    expect(parseListingValues(spec, fd, { toolType: TOOL_TYPES })).toEqual({
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
    // Asserted on a field, because that is where the checkboxes are: the tool
    // form's two moved out to a reviewer, and this exact rule is why they had
    // to leave the SPEC and not just the render. See the archive tests below.
    const res = parseListingValues(listingFormSpec('field'), minimal('field'))
    expect('values' in res && res.values.hasFms).toBe(false)
  })

  it('reads a ticked checkbox as true', () => {
    const fd = minimal('field')
    fd.set('hasFms', 'true')
    expect(parseListingValues(listingFormSpec('field'), fd)).toMatchObject({
      values: { hasFms: true },
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
