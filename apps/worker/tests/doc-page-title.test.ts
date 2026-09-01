import { describe, it, expect } from 'vitest'
import { detectDocPageTitle } from '../src/jobs/enrich.js'

describe('detectDocPageTitle', () => {
  describe('titles that are docs sidebar labels', () => {
    const emojiTitles = [
      '📦 Installation',
      '🗒️ Built-In Logging',
      '🔭 How To: Replay Watch',
      '💼 Replay Case Studies',
      '📊 Supported Types',
      '🏠 Template Projects',
      '👋 What is AdvantageKit?',
      '🦋 Log Replay Comparison',
    ]
    for (const title of emojiTitles) {
      it(`catches ${title}`, () => {
        expect(detectDocPageTitle(title, 'https://docs.advantagekit.org/getting-started/installation')).toContain('emoji')
      })
    }

    it('catches an emoji title even at the site root', () => {
      expect(detectDocPageTitle('📦 Installation', 'https://example.org/')).not.toBeNull()
    })
  })

  describe('bare headings below the site root', () => {
    const headings = ['Installation', 'Getting Started', 'Download', 'Overview', 'FAQ', 'Changelog', 'Examples']
    for (const title of headings) {
      it(`catches "${title}"`, () => {
        expect(detectDocPageTitle(title, 'https://rr.brott.dev/docs/v1-0/installation')).toContain('bare heading')
      })
    }

    it('leaves a bare heading at the site root alone', () => {
      expect(detectDocPageTitle('Home', 'https://www.pairwisetool.com/')).toBeNull()
    })
  })

  describe('site chrome', () => {
    it('catches "Home | Synapse"', () => {
      expect(detectDocPageTitle('Home | Synapse', 'https://danpeled.gitbook.io/synapse')).toContain('site chrome')
    })

    it('catches "Auto Factory - Choreo Documentation"', () => {
      expect(detectDocPageTitle('Auto Factory - Choreo Documentation', 'https://choreo.autos/choreolib/auto-factory')).toContain('site chrome')
    })

    it('catches "Getting Started - Choreo Documentation"', () => {
      expect(detectDocPageTitle('Getting Started - Choreo Documentation', 'https://choreo.autos/choreolib/getting-started')).toContain('site chrome')
    })

    it('leaves "Home | 118 Everybot" alone because it is the site root', () => {
      expect(detectDocPageTitle('Home | 118 Everybot', 'https://www.118everybot.org/')).toBeNull()
    })
  })

  describe('real product names are left alone', () => {
    const keepers: Array<[string, string]> = [
      ['AdvantageKit', 'https://github.com/Mechanical-Advantage/AdvantageKit'],
      ['Talon FXS - Versatile Motor Controller', 'https://store.ctr-electronics.com/products/talon-fxs'],
      ['MK4i Swerve Module', 'https://www.swervedrivespecialties.com/collections/kits/products/mk4i-swerve-module'],
      ['Scoutradioz: FRC Scouting as a Service', 'https://scoutradioz.com/'],
      ['/r/FRC', 'https://www.reddit.com/r/FRC'],
      ['Practical Guide to Pneumatics eBook', 'https://library.automationdirect.com/practical-guide-to-pneumatics'],
      ['FRC API for Google Sheets', 'https://github.com/jaredhasenklein/FRC-API-for-Google-Sheets'],
      ['Standard Conversion Factors', 'https://yagsl.gitbook.io/yagsl/configuring-yagsl/standard-conversion-factors'],
    ]
    for (const [title, url] of keepers) {
      it(`keeps "${title}"`, () => {
        expect(detectDocPageTitle(title, url)).toBeNull()
      })
    }
  })

  it('ignores an empty title, which the quality gate already handles', () => {
    expect(detectDocPageTitle('   ', 'https://example.org/docs/page')).toBeNull()
  })
})
