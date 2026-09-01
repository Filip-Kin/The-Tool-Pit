import { describe, it, expect } from 'vitest'
import {
  cleanHeadingText,
  stripHeadingOpener,
  looksLikeSlug,
  readmeHeading,
  readmeLeadName,
  prettifyRepoName,
  titleIsRepoDerived,
  resolveTitleDeterministic,
} from '../src/pipeline/title.js'

// Real README fragments, pasted from the repos themselves rather than invented, because
// the whole failure mode here was reasoning about what a README "probably" looks like.
const README = {
  advantageKit: `# ![AdvantageKit](/docs/docs/img/banner.png)

[![Build](https://github.com/Mechanical-Advantage/AdvantageKit/actions/workflows/build.yml/badge.svg?branch=main&event=push)](https://github.com/Mechanical-Advantage/AdvantageKit/actions/workflows/build.yml)

AdvantageKit is a logging, telemetry, and replay framework developed by [Team 6328](https://littletonrobotics.org).
`,
  gradleRio: `![CI](https://github.com/wpilibsuite/GradleRIO/workflows/CI/badge.svg)

# GradleRIO

GradleRIO is a powerful Gradle Plugin that allows teams competing in the FIRST
robotics competition to produce and build their code.
`,
  photonVision: `# PhotonVision

[![Discord](https://img.shields.io/discord/725836368059826228)](https://discord.gg/wYxTwym)

PhotonVision is the free, fast, and easy-to-use computer vision solution for the *FIRST* Robotics Competition.
`,
  scoutMachine: `<p align="center">
  <img src="./public/ScoutMachineBanner.png" alt="Pindrop" />
</p>

[![CodeQL](https://github.com/scoutmachine/web/actions/workflows/codeql.yml/badge.svg)](https://github.com/scoutmachine/web/actions/workflows/codeql.yml)

## About Scout Machine

Scout Machine is an all-in-one tool for FRC scouting, match data, statistics, upcoming events.
`,
  frcTools: `= FRC Tools for Fusion
:experimental:
:imagesdir: docs

These are some tools to speed up some CAD operations that occur frequently in FRC robot design.
`,
  openScouting: `<img src="repo/images/icon.png" align="right" width="128" />

<div id="toc">
  <ul style="list-style: none; padding-left: 0px;">
    <summary>
      <h1>Open Scouting</h1>
    </summary>
  </ul>
</div>

**An open source application for easier scouting at FIRST Robotics competitions**
`,
  scoutradioz: `![Scoutradioz logo](https://scoutradioz.s3.amazonaws.com/prod/images/brand-logos/scoutradioz-black-border-md.png)
## [scoutradioz.com](https://scoutradioz.com)
Scoutradioz is a multi-year FRC scouting app developed by The Gearheads which runs on Amazon Web Services (AWS).
`,
  preScouting: `# Pre-scouting app

* [Installation Guide](https://github.com/salvobonsma/pre-scouting-app/wiki/Installation-Guide)

Pre-scouting app is a way to pre-scout for FRC events.
`,
  maneuverCore: `# maneuver-core

**A year-agnostic framework template for building FRC scouting apps**

\`maneuver-core\` is the foundational framework that powers multi-year FRC scouting applications.
`,
}

describe('regression guards: names that are already right', () => {
  // These three are the reason this file exists. Each is a listing Filip checked by hand
  // and found correct, so the resolver has to arrive at the same string it would have
  // taken from the repo slug, by whichever route.
  const keepers: Array<[string, Parameters<typeof resolveTitleDeterministic>[0]]> = [
    ['AdvantageKit', { owner: 'Mechanical-Advantage', repo: 'AdvantageKit', readme: README.advantageKit }],
    ['PhotonVision', { owner: 'PhotonVision', repo: 'photonvision', readme: README.photonVision }],
    ['GradleRIO', { owner: 'wpilibsuite', repo: 'GradleRIO', readme: README.gradleRio }],
  ]
  for (const [expected, input] of keepers) {
    it(`keeps "${expected}"`, () => {
      const decision = resolveTitleDeterministic(input)
      expect(decision.title).toBe(expected)
      expect(decision.confident).toBe(true)
    })
  }

  it('keeps AdvantageKit even with no README, on the repo name alone', () => {
    const decision = resolveTitleDeterministic({ owner: 'Mechanical-Advantage', repo: 'AdvantageKit' })
    expect(decision.title).toBe('AdvantageKit')
    expect(decision.confident).toBe(true)
  })

  it('keeps GradleRIO even with no README, on the repo name alone', () => {
    const decision = resolveTitleDeterministic({ owner: 'wpilibsuite', repo: 'GradleRIO' })
    expect(decision.title).toBe('GradleRIO')
    expect(decision.confident).toBe(true)
  })

  it('keeps PhotonVision when the page title is the only capitalised evidence', () => {
    // The live PhotonVision listing came from photonvision.org, not the repo, so the
    // lowercase repo slug must not be allowed to overwrite the page title's casing.
    const decision = resolveTitleDeterministic({
      owner: 'PhotonVision',
      repo: 'photonvision',
      pageTitle: 'PhotonVision',
    })
    expect(decision.title).toBe('PhotonVision')
  })

  it('leaves a lowercase one-word project name alone', () => {
    expect(resolveTitleDeterministic({ owner: 'robotpy', repo: 'pyfrc' }).title).toBe('pyfrc')
    expect(resolveTitleDeterministic({ owner: 'jonahsnider', repo: 'doglog' }).title).toBe('doglog')
  })

  it('leaves a name that is written with dots alone', () => {
    expect(resolveTitleDeterministic({ owner: 'Jerrylum', repo: 'path.jerryio' }).title).toBe('path.jerryio')
  })
})

