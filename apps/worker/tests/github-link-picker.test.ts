import { describe, it, expect } from 'vitest'
import { pickGitHubUrl, isRelatedRepo, isRepoRootUrl } from '../src/pipeline/extract.js'

/**
 * Markup shapes below follow the real themes, trimmed to the parts that decide
 * the answer: where the GitHub anchor sits and how much text surrounds it.
 */

/** Docusaurus 3, the docs.advantagekit.org shape. Repo link lives in the navbar. */
const DOCUSAURUS = `<!doctype html><html><head><title>Installation | AdvantageKit</title></head>
<body>
  <nav aria-label="Main" class="navbar navbar--fixed-top">
    <div class="navbar__inner">
      <a class="navbar__brand" href="/"><b class="navbar__title">AdvantageKit</b></a>
      <div class="navbar__items navbar__items--right">
        <a href="https://github.com/Mechanical-Advantage/AdvantageKit" target="_blank"
           rel="noopener noreferrer" class="navbar__item navbar__link header-github-link"></a>
      </div>
    </div>
  </nav>
  <div class="main-wrapper">
    <aside class="theme-doc-sidebar-container">
      <nav class="menu thin-scrollbar menu_SIkG"><ul class="theme-doc-sidebar-menu">
        <li><a class="menu__link" href="/getting-started/installation">Installation</a></li>
      </ul></nav>
    </aside>
    <main class="docMainContainer_TBSr">
      <article>
        <div class="theme-doc-markdown markdown">
          <h1>Installation</h1>
          <p>AdvantageKit is installed as a vendordep. Download the latest release and add the
          JSON file to your project's vendordeps folder, then rebuild. The vendordep pulls in the
          logging framework and the replay runtime, and enables the annotation processor that
          generates the IO layer implementations used throughout the templates.</p>
          <h2>Gradle changes</h2>
          <p>Add the AdvantageKit plugin block to build.gradle and set the deploy configuration
          so that logs are written to the USB stick when one is mounted on the roboRIO.</p>
        </div>
      </article>
    </main>
  </div>
  <footer class="footer footer--dark"><div class="footer__copyright">Copyright Team 6328.</div></footer>
</body></html>`

/** sphinx_rtd_theme, the shape that gave a VScouter page 5075 stars. */
const READ_THE_DOCS = `<!doctype html><html><head><title>VScouter 0.1 documentation</title></head>
<body class="wy-body-for-nav">
  <nav data-toggle="wy-nav-shift" class="wy-nav-side">
    <div class="wy-side-scroll"><div class="wy-side-nav-search"><a href="#">VScouter</a></div></div>
  </nav>
  <section class="wy-nav-content-wrap">
    <div class="wy-nav-content"><div class="rst-content"><div role="main" class="document">
      <h1>VScouter</h1>
      <p>VScouter is an offline-first scouting application for FRC teams. Matches are recorded on
      a tablet with no network connection and synchronised later over a QR code chain, so a full
      scouting team can work from the stands without depending on venue wifi at any point.</p>
      <p>The data model keeps one row per robot per match, which makes the export directly
      loadable into a spreadsheet without reshaping.</p>
    </div></div></div>
    <footer>
      <hr/>
      <p>Built with <a href="https://www.sphinx-doc.org/">Sphinx</a> using a
      <a href="https://github.com/readthedocs/sphinx_rtd_theme">theme</a>
      provided by <a href="https://readthedocs.org">Read the Docs</a>.</p>
    </footer>
  </section>
</body></html>`

/** GitBook, the danpeled.gitbook.io/synapse shape. Repo link in the page header. */
const GITBOOK = `<!doctype html><html><head><title>Home | Synapse</title></head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/">Synapse</a>
      <a href="https://github.com/DanPeled/Synapse" class="header-link">GitHub</a>
    </div>
  </header>
  <div class="page-wrapper">
    <main>
      <h1>Welcome</h1>
      <p>Synapse is a dynamic vision processing pipeline for FRC robots. It runs on a coprocessor
      and streams pose estimates over NetworkTables, with a browser dashboard for tuning pipelines
      live while the robot is enabled on the practice field.</p>
      <p>Pipelines are described declaratively, so a change can be pushed without recompiling.</p>
    </main>
  </div>
  <footer><p>Powered by GitBook</p></footer>
</body></html>`

