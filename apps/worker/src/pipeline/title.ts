/**
 * Naming a listing.
 *
 * The repo slug was being taken as the product's name, and a slug is not a name.
 * "scoutmachine/web" was published as "web". "4698RaiderRobotics/FRCTools" was published
 * as "FRCTools" while its own README opens with "FRC Tools for Fusion". "maneuver core",
 * "open scouting", "pre scouting app" and "scoutradioz" are all the same mistake: the
 * directory shows people the folder name the author happened to type on GitHub instead of
 * the name the author wrote at the top of their own README.
 *
 * So this reads the evidence in the order it deserves:
 *
 *   1. The first heading of the README. An author who writes "# GradleRIO" or
 *      "= FRC Tools for Fusion" has told us the name outright. Accepted when it
 *      corroborates the repo name, when it names the org AND carries the repo name with
 *      it, or when the repo name is a placeholder like "web" and so has nothing to
 *      corroborate with.
 *   2. The subject of the README's first prose sentence, the "X is a ..." opener. This is
 *      what recovers "Scoutradioz" from a repo called scoutradioz and a heading that is
 *      just a link to scoutradioz.com.
 *   3. The owner or org, when the repo name is a placeholder. "the-orange-alliance/mobile"
 *      is The Orange Alliance.
 *   4. The repo name, when it is already written as a name: any capital letter, or a
 *      single unbroken lowercase word like "pyfrc" which is the project's own branding.
 *   5. The page title, already cleaned of "| Site" chrome by normalizeTitle, when it
 *      corroborates the repo or owner.
 *
 * Everything above is deterministic and free. Only what is left over, a lowercase
 * hyphenated repo whose README repeats the slug back at us, is worth a model call, and
 * that call gets the handful of candidate strings gathered here rather than raw HTML.
 */
import Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'
import { decodeHtmlEntities } from './extract.js'

// #region string shapes

/** Lowercase alphanumerics only, so "AdvantageKit", "advantage-kit" and "Advantage Kit" agree. */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * True when a string carries no more information than a repo folder name does.
 * Filip's own description of the damage: all lowercase with no space, or with a hyphen or
 * underscore in it. A capital letter anywhere means a human typed it deliberately.
 */
export function looksLikeSlug(value: string): boolean {
  const t = value.trim()
  if (!t) return true
  if (/[A-Z]/.test(t)) return false
  return !/\s/.test(t)
}

/**
 * Repo names that identify a folder inside a project rather than the project. When the
 * repo is called one of these, the owner and the README are the only real evidence.
 */
const PLACEHOLDER_REPO_NAMES = new Set([
  'web', 'www', 'app', 'apps', 'site', 'website', 'webapp', 'web-app', 'homepage',
  'docs', 'doc', 'documentation', 'wiki', 'core', 'api', 'mobile', 'main', 'client',
  'server', 'frontend', 'front-end', 'backend', 'back-end', 'ui', 'index', 'public',
  'source', 'src', 'code', 'project', 'repo', 'dashboard', 'android', 'ios', 'desktop',
  'example', 'examples', 'sample', 'samples', 'demo', 'template', 'starter',
])

/** Headings that label a section of a README rather than name the project. */
const SECTION_HEADINGS = new Set([
  'about', 'readme', 'overview', 'introduction', 'intro', 'description', 'features',
  'installation', 'install', 'installing', 'getting started', 'get started', 'quick start',
  'quickstart', 'usage', 'how to use', 'license', 'licence', 'contributing', 'contributors',
  'documentation', 'docs', 'table of contents', 'contents', 'toc', 'badges', 'build status',
  'requirements', 'prerequisites', 'dependencies', 'welcome', 'home', 'index', 'changelog',
  'release notes', 'releases', 'screenshots', 'screenshot', 'images', 'credits',
  'acknowledgements', 'acknowledgments', 'roadmap', 'todo', 'notes', 'setup', 'configuration',
  'demo', 'examples', 'example', 'testing', 'tests', 'development', 'deployment', 'deploy',
  'faq', 'support', 'authors', 'disclaimer', 'warning', 'notice', 'status', 'structure',
  'app structure', 'project structure', 'getting help', 'troubleshooting', 'glossary',
])