describe('the listings Filip called out', () => {
  it('names scoutmachine/web from the README heading, not the repo', () => {
    const decision = resolveTitleDeterministic({ owner: 'scoutmachine', repo: 'web', readme: README.scoutMachine })
    expect(decision.title).toBe('Scout Machine')
    expect(decision.confident).toBe(true)
  })

  it('prefers "FRC Tools for Fusion" over the repo name FRCTools', () => {
    const decision = resolveTitleDeterministic({
      owner: '4698RaiderRobotics',
      repo: 'FRCTools',
      readme: README.frcTools,
    })
    expect(decision.title).toBe('FRC Tools for Fusion')
    expect(decision.confident).toBe(true)
  })

  it('reads an HTML <h1> buried in a README layout div', () => {
    const decision = resolveTitleDeterministic({
      owner: 'FRC-Team3484',
      repo: 'open-scouting',
      readme: README.openScouting,
    })
    expect(decision.title).toBe('Open Scouting')
    expect(decision.confident).toBe(true)
  })

  it('takes Scoutradioz casing from the lead sentence when the heading is a bare domain', () => {
    const decision = resolveTitleDeterministic({
      owner: 'FIRSTTeam102',
      repo: 'scoutradioz',
      readme: README.scoutradioz,
    })
    expect(decision.title).toBe('Scoutradioz')
    expect(decision.confident).toBe(true)
  })

  it('fixes "pre scouting app" to the README heading', () => {
    const decision = resolveTitleDeterministic({
      owner: 'salvobonsma',
      repo: 'pre-scouting-app',
      readme: README.preScouting,
    })
    expect(decision.title).toBe('Pre-scouting app')
    expect(decision.confident).toBe(true)
  })

  it('refuses to be confident about maneuver-core, whose README only repeats the slug', () => {
    const decision = resolveTitleDeterministic({
      owner: 'ShinyShips',
      repo: 'maneuver-core',
      readme: README.maneuverCore,
    })
    expect(decision.confident).toBe(false)
    // Still better than "maneuver core", and this is what ships if no model is reachable.
    expect(decision.title).toBe('Maneuver Core')
  })
})

