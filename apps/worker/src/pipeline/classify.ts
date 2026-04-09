/**
 * AI-powered classification of tool candidates.
 * Uses Claude to infer program(s), audience, tool type, summary, and flags.
 *
 * Flow:
 *   1. Pass full page text (from static HTML extraction) + meta fields to Claude.
 *   2. If the page text is thin (SPA shell), Claude may call render_with_playwright
 *      to get the JS-rendered content and try again.
 *   3. Claude returns a JSON classification object.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { CandidateClassification, RawCandidateMetadata } from '@the-tool-pit/db'
import { renderPage } from '../connectors/playwright-render.js'
import { parseGitHubUrl } from '../connectors/github.js'
import { isYouTubeUrl } from './extract.js'

const VALID_TOOL_TYPES = new Set([
  'web_app', 'desktop_app', 'mobile_app', 'calculator', 'spreadsheet',
  'github_project', 'browser_extension', 'api', 'resource', 'vendor_website', 'other',
])
const VALID_PROGRAMS = new Set(['frc', 'ftc', 'fll'])
const VALID_AUDIENCE_ROLES = new Set([
  'student', 'mentor', 'volunteer', 'parent_newcomer', 'organizer_staff',
])
const VALID_AUDIENCE_FUNCTIONS = new Set([
  'programmer', 'scouter', 'strategist', 'cad', 'mechanical', 'electrical',
  'drive_team', 'awards', 'outreach', 'team_management', 'event_ops',
  'field_technical', 'inspection', 'judging',
])

/**
 * Validate and sanitize the raw parsed classification output.
 * Filters unknown enum values, clamps numeric fields. Pure function — no I/O.
 */
export function validateClassificationOutput(
  parsed: Partial<CandidateClassification>,
): Partial<CandidateClassification> {
  const out = { ...parsed }

  if (out.toolType && !VALID_TOOL_TYPES.has(out.toolType)) {
    console.warn(`[classify] unknown toolType "${out.toolType}" — falling back to "other"`)
    out.toolType = 'other'
  }
  if (Array.isArray(out.programs)) {
    const before = out.programs
    out.programs = out.programs.filter((p) => VALID_PROGRAMS.has(p))
    if (out.programs.length < before.length) {
      console.warn(`[classify] filtered invalid programs: ${before.filter((p) => !VALID_PROGRAMS.has(p)).join(', ')}`)
    }
  }
  if (Array.isArray(out.audienceRoles)) {
    out.audienceRoles = out.audienceRoles.filter((r) => VALID_AUDIENCE_ROLES.has(r))
  }
  if (Array.isArray(out.audienceFunctions)) {
    out.audienceFunctions = out.audienceFunctions.filter((f) => VALID_AUDIENCE_FUNCTIONS.has(f))
  }
  if (out.isTeamCode) {
    const t = out.teamNumber
    if (t !== null && t !== undefined && (!Number.isInteger(t) || t < 1 || t > 99999)) {
      out.teamNumber = null
    }
    const y = out.seasonYear
    const now = new Date().getFullYear()
    if (y !== null && y !== undefined && (!Number.isInteger(y) || y < 2000 || y > now + 1)) {
      out.seasonYear = null
    }
  }
  return out
}

let _client: Anthropic | undefined

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

const SYSTEM_PROMPT = `You are classifying tools for a FIRST Robotics directory (FRC, FTC, FLL).

You will receive the URL, any available meta fields, and the full visible text content of the page.
Use all of this to understand what the tool does.

If the page content is clearly a JavaScript SPA shell (essentially empty body, framework boilerplate only,
no real text about the tool), call the render_with_playwright tool to get the fully rendered content.
Only call the tool once — if the rendered content still seems empty, classify based on what you have.

Once you have enough information, output a JSON object with these fields:
- toolType: one of "web_app", "desktop_app", "mobile_app", "calculator", "spreadsheet", "github_project", "browser_extension", "api", "resource", "vendor_website", "other"
  IMPORTANT type distinctions:
  - "vendor_website": use when isVendor=true AND the site is a product page, store, or marketing/documentation site for hardware or software sold commercially to robotics teams (e.g. motor controllers, sensors, cameras, game-piece suppliers). These are sites users browse or purchase from, not interactive applications.
  - "web_app": ONLY for interactive web applications where users perform tasks in-browser (scouting dashboards, pit display apps, field timers, match schedule tools). Do NOT use for product pages or vendor sites, even if they have some interactive elements like a product configurator.
  - If isVendor=true and the site primarily lists, markets, or sells products → use "vendor_website", not "web_app".
- programs: array of "frc", "ftc", "fll" (can be multiple, or empty if unknown)
- audienceRoles: array from ["student", "mentor", "volunteer", "parent_newcomer", "organizer_staff"]
- audienceFunctions: array from ["programmer", "scouter", "strategist", "cad", "mechanical", "electrical", "drive_team", "awards", "outreach", "team_management", "event_ops", "field_technical", "inspection", "judging"]
- isRookieFriendly: boolean — true if clearly targeted at new/beginner teams
- isOfficial: boolean — true ONLY if clearly from FIRST organization itself (firstinspires.org, etc.)
- isVendor: boolean — true if from a commercial vendor selling to robotics teams
- summary: a 1-2 sentence description of what the tool does and who it's for
- isTeamCode: boolean — true if this is a specific team's own robot code repo (not a general-purpose
  library or reusable tool). Signals: repo named "2024-robot", "frc254", "Team1114-Crescendo",
  GitHub org follows "frcNNNN" / "ftcNNNN" pattern, description says "Team NNN's YYYY robot code".
  False for: libraries (WPILib, AdvantageKit), scouting apps, vendor tools, any tool used by many teams.
- teamNumber: integer or null — FIRST team number (1–99999). Extract from repo name, org name,
  description, or README title. GitHub orgs often follow "frc254" or "ftc12345" pattern.
- seasonYear: integer or null — season year (2000–2030). Look in repo name, description, branch names,
  release tags, or season game names (e.g., "Charged Up" = 2023, "Crescendo" = 2024).
  If isTeamCode=true, set toolType="github_project".
- confidence: 0.0 to 1.0 — how confident you are this is a legitimate, useful FIRST robotics tool
- reasoning: brief explanation of your classification

If this is clearly not a FIRST robotics tool, junk, or spam, set confidence to 0.0.
If the content is too thin to classify even after rendering, set confidence below 0.3.

Return ONLY valid JSON (no markdown fences, no text outside the JSON object).`