/**
 * Sentence openers that sit in front of a name in a README heading. "About Scout Machine"
 * is not a product called "About Scout Machine".
 */
const HEADING_OPENERS: RegExp[] = [
  /^about\b[,:]?\s*(?:the\s+)?/i,
  /^welcome\b[,:]?\s*(?:to\s+)?(?:the\s+)?/i,
  /^introducing\b[,:]?\s*(?:the\s+)?/i,
  /^introduction\s+to\b\s*(?:the\s+)?/i,
  /^intro\s+to\b\s*(?:the\s+)?/i,
  /^presenting\b[,:]?\s*(?:the\s+)?/i,
  /^what\s+is\b\s*(?:the\s+)?/i,
  /^this\s+is\b\s*(?:the\s+)?/i,
]

/** Acronyms this directory is full of, so title casing does not produce "Frc Api". */
const ACRONYMS = new Set([
  'frc', 'ftc', 'fll', 'first', 'api', 'apis', 'ui', 'ux', 'cad', 'tba', 'toa', 'mcp',
  'jni', 'obs', 'vm', 'sdk', 'cli', 'gui', 'pwa', 'csv', 'pdf', 'ios', 'nt', 'ai', 'ml',
  'led', 'usb', 'can', 'io', 'os', 'hid', 'imu', 'pid', 'fms', 'ds', 'rio',
])

/** Words that stay lowercase inside a title unless they lead it. */
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'in', 'on', 'to', 'with', 'at', 'by', 'from', 'vs',
])

// #endregion

// #region README parsing