describe('things a README heading carries that are not the name', () => {
  it('drops a build badge sitting next to the name', () => {
    // The alt text of a badge is "PyPI version", and reading it produced "tbapy PyPI version".
    const readme = '# tbapy [![PyPI version](https://badge.fury.io/py/tbapy.svg)](https://badge.fury.io/py/tbapy)\n\nbody\n'
    expect(readmeHeading(readme)).toBeNull()
    expect(resolveTitleDeterministic({ owner: 'frc1418', repo: 'tbapy', readme }).title).toBe('tbapy')
  })

  it('drops emoji from anywhere in the heading, not just the front', () => {
    expect(cleanHeadingText('RoboVibe Community Hub! 🤖✨')).toBe('RoboVibe Community Hub')
  })

  it('drops a trailing status marker', () => {
    expect(cleanHeadingText('tba_api_dart_dio_client (EXPERIMENTAL)')).toBe('tba_api_dart_dio_client')
  })

  it('keeps an underscored heading out, because that is a folder name', () => {
    const readme = '# tba_api_dart_dio_client (EXPERIMENTAL)\n\nbody\n'
    expect(readmeHeading(readme)).toBeNull()
    expect(resolveTitleDeterministic({ owner: 'jr1221', repo: 'tba_api_dart_dio_client', readme }).confident).toBe(false)
  })

  it('takes the name off the front of "Name: what it does"', () => {
    const readme = '# SwervePy: Swerve library for Python\n\nbody\n'
    expect(resolveTitleDeterministic({ owner: 'EWall25', repo: 'swervepy', readme }).title).toBe('SwervePy')
  })

  it('takes the name off the front of "Name - what it does"', () => {
    const readme = '# OVL - Object Vision Library\n\nbody\n'
    expect(resolveTitleDeterministic({ owner: 'SerpentBit', repo: 'ovl', readme }).title).toBe('OVL')
  })

  it('ignores a heading that is only the repo name plus a sentence about it', () => {
    // "pyfrc - RobotPy simulation and testing support" was being published whole.
    const readme = '# pyfrc - RobotPy simulation and testing support\n\nbody\n'
    const decision = resolveTitleDeterministic({ owner: 'robotpy', repo: 'pyfrc', readme })
    expect(decision.title).toBe('pyfrc')
    expect(decision.source).toBe('repo')
  })

  it('cleans a parenthetical out of the README lead sentence', () => {
    const readme = 'EOCV-Sim (EasyOpenCV Simulator) is a desktop simulator for EasyOpenCV pipelines.\n'
    expect(readmeLeadName(readme)).toBe('EOCV-Sim')
  })
})

describe('an org name in a heading is not always this repo', () => {
  it('refuses to rename a conference talk to the org it belongs to', () => {
    // robotpy/cmp-talk-2024 is a slide deck, and its README is headed "RobotPy: past,
    // present, and future". Publishing it as "RobotPy" puts a second RobotPy in the
    // directory pointing at a talk.
    const readme = '# RobotPy: past, present, and future\n\nbody\n'
    const decision = resolveTitleDeterministic({ owner: 'robotpy', repo: 'cmp-talk-2024', readme })
    expect(decision.confident).toBe(false)
    expect(decision.title).not.toBe('RobotPy')
  })

  it('accepts the org when the heading carries the repo name too', () => {
    const readme = '# RobotPy NetworkTables Project\n\nbody\n'
    const decision = resolveTitleDeterministic({ owner: 'robotpy', repo: 'pynetworktables', readme })
    expect(decision.title).toBe('RobotPy NetworkTables Project')
    expect(decision.confident).toBe(true)
  })

  it('accepts the org when the repo name is a placeholder', () => {
    const readme = '# FIRSTwiki: wiki site\n\nbody\n'
    const decision = resolveTitleDeterministic({ owner: 'firstwiki', repo: 'wiki', readme })
    expect(decision.title).toBe('FIRSTwiki')
    expect(decision.confident).toBe(true)
  })
})

describe('org or owner as the product name', () => {
  it('uses a separable owner when the repo name says nothing', () => {
    const decision = resolveTitleDeterministic({ owner: 'the-orange-alliance', repo: 'mobile' })
    expect(decision.title).toBe('The Orange Alliance')
    expect(decision.confident).toBe(true)
  })

  it('will not guess at a single-word owner with a generic repo', () => {
    const decision = resolveTitleDeterministic({ owner: 'scoutmachine', repo: 'web' })
    expect(decision.confident).toBe(false)
  })
})

describe('stripHeadingOpener', () => {
  const cases: Array<[string, string]> = [
    ['About Scout Machine', 'Scout Machine'],
    ['About the Elastic Dashboard', 'Elastic Dashboard'],
    ['Welcome to Choreo', 'Choreo'],
    ['Welcome to the PathPlanner docs', 'PathPlanner docs'],
    ['Introducing Statbotics', 'Statbotics'],
    ['Introduction to YAGSL', 'YAGSL'],
    ['What is AdvantageKit', 'AdvantageKit'],
    ['Presenting Nevermore', 'Nevermore'],
    ['AdvantageKit', 'AdvantageKit'],
    ['About', ''],
  ]
  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      expect(stripHeadingOpener(input)).toBe(expected)
    })
  }
})

