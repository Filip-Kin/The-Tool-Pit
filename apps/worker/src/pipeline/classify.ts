/**
 * AI-powered classification of tool candidates.
 * Uses Claude to infer program(s), audience, tool type, summary, and flags.
 * Always runs after deterministic extraction — AI is enrichment, not source of truth.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { CandidateClassification, RawCandidateMetadata } from '@the-tool-pit/db'

const VALID_TOOL_TYPES = new Set([
  'web_app', 'desktop_app', 'mobile_app', 'calculator', 'spreadsheet',
  'github_project', 'browser_extension', 'api', 'resource', 'other',
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

let _client: Anthropic | undefined

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

const CLASSIFICATION_PROMPT = `You are classifying tools for a FIRST Robotics directory (FRC, FTC, FLL).

Given information about a tool or resource, output a JSON object with the following fields:
- toolType: one of "web_app", "desktop_app", "mobile_app", "calculator", "spreadsheet", "github_project", "browser_extension", "api", "resource", "other"
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
If the content is too thin to classify, set confidence below 0.3.

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`

export async function classifyCandidate(
  metadata: RawCandidateMetadata,
  url: string,
): Promise<CandidateClassification> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[classify] ANTHROPIC_API_KEY not set — skipping AI classification')
    return { confidence: 0.5 }
  }

  const client = getClient()

  const userContent = `URL: ${url}
Title: ${metadata.title ?? 'N/A'}
Description: ${metadata.description ?? 'N/A'}
Keywords: ${(metadata.keywords ?? []).join(', ') || 'N/A'}
Has GitHub link: ${metadata.githubUrl ? 'yes (' + metadata.githubUrl + ')' : 'no'}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Use Haiku for cost-efficient classification
      max_tokens: 600,
      system: CLASSIFICATION_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content[0]?.type === 'text' ? message.content[0].text : ''

    // Strip markdown code fences Claude sometimes wraps around JSON
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(clean) as CandidateClassification

    // Validate and filter enum fields — silently drop unknown values
    if (parsed.toolType && !VALID_TOOL_TYPES.has(parsed.toolType)) {
      console.warn(`[classify] unknown toolType "${parsed.toolType}" — falling back to "other"`)
      parsed.toolType = 'other'
    }
    if (Array.isArray(parsed.programs)) {
      const before = parsed.programs
      parsed.programs = parsed.programs.filter((p) => VALID_PROGRAMS.has(p))
      if (parsed.programs.length < before.length) {
        console.warn(`[classify] filtered invalid programs: ${before.filter(p => !VALID_PROGRAMS.has(p)).join(', ')}`)
      }
    }
    if (Array.isArray(parsed.audienceRoles)) {
      parsed.audienceRoles = parsed.audienceRoles.filter((r) => VALID_AUDIENCE_ROLES.has(r))
    }
    if (Array.isArray(parsed.audienceFunctions)) {
      parsed.audienceFunctions = parsed.audienceFunctions.filter((f) => VALID_AUDIENCE_FUNCTIONS.has(f))
    }

    if (parsed.isTeamCode) {
      const t = parsed.teamNumber
      if (t !== null && t !== undefined && (!Number.isInteger(t) || t < 1 || t > 99999))
        parsed.teamNumber = null
      const y = parsed.seasonYear
      const now = new Date().getFullYear()
      if (y !== null && y !== undefined && (!Number.isInteger(y) || y < 2000 || y > now + 1))
        parsed.seasonYear = null
    }

    return parsed
  } catch (err) {
    console.error('[classify] error:', err)
    return { confidence: 0.3, reasoning: 'Classification failed' }
  }
}