/** Everything left once images are gone: link text, HTML tags, emphasis marks, emoji. */
function finishCleaning(input: string): string {
  let t = input
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
  t = t.replace(/\[([^\]]*)\]\[[^\]]*\]/g, ' $1 ')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t.replace(/[*`~]+/g, '')
  // Underscores only as emphasis. Inside a word they are part of a slug, and a slug is
  // exactly what the caller needs to be able to recognise and reject.
  t = t.replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
  // AsciiDoc attribute references such as {project-name}
  t = t.replace(/\{[^}]*\}/g, ' ')
  t = decodeHtmlEntities(t)
  // Emoji anywhere, not just leading: "RoboVibe Community Hub! 🤖✨" is a heading, not a name.
  t = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  // A trailing "(EXPERIMENTAL)" or "[beta]" is a status marker, not part of the name.
  t = t.replace(/\s*[([{][^)\]}]{1,24}[)\]}]\s*$/, '').trim()
  t = t.replace(/[\s:;,.!?—–-]+$/u, '').trim()
  return t
}

/**
 * Strip a heading down to the words in it.
 *
 * Images are dropped, not read, because almost every image in a README heading is a build
 * badge and its alt text is "PyPI version" or "Gem Version". The one case where alt text is
 * the name is a heading that is nothing but an image, which is how AdvantageKit writes its
 * banner, so that case falls back to the alt text and only that case.
 */
export function cleanHeadingText(raw: string): string {
  const withoutImages = raw
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<img[^>]*>/gi, ' ')
  const text = finishCleaning(withoutImages)
  if (text) return text

  const fromAltText = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/<img[^>]*\balt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
  return finishCleaning(fromAltText)
}

/** Remove a leading "About " / "Welcome to " / "Introducing " and the like. */
export function stripHeadingOpener(text: string): string {
  let t = text.trim()
  for (const opener of HEADING_OPENERS) {
    if (opener.test(t)) {
      t = t.replace(opener, '').trim()
      break
    }
  }
  return t.replace(/\?+$/, '').trim()
}

/**
 * The name at the front of a heading that is "Name: what it does". Splits only on a colon,
 * a pipe, or a dash with spaces around it, so "FRC Tools for Fusion" and "Pre-scouting app"
 * are never cut. Returns null when the heading has no tagline on it.
 */
function taglineHead(heading: string): string | null {
  const m = heading.match(/^(.{2,}?)(?:\s*[:|]\s+|\s+[-–—]\s+)\S/)
  return m ? m[1].trim() : null
}

/** True when a cleaned heading is worth treating as a name. */
function headingIsUsable(text: string): boolean {
  if (text.length < 2 || text.length > 60) return false
  if (!/[a-z]/i.test(text)) return false
  if (text.split(/\s+/).length > 8) return false
  if (SECTION_HEADINGS.has(text.toLowerCase())) return false
  if (/^https?:\/\//i.test(text)) return false
  // An underscore inside a display name is a leftover from a folder name, never a name.
  if (text.includes('_')) return false
  // A heading that is itself a slug tells us nothing the repo name did not.
  if (looksLikeSlug(text)) return false
  return true
}

/** A row of "====" or "----" under a line, which is a heading in setext markdown and in rST. */
const UNDERLINE_RE = /^[=\-~^"'#*+]{3,}$/

const HTML_HEADING_RE = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi

/** Every H1/H2 in a README, in document order, across markdown, AsciiDoc, rST and raw HTML. */
function collectHeadings(readme: string): string[] {
  const body = readme.slice(0, 8000)
  const found: Array<{ offset: number; text: string }> = []

  for (const m of body.matchAll(HTML_HEADING_RE)) {
    found.push({ offset: m.index ?? 0, text: m[1] })
  }

  const lines = body.split('\n')
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    // Markdown "# Title" and AsciiDoc "= Title", levels 1 and 2 only.
    const atx = trimmed.match(/^(#{1,2}|={1,2})\s+(\S.*)$/)
    if (atx) {
      found.push({ offset, text: atx[2].replace(/\s+[#=]+\s*$/, '') })
    } else if (
      trimmed &&
      !UNDERLINE_RE.test(trimmed) &&
      i + 1 < lines.length &&
      UNDERLINE_RE.test(lines[i + 1].trim())
    ) {
      found.push({ offset, text: trimmed })
    }
    offset += line.length + 1
  }

  found.sort((a, b) => a.offset - b.offset)
  return found.map((f) => f.text)
}

/**
 * The README's first heading that actually names something. Looks past a leading "Table of
 * Contents" or badge row, but not far: three headings in, we are reading section labels.
 */
export function readmeHeading(readme: string | undefined): string | null {
  if (!readme) return null
  for (const raw of collectHeadings(readme).slice(0, 3)) {
    const cleaned = stripHeadingOpener(cleanHeadingText(raw))
    if (headingIsUsable(cleaned)) return cleaned
  }
  return null
}

/**
 * The subject of the README's first prose sentence, for the near-universal
 * "<Name> is a <thing> that ..." opener. The article after the verb is required: without
 * it, "Installation is done by running" reads as a project called Installation.
 */
export function readmeLeadName(readme: string | undefined): string | null {
  if (!readme) return null
  const lines = readme.slice(0, 8000).split('\n')
  let prose = 0
  for (const raw of lines) {
    if (prose >= 3) break
    const line = raw.trim()
    if (!line) continue
    if (/^[#=]{1,6}\s/.test(line)) continue
    if (UNDERLINE_RE.test(line)) continue
    if (/^[<!\[|>:*+-]/.test(line)) continue
    if (/^\d+[.)]\s/.test(line)) continue
    if (/^```/.test(line)) continue
    prose++
    const stripped = cleanHeadingText(line)
    const m = stripped.match(/^(.{2,60}?)\s+(?:is|are)\s+(?:an?|the|our|not|free|open|no longer)\b/i)
    if (!m) continue
    // Re-clean: the sentence put "EOCV-Sim (EasyOpenCV Simulator)" mid-line, so the
    // trailing-parenthesis rule had nothing to bite on the first time round.
    const name = finishCleaning(m[1])
    if (name && headingIsUsable(name)) return name
  }
  return null
}

// #endregion

// #region name shaping

