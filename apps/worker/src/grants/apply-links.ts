/**
 * Find the "Apply" link on a funder's page.
 *
 * applicationUrl was filled on 6% of extracted grants, and the deadline on
 * 30%, because the extractor only read the page it was pointed at. The way in
 * is nearly always one click away - a Submittable portal, a Google Form, a
 * Foundant or Fluxx login, or a plain /apply page - and THAT page is where the
 * deadline, the eligibility and the application route are stated in full.
 * Following it is the same trick the event reader uses for "Register".
 *
 * Deterministic and pure: anchors are scored by their text, their path and
 * whether their host is a known grant-application platform, best first. The
 * caller fetches the winner(s) and hands the text to the extractor as
 * funder-page evidence, and quotes the URL so the presence check passes.
 */
import { parse } from 'node-html-parser'

/** Hosts that exist to take grant applications. A link to one is an apply link whatever it says. */
const APPLY_HOSTS = [
  'submittable.com',
  'forms.gle',
  'jotform.com',
  'smartsheet.com',
  'wufoo.com',
  'typeform.com',
  'surveymonkey.com',
  'fluxx.io',
  'cybergrants.com',
  'foundant.com',
  'grantinterface.com',
  'blackbaud.com',
  'formstack.com',
  'cognitoforms.com',
  'airtable.com',
  'smapply.io',
  'smartsimple.com',
  'wizehive.com',
  'zengine.com',
  'gograntx.com',
  'grantsconnect.com',
  'benevity.com',
  'versaic.com',
  'givingforce.com',
]

const APPLY_TEXT = /\b(apply|application|applications|submit (an )?application|register|nominate|request (funding|a grant)|grant (form|portal|application)|start (your|an) application|how to apply)\b/i
const APPLY_PATH = /\/(apply|application|applications|grant-?application|submit|nominate|portal)(\/|$|[.?#-])/i
const NOT_APPLY = /\b(unsubscribe|log ?out|donat(e|ion)|volunteer|job|career|press|news|privacy|terms)\b/i

export interface ApplyLink {
  url: string
  text: string
  score: number
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isApplyHost(url: string): boolean {
  const host = hostOf(url)
  return APPLY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** Google Forms live under docs.google.com/forms, which is otherwise a blocked host. */
function isGoogleForm(url: string): boolean {
  return /^https?:\/\/docs\.google\.com\/forms\//i.test(url)
}

/** Candidate apply links on a page, best first. Empty when none look like one. */
export function findApplyLinks(html: string, pageUrl: string): ApplyLink[] {
  const root = parse(html)
  const seen = new Set<string>()
  const out: ApplyLink[] = []

  for (const a of root.querySelectorAll('a[href]')) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    let abs: string
    try {
      abs = new URL(href, pageUrl).toString()
    } catch {
      continue
    }
    if (abs === pageUrl || seen.has(abs)) continue

    const text = a.textContent.replace(/\s+/g, ' ').trim()
    if (NOT_APPLY.test(text)) continue

    let score = 0
    if (isApplyHost(abs) || isGoogleForm(abs)) score += 3
    if (APPLY_TEXT.test(text)) score += 2
    if (APPLY_PATH.test(abs)) score += 1
    if (score === 0) continue

    seen.add(abs)
    out.push({ url: abs, text, score })
  }

  return out.sort((a, b) => b.score - a.score)
}
