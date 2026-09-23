import { describe, expect, it } from 'vitest'
import { dateOnlyDeadlineDay, dateOnlyNoteRest, deriveCycleStatus, endOfDayIn, funderTimeZone, isDateOnlyNote } from '@the-tool-pit/db/grant-dates'
import { isArchiveUrl, isPdfUrl, isSecondhandGrantHost, isThirdPartyGrantUrl } from '@the-tool-pit/db/grant-urls'
import { isSecondhandGrantHost as prefilterSecondhand } from '../src/grants/prefilter.js'
import { autoRouteDenyReason } from '../src/grants/route-aggregator.js'
import { scoreInfoResult } from '../src/grants/info-page.js'

const NOW = new Date('2026-09-23T16:00:00Z')

describe('a date-only deadline is 23:59 in the funder\'s zone', () => {
  it('national grants read Eastern (3M: closes October 17, 2026)', () => {
    expect(funderTimeZone({ geoScope: 'national', regions: [] })).toBe('America/New_York')
    expect(endOfDayIn('2026-10-17', funderTimeZone({ geoScope: 'national' }))).toBe('2026-10-17T23:59:00-04:00')
  })
  it('a state grant reads its first state\'s zone', () => {
    expect(funderTimeZone({ geoScope: 'state', regions: ['SC'] })).toBe('America/New_York') // Abney Foundation
    expect(funderTimeZone({ geoScope: 'state', regions: ['AL'] })).toBe('America/Chicago') // AMSTI
    expect(funderTimeZone({ geoScope: 'local', regions: ['US-MI'] })).toBe('America/Detroit')
    expect(funderTimeZone({ geoScope: 'region', regions: ['ON'] })).toBe('America/Toronto')
    expect(endOfDayIn('2026-11-16', 'America/New_York')).toBe('2026-11-16T23:59:00-05:00') // Ben & Jerry's, after DST ends
    expect(endOfDayIn('2026-09-30', 'America/Chicago')).toBe('2026-09-30T23:59:00-05:00')
    expect(endOfDayIn('2026-12-31', 'America/Chicago')).toBe('2026-12-31T23:59:00-06:00')
    expect(endOfDayIn('2026-02-30')).toBeNull()
  })
  it('shows the funder\'s day, for new rows and the old 23:59:59Z ones', () => {
    expect(dateOnlyDeadlineDay(new Date('2026-10-17T23:59:00-04:00'))).toBe('2026-10-17')
    expect(dateOnlyDeadlineDay(new Date('2026-12-31T23:59:00-10:00'))).toBe('2026-12-31')
    expect(dateOnlyDeadlineDay('2026-10-17T23:59:59Z')).toBe('2026-10-17')
  })
  it('the note is a label, and the old wordings still read as date-only', () => {
    expect(isDateOnlyNote('No time given')).toBe(true)
    expect(isDateOnlyNote('The funder states the date; no time of day given. "x"')).toBe(true)
    expect(isDateOnlyNote('Closes 2026-10-17 (the funder gives no time of day). "x"')).toBe(true)
    expect(isDateOnlyNote('5:00 p.m. CT')).toBe(false)
    expect(dateOnlyNoteRest('No time given. "The team grant application will open September 17, 2026, and close October 17, 2026."')).toBe('"The team grant application will open September 17, 2026, and close October 17, 2026."')
    expect(dateOnlyNoteRest('Closes 2026-10-17 (the funder gives no time of day). "quote"')).toBe('"quote"')
  })
})

describe('cycle status comes from the dates', () => {
  const at = (iso: string) => new Date(iso)
  it('open between opening and deadline (3M, stored as unknown)', () => {
    expect(deriveCycleStatus('2026-09-17', at('2026-10-17T23:59:00-04:00'), NOW)).toBe('open')
    expect(deriveCycleStatus(null, at('2026-09-30T17:00:00-05:00'), NOW)).toBe('open') // AMSTI
  })
  it('upcoming before opening (J.B. Hunt: December window)', () => {
    expect(deriveCycleStatus('2026-12-01', at('2026-12-31T23:59:00-06:00'), NOW)).toBe('upcoming')
    expect(deriveCycleStatus('2026-10-01', null, NOW)).toBe('upcoming') // Westfield Service League
  })
  it('closed after the deadline, whatever was stated', () => {
    expect(deriveCycleStatus('2026-04-01', at('2026-04-30T15:00:00-05:00'), NOW, 'open')).toBe('closed') // Union Pacific
  })
  it('the page\'s own word where there are no dates, and closed early wins', () => {
    expect(deriveCycleStatus(null, null, NOW, 'closed')).toBe('closed') // Con Edison: "the 2026 cycle is closed"
    expect(deriveCycleStatus(null, null, NOW, 'open')).toBe('open')
    expect(deriveCycleStatus(null, null, NOW, 'unknown')).toBe('unknown')
    expect(deriveCycleStatus(null, at('2026-11-01T23:59:00-04:00'), NOW, 'closed')).toBe('closed')
  })
})

describe('one list of secondhand grant hosts', () => {
  it('knows grantable.co, which published three listings\' info links', () => {
    for (const u of ['https://grantable.co/grants/westfield-service-league-grant-program', 'https://www.grantable.co/x']) {
      expect(isSecondhandGrantHost(u)).toBe(true)
      expect(prefilterSecondhand(u)).toBe(true)
      expect(autoRouteDenyReason(u)).toBeTruthy()
    }
    expect(isSecondhandGrantHost('https://www.thewestfieldserviceleague.org/grants')).toBe(false)
  })
  it('archives and PDFs', () => {
    expect(isArchiveUrl('https://web.archive.org/web/20260902000000/https://www.sony.com/en/SonyInfo/csr/')).toBe(true)
    expect(isThirdPartyGrantUrl('https://web.archive.org/web/20241013082117/https://www.pec.coop/community-grants/')).toBe(true)
    expect(isPdfUrl('https://www.td.com/content/dam/tdcom/us/en/pdf/td-charitable-foundation-faq.pdf')).toBe(true)
    expect(isPdfUrl('https://www.td.com/us/en/about-us/communities/ready-commitment')).toBe(false)
  })
  it('the info-page finder never picks a directory or an archive', () => {
    expect(scoreInfoResult({ url: 'https://grantable.co/grants/youth-development-grant-program', title: 'Sheltering Arms Youth Development Grant', description: 'grant' }, 'Sheltering Arms Foundation', 'Youth Development Grant Program')).toBe(0)
    expect(scoreInfoResult({ url: 'https://web.archive.org/web/2026/https://sheltering-arms.org/youth-development/', title: 'Youth Development', description: 'grant' }, 'Sheltering Arms Foundation', 'Youth Development Grant Program')).toBe(0)
    expect(scoreInfoResult({ url: 'https://sheltering-arms.org/youth-development/', title: 'Youth Development - Sheltering Arms Foundation', description: 'grants for youth development programs' }, 'Sheltering Arms Foundation', 'Youth Development Grant Program')).toBeGreaterThanOrEqual(4)
  })
})
