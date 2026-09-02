/**
 * One model call that is allowed to open pages, for every caller that needs it.
 *
 * pipeline/classify.ts had the only copy: an Anthropic call, a Playwright tool,
 * and a loop that hands the rendered text back as a tool result. The listings
 * verticals need exactly that, and the reason they need it is the same reason
 * classify has it. A page whose answer only exists behind a link is not
 * readable by whoever fetched the first page.
 *
 * The caller keeps what makes it different: its model, its prompt, and what it
 * does with the answer. This owns the loop, the tool, and the record of which
 * pages were actually opened, because that record is what the caller's evidence
 * check is later run against.
 */
import Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'
import { renderPage, type PageContent } from '../connectors/playwright-render.js'

export const PAGE_TOOL: Anthropic.Tool = {
  name: 'render_with_playwright',
  description:
    'Open a web page in a headless browser and return its visible text. Use it to read a page you have a link to ' +
    'but not the contents of, and to follow a link on that page when what you need is not on it yet.',
  input_schema: {
    type: 'object' as const,
    properties: { url: { type: 'string', description: 'The URL to open' } },
    required: ['url'],
  },
}

export interface PageReadResult {
  /** The model's final text, for the caller to parse. */
  text: string
  /** Every page opened, in order, with its text. The evidence for verification. */
  pages: Array<{ url: string; text: string; links: string[] }>
  /** Pages it asked for that would not load. */
  failed: string[]
}

/**
 * Ask, let it read, return the answer.
 *
 * Never throws. A model that is unreachable leaves the caller to fall back to
 * whatever it had without one, which for both listings connectors is the
 * deterministic reading they already do.
 */
export async function askWithPages(opts: {
  model: string
  system: string
  user: string
  maxTokens?: number
  /** Turns INCLUDING the final answer. classify allows 3; a deep read wants more. */
  maxTurns?: number
  /** False when the caller already holds better structured data than a page. */
  offerPageTool?: boolean
  /** Default target when the model calls the tool without a URL. */
  fallbackUrl?: string
  /**
   * Extra hosts to refuse, on top of the built-in list.
   *
   * A DENYLIST, not an allowlist. The first version of this took the hosts we
   * already knew about and refused everything else, which blocked the event's
   * own website: the whole point of the read is following a link to a site
   * nobody listed in advance. What is actually worth refusing is short and
   * knowable: encyclopaedias, social networks and sitemaps, which a read of one
   * event wasted six of its page loads on before running out of turns.
   */
  refuseHosts?: string[]
  /** Hard cap on pages opened, whatever the model asks for. */
  maxPages?: number
  logPrefix: string
}): Promise<PageReadResult | null> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.user }]
  const pages: Array<{ url: string; text: string; links: string[] }> = []
  const failed: string[] = []
  const tools = opts.offerPageTool === false ? [] : [PAGE_TOOL]

  for (let turn = 0; turn < (opts.maxTurns ?? 3); turn++) {
    let response: Anthropic.Message
    try {
      response = await anthropic().messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system,
        ...(tools.length > 0 ? { tools } : {}),
        messages,
      })
    } catch (err) {
      console.error(`${opts.logPrefix} API error:`, err)
      return null
    }

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (toolUses.length === 0) break
      messages.push({ role: 'assistant', content: response.content })

      // EVERY tool_use gets a tool_result, in one message, in order. The model
      // regularly asks for two pages at once, and answering only the first is
      // rejected outright: "tool_use ids were found without tool_result blocks
      // immediately after". A 400, not a bad answer, so it fails the whole read.
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        if (toolUse.name !== PAGE_TOOL.name) {
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Unknown tool.' })
          continue
        }

        const url = (toolUse.input as { url?: string }).url ?? opts.fallbackUrl

        if (url && !worthOpening(url, opts.refuseHosts)) {
          console.log(`${opts.logPrefix} refusing ${url}`)
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content:
              'That page cannot hold what you are looking for and will not be opened. ' +
              'Read the event or field site and the pages it links to, then answer.',
          })
          continue
        }
        if (pages.length >= (opts.maxPages ?? 8) && url && !pages.some((p) => p.url === url)) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'No more pages can be opened for this read. Answer now with what you have.',
          })
          continue
        }

        let rendered: PageContent | null = null
        if (url && !pages.some((p) => p.url === url)) {
          console.log(`${opts.logPrefix} opening ${url}`)
          rendered = await renderPage(url)
          if (rendered) pages.push({ url, text: rendered.text, links: rendered.links })
          else failed.push(url)
        } else if (url) {
          // Already read this turn. Hand back what we have rather than paying
          // for a second render of the same page.
          const held = pages.find((p) => p.url === url)
          rendered = held ? { text: held.text, links: held.links } : null
        }

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: rendered
            ? // THE LINKS MATTER AS MUCH AS THE TEXT. Without them the reader
              // is guessing paths: on one event site it guessed /registration
              // and /schedule, both 404, and never found the page carrying the
              // venue and the cost, which the home page linked to all along.
              `Page content:\n${rendered.text}` +
              (rendered.links.length > 0
                ? `\n\nLinks on this page:\n${rendered.links.join('\n')}`
                : '')
            : 'That page did not load or had no readable content.',
        })
      }

      messages.push({ role: 'user', content: results })
      continue
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) return null
    return { text: textBlock.text, pages, failed }
  }

  console.warn(`${opts.logPrefix} gave up after ${opts.maxTurns ?? 3} turns`)
  return null
}

/**
 * Hosts that never carry the details of one event or one practice field.
 *
 * Kept short and specific. This is not a content filter, it is a list of places
 * a read demonstrably wandered to and came back from empty handed.
 */
const NEVER_WORTH_OPENING = [
  'wikipedia.org',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'maps.google.com',
  'goo.gl',
]

/** Paths that are machine files rather than pages a person reads. */
const NEVER_WORTH_READING = /\/(sitemap[^/]*\.xml|robots\.txt|feed|rss)(\?|$)/i

export function worthOpening(url: string, alsoRefuse?: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(parsed.protocol)) return false
  if (NEVER_WORTH_READING.test(parsed.pathname + parsed.search)) return false

  const host = parsed.host.toLowerCase().replace(/^www\./, '')
  const refused = [...NEVER_WORTH_OPENING, ...(alsoRefuse ?? [])]
  return !refused.some((bad) => host === bad || host.endsWith(`.${bad}`))
}