/** A real project home page: the repo link is in the page's own content. */
const PROJECT_HOME = `<!doctype html><html><head><title>PhotonVision</title></head>
<body>
  <nav class="navbar"><a href="/">PhotonVision</a><a href="/docs">Docs</a></nav>
  <main>
    <h1>PhotonVision</h1>
    <p>PhotonVision is the free, fast and easy-to-use vision processing solution for FRC teams.
    It runs on a coprocessor and handles AprilTag detection, coloured shape detection and
    multi-camera pose estimation, publishing results straight onto NetworkTables.</p>
    <p>The source is on <a href="https://github.com/PhotonVision/photonvision">GitHub</a> and
    releases are published for the Raspberry Pi, Orange Pi and Limelight hardware.</p>
  </main>
</body></html>`

describe('pickGitHubUrl', () => {
  describe('documentation themes put the project repo in their chrome', () => {
    it('takes no repo from a Docusaurus navbar', () => {
      const pick = pickGitHubUrl(DOCUSAURUS, 'https://docs.advantagekit.org/getting-started/installation', 'Installation')
      expect(pick.githubUrl).toBeUndefined()
    })

    it('still reports the Docusaurus navbar repo as a chrome hint', () => {
      const pick = pickGitHubUrl(DOCUSAURUS, 'https://docs.advantagekit.org/getting-started/installation', 'Installation')
      expect(pick.referencedGitHubUrl).toBe('https://github.com/Mechanical-Advantage/AdvantageKit')
    })

    it('takes no repo from a GitBook page header', () => {
      const pick = pickGitHubUrl(GITBOOK, 'https://danpeled.gitbook.io/synapse', 'Home | Synapse')
      expect(pick.githubUrl).toBeUndefined()
      expect(pick.referencedGitHubUrl).toBe('https://github.com/DanPeled/Synapse')
    })

    it('never takes the Read the Docs theme credit from the footer', () => {
      const pick = pickGitHubUrl(READ_THE_DOCS, 'https://vscouter.netlify.app/docs', 'VScouter 0.1 documentation')
      expect(pick.githubUrl).toBeUndefined()
    })

    it('reports the docs theme only as a reference, and it relates to nothing', () => {
      const pick = pickGitHubUrl(READ_THE_DOCS, 'https://vscouter.netlify.app/docs', 'VScouter 0.1 documentation')
      // Reported so the value is not silently lost, but it is not related, so the
      // dedup gate in enrich.ts will find no published tool owning it.
      expect(pick.referencedGitHubUrl).toBe('https://github.com/readthedocs/sphinx_rtd_theme')
      expect(isRelatedRepo(pick.referencedGitHubUrl!, 'https://vscouter.netlify.app/docs', 'VScouter 0.1 documentation')).toBe(false)
    })
  })

  describe('a repo in the page content is the page’s own', () => {
    it('takes the repo linked from the body of a project home page', () => {
      const pick = pickGitHubUrl(PROJECT_HOME, 'https://photonvision.org', 'PhotonVision')
      expect(pick.githubUrl).toBe('https://github.com/PhotonVision/photonvision')
      expect(pick.referencedGitHubUrl).toBeUndefined()
    })

    it('prefers the related repo over an unrelated one mentioned alongside it', () => {
      const html = PROJECT_HOME.replace(
        '<p>The source is on',
        '<p>See also <a href="https://github.com/wpilibsuite/allwpilib">WPILib</a>.</p><p>The source is on',
      )
      const pick = pickGitHubUrl(html, 'https://photonvision.org', 'PhotonVision')
      expect(pick.githubUrl).toBe('https://github.com/PhotonVision/photonvision')
    })
  })

  describe('pages with nothing to pick', () => {
    it('returns nothing when the page links no repo at all', () => {
      const pick = pickGitHubUrl('<html><body><main><p>No links here at all on this page.</p></main></body></html>', 'https://example.org/', 'Example')
      expect(pick).toEqual({})
    })

    it('ignores a github.com link that is not a repo', () => {
      const html = '<html><body><main><p>Find us on <a href="https://github.com/orgs/frc">GitHub</a> today.</p></main></body></html>'
      const pick = pickGitHubUrl(html, 'https://example.org/', 'Example')
      expect(pick.githubUrl).toBeUndefined()
    })
  })
})