describe('cleanHeadingText', () => {
  it('takes the alt text out of an image-only heading', () => {
    expect(cleanHeadingText('![AdvantageKit](/docs/docs/img/banner.png)')).toBe('AdvantageKit')
  })
  it('takes the text out of a linked heading', () => {
    expect(cleanHeadingText('[scoutradioz.com](https://scoutradioz.com)')).toBe('scoutradioz.com')
  })
  it('drops HTML tags and keeps the words', () => {
    expect(cleanHeadingText('<h1>Open Scouting</h1>')).toBe('Open Scouting')
  })
  it('drops emphasis marks and a trailing question mark', () => {
    expect(cleanHeadingText('**What is AdvantageKit?**')).toBe('What is AdvantageKit')
  })
  it('drops a leading emoji', () => {
    expect(cleanHeadingText('📦 Installation')).toBe('Installation')
  })
  it('decodes HTML entities', () => {
    expect(cleanHeadingText('Robot &amp; Field')).toBe('Robot & Field')
  })
})

describe('looksLikeSlug', () => {
  const slugs = ['maneuver-core', 'open_scouting', 'scoutradioz.com', 'web', 'pre-scouting-app']
  for (const s of slugs) {
    it(`"${s}" is a slug`, () => expect(looksLikeSlug(s)).toBe(true))
  }
  const names = ['Scout Machine', 'AdvantageKit', 'FRC Tools for Fusion', 'Pre-scouting app', 'path.JerryIO']
  for (const s of names) {
    it(`"${s}" is not a slug`, () => expect(looksLikeSlug(s)).toBe(false))
  }
})

describe('readmeHeading', () => {
  it('finds a markdown ATX heading', () => {
    expect(readmeHeading('# PhotonVision\n\nbody')).toBe('PhotonVision')
  })
  it('finds an AsciiDoc heading', () => {
    expect(readmeHeading('= FRC Tools for Fusion\n:imagesdir: docs\n')).toBe('FRC Tools for Fusion')
  })
  it('finds a setext / reStructuredText underlined heading', () => {
    expect(readmeHeading('Elastic Dashboard\n=================\n\nbody')).toBe('Elastic Dashboard')
  })
  it('finds an HTML heading', () => {
    expect(readmeHeading(README.openScouting)).toBe('Open Scouting')
  })
  it('skips a heading that is only a docs section label', () => {
    expect(readmeHeading('# Table of Contents\n\n## Elastic Dashboard\n')).toBe('Elastic Dashboard')
  })
  it('skips a heading that is itself a slug', () => {
    expect(readmeHeading(README.maneuverCore)).toBeNull()
  })
  it('strips the opener from a README heading', () => {
    expect(readmeHeading(README.scoutMachine)).toBe('Scout Machine')
  })
  it('returns null for a README with no usable heading', () => {
    expect(readmeHeading('just some prose about a thing\n')).toBeNull()
  })
})

describe('readmeLeadName', () => {
  it('reads the subject of the first prose sentence', () => {
    expect(readmeLeadName(README.scoutradioz)).toBe('Scoutradioz')
    expect(readmeLeadName(README.advantageKit)).toBe('AdvantageKit')
    expect(readmeLeadName(README.photonVision)).toBe('PhotonVision')
  })
  it('ignores badges, images and headings on the way there', () => {
    expect(readmeLeadName(README.scoutMachine)).toBe('Scout Machine')
  })
  it('returns null when no sentence names the project', () => {
    expect(readmeLeadName('Install this by running the setup script.\n')).toBeNull()
  })
})

describe('prettifyRepoName', () => {
  const cases: Array<[string, string]> = [
    ['AdvantageKit', 'AdvantageKit'],
    ['GradleRIO', 'GradleRIO'],
    ['FRC-API-for-Google-Sheets', 'FRC API for Google Sheets'],
    ['maneuver-core', 'Maneuver Core'],
    ['frc-tips', 'FRC Tips'],
    ['tba-api-node', 'TBA API Node'],
    ['pyfrc', 'pyfrc'],
    ['path.jerryio', 'path.jerryio'],
  ]
  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      expect(prettifyRepoName(input)).toBe(expected)
    })
  }
})

describe('titleIsRepoDerived', () => {
  it('spots a title that is only the repo slug reworded', () => {
    expect(titleIsRepoDerived('maneuver core', 'maneuver-core')).toBe(true)
    expect(titleIsRepoDerived('web', 'web')).toBe(true)
    expect(titleIsRepoDerived('PhotonVision', 'photonvision')).toBe(true)
  })
  it('leaves a real page title alone', () => {
    expect(titleIsRepoDerived('Scoutradioz: FRC Scouting as a Service', 'scoutradioz')).toBe(false)
    expect(titleIsRepoDerived('Elastic', 'elastic_dashboard')).toBe(false)
  })
  it('treats a missing title as repo-derived, since there is nothing to lose', () => {
    expect(titleIsRepoDerived(undefined, 'web')).toBe(true)
  })
})