const RENDER_TOOL: Anthropic.Tool = {
  name: 'render_with_playwright',
  description:
    'Use a headless browser to render a JavaScript-heavy page and return its visible text content. ' +
    'Call this when the page HTML is clearly a SPA shell with little or no readable content about the tool.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string', description: 'The URL to render with a headless browser' },
    },
    required: ['url'],
  },
}

function buildUserContent(metadata: RawCandidateMetadata, url: string): string {
  const lines: string[] = [`URL: ${url}`]

  if (metadata.title) lines.push(`Title: ${metadata.title}`)
  if (metadata.githubUrl) lines.push(`GitHub: ${metadata.githubUrl}`)
  if (metadata.keywords?.length) lines.push(`Keywords: ${metadata.keywords.join(', ')}`)

  if (metadata.rawHtml) {
    lines.push('', 'Page content:', metadata.rawHtml)
  } else {
    lines.push('', '(No page content available — static extraction returned nothing)')
  }

  return lines.join('\n')
}

function parseClassification(text: string): CandidateClassification {
  // Extract JSON from a fenced code block anywhere in the response (Claude often adds prose before/after)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fenceMatch ? fenceMatch[1].trim() : text.trim()
  const parsed = JSON.parse(jsonText) as CandidateClassification
  return validateClassificationOutput(parsed) as CandidateClassification
}

export async function classifyCandidate(
  metadata: RawCandidateMetadata,
  url: string,
): Promise<CandidateClassification> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[classify] ANTHROPIC_API_KEY not set — skipping AI classification')
    return { confidence: 0.5 }
  }

  const client = getClient()
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserContent(metadata, url) },
  ]

  // For URLs where we already have structured API data (GitHub, YouTube), there is no
  // point offering the Playwright tool — the API provides better data than a rendered page
  // and skipping the tool saves a round-trip and avoids noisy Playwright calls.
  const hasStructuredData = Boolean(parseGitHubUrl(url)) || isYouTubeUrl(url)
  const toolsForRequest: Anthropic.Tool[] = hasStructuredData ? [] : [RENDER_TOOL]

  // Tool use loop — at most 2 turns (one optional tool call + final answer)
  for (let turn = 0; turn < 3; turn++) {
    let response: Awaited<ReturnType<typeof client.messages.create>>
    try {
      response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        ...(toolsForRequest.length > 0 ? { tools: toolsForRequest } : {}),
        messages,
      })
    } catch (err) {
      console.error('[classify] API error:', err)
      return { confidence: 0.3, reasoning: 'Classification failed' }
    }

    // Claude finished — parse the JSON classification from the text block
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      if (!textBlock) return { confidence: 0.3, reasoning: 'No text in response' }
      try {
        return parseClassification(textBlock.text)
      } catch {
        console.error('[classify] failed to parse JSON:', textBlock.text.slice(0, 200))
        return { confidence: 0.3, reasoning: 'JSON parse failed' }
      }
    }

    // Claude wants to use a tool
    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!toolUse) break

      messages.push({ role: 'assistant', content: response.content })

      if (toolUse.name === 'render_with_playwright') {
        const input = toolUse.input as { url?: string }
        const targetUrl = input.url ?? url
        console.log(`[classify] rendering ${targetUrl} with Playwright`)

        const rendered = await renderPage(targetUrl)
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: rendered
              ? `Rendered page content:\n${rendered}`
              : 'Playwright rendering failed or returned no content.',
          }],
        })
      } else {
        // Unknown tool — return empty result so loop terminates
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: 'Unknown tool.' }],
        })
      }
    }
  }

  return { confidence: 0.3, reasoning: 'Classification loop exhausted' }
}