describe('isRelatedRepo', () => {
  const related: Array<[string, string, string]> = [
    ['https://github.com/Mechanical-Advantage/AdvantageKit', 'https://docs.advantagekit.org/whats-new', 'What’s New in 2026?'],
    ['https://github.com/SleipnirGroup/Choreo', 'https://choreo.autos/usage/code-generation', 'Code Generation'],
    ['https://github.com/PhotonVision/photonvision', 'https://docs.photonvision.org/en/latest/', 'Quick Install'],
    ['https://github.com/jaredhasenklein/FRC-API-for-Google-Sheets', 'https://example.org/x', 'FRC API for Google Sheets'],
  ]
  for (const [repo, url, title] of related) {
    it(`relates ${repo} to ${url}`, () => {
      expect(isRelatedRepo(repo, url, title)).toBe(true)
    })
  }

  const unrelated: Array<[string, string, string]> = [
    ['https://github.com/readthedocs/sphinx_rtd_theme', 'https://vscouter.netlify.app/', 'VScouter'],
    ['https://github.com/acmerobotics/ftc-dashboard', 'https://rr.brott.dev/docs/v1-0/installation', 'Installation'],
    ['https://github.com/facebook/docusaurus', 'https://docs.advantagekit.org/', 'Welcome'],
  ]
  for (const [repo, url, title] of unrelated) {
    it(`does not relate ${repo} to ${url}`, () => {
      expect(isRelatedRepo(repo, url, title)).toBe(false)
    })
  }
})

/**
 * The shape that actually did the damage. A doc page links the project repo
 * from its own body, not just its navbar: /releases on the install page, a
 * #L90 line anchor on a template page. Chrome stripping alone does not save
 * you here, which is why the root-versus-deep rule exists.
 */
const DOCS_PAGE_WITH_DEEP_BODY_LINKS = `<!doctype html><html><head><title>Installation</title></head>
<body>
  <nav class="navbar"><a href="/">AdvantageKit</a></nav>
  <main><article><div class="markdown">
    <h1>Installation</h1>
    <p>Download the latest release from
    <a href="https://github.com/Mechanical-Advantage/AdvantageKit/releases">the releases page</a>
    and copy the vendordep JSON into your project. The annotation processor runs at build time and
    generates the IO implementations, so a clean build is required after the first install.</p>
    <p>An example is at
    <a href="https://github.com/Mechanical-Advantage/AdvantageKit/blob/main/example/Robot.java#L90">Robot.java</a>.</p>
  </div></article></main>
</body></html>`

describe('links into a repo are references, not identity', () => {
  const url = 'https://docs.advantagekit.org/getting-started/installation'

  it('takes no repo when the body only links /releases and a file line', () => {
    expect(pickGitHubUrl(DOCS_PAGE_WITH_DEEP_BODY_LINKS, url, 'Installation').githubUrl).toBeUndefined()
  })

  it('still reports the repo so the dedup gate can use it', () => {
    const pick = pickGitHubUrl(DOCS_PAGE_WITH_DEEP_BODY_LINKS, url, 'Installation')
    expect(pick.referencedGitHubUrl).toContain('Mechanical-Advantage/AdvantageKit')
  })

  it('accepts the same repo when the page is the site front page and links the root', () => {
    const front = DOCS_PAGE_WITH_DEEP_BODY_LINKS.replace(
      '<nav class="navbar"><a href="/">AdvantageKit</a></nav>',
      '<nav class="navbar"><a href="https://github.com/Mechanical-Advantage/AdvantageKit">GitHub</a></nav>',
    )
    expect(pickGitHubUrl(front, 'https://docs.advantagekit.org/', 'Welcome').githubUrl)
      .toBe('https://github.com/Mechanical-Advantage/AdvantageKit')
  })

  it('refuses that same navbar root link on a page within the site', () => {
    const sub = DOCS_PAGE_WITH_DEEP_BODY_LINKS.replace(
      '<nav class="navbar"><a href="/">AdvantageKit</a></nav>',
      '<nav class="navbar"><a href="https://github.com/Mechanical-Advantage/AdvantageKit">GitHub</a></nav>',
    )
    expect(pickGitHubUrl(sub, url, 'Installation').githubUrl).toBeUndefined()
  })
})

describe('isRepoRootUrl', () => {
  const roots = [
    'https://github.com/PhotonVision/photonvision',
    'https://github.com/PhotonVision/photonvision/',
    'https://github.com/SleipnirGroup/Choreo',
  ]
  for (const u of roots) {
    it(`treats ${u} as a repo root`, () => expect(isRepoRootUrl(u)).toBe(true))
  }

  const deep = [
    'https://github.com/PhotonVision/photonvision/releases/latest',
    'https://github.com/Mechanical-Advantage/AdvantageKit/issues',
    'https://github.com/Yet-Another-Software-Suite/YAGSL/tree/main/examples',
    'https://github.com/Mechanical-Advantage/AdvantageKit/blob/main/example/Robot.java#L90',
    'https://github.com/DanPeled/Synapse/blob/docs/docs/README.md',
  ]
  for (const u of deep) {
    it(`treats ${u} as a link into the repo`, () => expect(isRepoRootUrl(u)).toBe(false))
  }
})