/** Title case one word, leaving an existing capital and a known acronym alone. */
function caseWord(word: string, isFirst: boolean): string {
  if (!word) return word
  const lower = word.toLowerCase()
  if (ACRONYMS.has(lower)) return word.toUpperCase()
  if (!isFirst && SMALL_WORDS.has(lower)) return lower
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Turn a repo folder name into something displayable. A repo that already contains a
 * capital was written by hand, so only its separators are touched; an all-lowercase repo
 * gets title cased, because "Maneuver Core" reads as a name and "maneuver core" does not.
 */
export function prettifyRepoName(repo: string): string {
  const name = repo.trim()
  if (!name) return name
  // A single unbroken token is the project's own branding: pyfrc, doglog, path.jerryio.
  if (!/[-_\s]/.test(name)) return name

  const words = name.split(/[-_\s]+/).filter(Boolean)
  if (/[A-Z]/.test(name)) return words.join(' ')
  return words.map((w, i) => caseWord(w, i === 0)).join(' ')
}

/** Turn an owner or org handle into a product name: "the-orange-alliance" is The Orange Alliance. */
function prettifyOwner(owner: string): string {
  const spaced = owner.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return prettifyRepoName(spaced)
}

/** True when an owner handle is written as words rather than one run-together blob. */
function ownerIsWords(owner: string): boolean {
  return /[-_]/.test(owner) || /[a-z0-9][A-Z]/.test(owner)
}

/** True when a repo name is already a written name rather than a folder name. */
function repoIsWrittenName(repo: string): boolean {
  if (PLACEHOLDER_REPO_NAMES.has(repo.toLowerCase())) return false
  return /[A-Z]/.test(repo) || !/[-_\s]/.test(repo)
}

/**
 * Does `candidate` back up `anchor`? True on an exact match of the letters, or when one
 * runs on from the other: "FRC Tools for Fusion" begins with the repo name FRCTools, and
 * "Scout Machine" is exactly the org scoutmachine.
 */
function corroborates(candidate: string, anchor: string | undefined): boolean {
  if (!anchor) return false
  const a = key(candidate)
  const b = key(anchor)
  if (!a || !b) return false
  if (a === b) return true
  if (b.length >= 4 && a.startsWith(b)) return true
  if (a.length >= 4 && b.startsWith(a)) return true
  return false
}

/**
 * Of several spellings of the same name, the one a person would print. The repo says
 * "photonvision" and the page title says "PhotonVision"; they are the same name and only
 * one of them is how the project writes it.
 */
function bestCasing(chosen: string, alternatives: Array<string | undefined>): string {
  const k = key(chosen)
  let best = chosen
  for (const alt of alternatives) {
    if (!alt) continue
    if (key(alt) !== k) continue
    if (/[A-Z]/.test(alt) && !/[A-Z]/.test(best)) best = alt
  }
  return best
}

// #endregion

// #region resolution

export type TitleSource = 'readme-heading' | 'readme-lead' | 'owner' | 'repo' | 'page' | 'model'

export interface TitleCandidates {
  /** GitHub owner or org, e.g. "scoutmachine". */
  owner?: string
  /** GitHub repo name, e.g. "web". */
  repo?: string
  /** Raw README text, any of markdown, AsciiDoc, rST or HTML. */
  readme?: string
  /** Page title, already run through normalizeTitle. */
  pageTitle?: string
  /** GitHub repo description, model context only. */
  description?: string
}

/** The short strings the model is shown. Never raw HTML, never a whole README. */
export interface TitleEvidence {
  owner?: string
  repo?: string
  readmeHeading?: string
  readmeLead?: string
  pageTitle?: string
  description?: string
}

export interface TitleDecision {
  title: string
  source: TitleSource
  /** True when the deterministic pass stands behind this and no model call is needed. */
  confident: boolean
  reason: string
  evidence: TitleEvidence
}

/**
 * True when a title carries nothing the repo folder name did not, so re-resolving it can
 * only be an improvement. A real page title, which is different from the slug, is left alone.
 */
export function titleIsRepoDerived(title: string | null | undefined, repo: string | undefined): boolean {
  const t = (title ?? '').trim()
  if (!t) return true
  if (!repo) return false
  return key(t) === key(repo)
}

/**
 * Resolve a listing name from the candidates alone. Pure, free, and the only path most
 * listings ever take. `confident: false` means the caller may pay for a model opinion.
 */
export function resolveTitleDeterministic(c: TitleCandidates): TitleDecision {
  const owner = c.owner?.trim() || undefined
  const repo = c.repo?.trim() || undefined
  const heading = readmeHeading(c.readme) ?? undefined
  const lead = readmeLeadName(c.readme) ?? undefined
  const pageTitle = c.pageTitle?.trim() || undefined

  const evidence: TitleEvidence = {
    owner,
    repo,
    readmeHeading: heading,
    readmeLead: lead,
    pageTitle,
    description: c.description?.slice(0, 300) || undefined,
  }

  const alternatives = [heading, lead, pageTitle, repo, owner]
  const decide = (title: string, source: TitleSource, confident: boolean, reason: string): TitleDecision => ({
    title: bestCasing(title, alternatives),
    source,
    confident,
    reason,
    evidence,
  })

  const repoIsPlaceholder = Boolean(repo && PLACEHOLDER_REPO_NAMES.has(repo.toLowerCase()))

  /**
   * An org name found in a heading names THIS repo only when this repo is the org's main
   * thing. robotpy/cmp-talk-2024 is a conference talk whose README is headed "RobotPy:
   * past, present, and future", and renaming that listing to RobotPy would put a second
   * "RobotPy" in the directory pointing at a slide deck. So the org only counts when the
   * repo name is a placeholder, or when the heading carries the repo name along with it.
   */
  const orgNamesThisRepo = (candidate: string): boolean => {
    if (!corroborates(candidate, owner)) return false
    if (repoIsPlaceholder || !repo) return true
    return key(candidate).includes(key(repo))
  }

  // 1. The README heading, when it lines up with the repo or the org.
  if (heading) {
    // "SwervePy: Swerve library for Python" is a name followed by a description of it.
    // Take the name when it stands up on its own, and the whole heading otherwise.
    const rawHead = taglineHead(heading)
    const head = rawHead && headingIsUsable(rawHead) ? rawHead : undefined
    // "pyfrc - RobotPy simulation and testing support" is the repo name plus a sentence
    // about it. Neither half beats the repo name, so the heading is dropped entirely.
    const headIsJustTheSlug = Boolean(
      rawHead && !head && (key(rawHead) === key(repo ?? '') || key(rawHead) === key(owner ?? '')),
    )

    if (!headIsJustTheSlug) {
      for (const candidate of [head, heading]) {
        if (!candidate) continue
        if (corroborates(candidate, repo)) {
          return decide(candidate, 'readme-heading', true, `README heading "${heading}" matches the repo name`)
        }
        if (orgNamesThisRepo(candidate)) {
          return decide(candidate, 'readme-heading', true, `README heading "${heading}" matches the org "${owner}"`)
        }
        if (repoIsPlaceholder) {
          return decide(candidate, 'readme-heading', true, `repo is called "${repo}", so the README heading is the only name here`)
        }
      }
    }
  }

  // 2. "<Name> is a ..." at the top of the README, which is how a project spells itself.
  if (lead && (corroborates(lead, repo) || orgNamesThisRepo(lead))) {
    return decide(lead, 'readme-lead', true, `README opens "${lead} is ..."`)
  }

  // 3. The org, when the repo name is a placeholder and the org reads as words.
  if (repoIsPlaceholder && owner && ownerIsWords(owner)) {
    return decide(prettifyOwner(owner), 'owner', true, `repo is called "${repo}", so the org "${owner}" is the product`)
  }

  // 4. The repo name, when it was already written as a name.
  if (repo && repoIsWrittenName(repo)) {
    return decide(prettifyRepoName(repo), 'repo', true, 'repo name is already written as a name')
  }

  // 5. The page title, when it backs up the repo or the org.
  if (pageTitle && !looksLikeSlug(pageTitle) && (corroborates(pageTitle, repo) || corroborates(pageTitle, owner))) {
    return decide(pageTitle, 'page', true, `page title "${pageTitle}" matches the repo or org`)
  }

  // Nothing stands up on its own. Title casing the slug is still better than shipping it
  // in lowercase, and it is what ships if no model is reachable.
  const fallback = repo ? prettifyRepoName(repo) : (pageTitle ?? '')
  return decide(fallback, 'repo', false, 'no evidence beyond the repo slug')
}

// #endregion

// #region model fallback

const TITLE_MODEL = 'claude-haiku-4-5-20251001'

let _client: Anthropic | undefined
function getClient(): Anthropic {
  if (!_client) _client = anthropic()
  return _client
}

const TITLE_SYSTEM_PROMPT = `You name listings in a directory of FIRST robotics tools.

You are given the candidate strings already gathered for one project. Pick the name a person
would print on a card for it: what the project calls itself, not the GitHub folder name.

Rules:
- Prefer the name written in the project's own README heading or its first sentence.
- A GitHub org is often the product ("scoutmachine/web" is Scout Machine).
- Never invent a name. Every word you return must appear in the candidates given to you,
  though you may fix capitalisation and word spacing ("scoutmachine" -> "Scout Machine").
- Drop sentence openers: "About X" is X, "Welcome to X" is X.
- Drop marketing tails and taglines that are not part of the name.
- No trailing punctuation. 60 characters at most.

Return ONLY JSON: {"title": "..."}`

/** Every letter and digit the candidates contain, used to reject an invented name. */
function evidenceBlob(evidence: TitleEvidence): string {
  return Object.values(evidence).filter(Boolean).map((v) => key(String(v))).join('|')
}

/**
 * Ask the cheapest model in this repo to choose between the candidates. Rejects anything
 * whose letters are not already present in the candidates, so a hallucinated name is
 * dropped rather than published.
 */
export async function resolveTitleWithModel(evidence: TitleEvidence): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const lines = [
    evidence.owner ? `GitHub org or owner: ${evidence.owner}` : '',
    evidence.repo ? `GitHub repo name: ${evidence.repo}` : '',
    evidence.readmeHeading ? `README first heading: ${evidence.readmeHeading}` : '',
    evidence.readmeLead ? `README opening sentence subject: ${evidence.readmeLead}` : '',
    evidence.pageTitle ? `Page title: ${evidence.pageTitle}` : '',
    evidence.description ? `Repo description: ${evidence.description}` : '',
  ].filter(Boolean)

  try {
    const response = await getClient().messages.create({
      model: TITLE_MODEL,
      max_tokens: 100,
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lines.join('\n') }],
    })
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
    if (!text) return null

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const parsed = JSON.parse(fence ? fence[1].trim() : text.trim()) as { title?: unknown }
    const title = typeof parsed.title === 'string' ? cleanHeadingText(parsed.title) : ''
    if (!title || title.length > 60 || title.split(/\s+/).length > 8) return null
    if (!evidenceBlob(evidence).includes(key(title))) {
      console.warn(`[title] model returned "${title}", which is not in the candidates, so it is ignored`)
      return null
    }
    return title
  } catch (err) {
    console.error('[title] model error:', err)
    return null
  }
}

/**
 * Resolve a listing name, paying for a model opinion only where the deterministic pass
 * cannot decide. Always returns a usable title.
 */
export async function resolveListingTitle(
  c: TitleCandidates & { allowModel?: boolean },
): Promise<TitleDecision> {
  const decision = resolveTitleDeterministic(c)
  if (decision.confident || c.allowModel === false) return decision

  const picked = await resolveTitleWithModel(decision.evidence)
  if (!picked) return decision

  return {
    ...decision,
    title: picked,
    source: 'model',
    confident: true,
    reason: 'deterministic pass was undecided, model chose between the candidates',
  }
}

// #endregion
