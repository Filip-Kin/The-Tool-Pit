/**
 * AI-assisted event matching for album candidates whose event could not be
 * resolved by the connector heuristics (mostly ambiguous Chief Delphi threads).
 * Mirrors the classify.ts pattern: lazy Anthropic client, JSON-only output,
 * validated against the shortlist of real events we pass in.
 */
import Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'

export interface EventCandidate {
  eventCode: string
  name: string
  startDate: string | null
  week: number | null
  stateProv: string | null
}

export interface EventMatchResult {
  eventCode: string | null
  confidence: number
  reasoning?: string
}

let _client: Anthropic | undefined
function getClient(): Anthropic {
  if (!_client) _client = anthropic()
  return _client
}

const SYSTEM_PROMPT = `You match a photo album's forum post to the FRC event it covers.

You are given the album URL, the forum thread's title and blurb, and a shortlist of
candidate FRC events (each with an event code, name, date, week, and state).

Pick the ONE event the album most likely belongs to. Only choose an event from the
shortlist. If none is a confident match, return null.

Return ONLY valid JSON (no markdown fences, no prose) with this shape:
{"eventCode": "<code from the shortlist, or null>", "confidence": 0.0-1.0, "reasoning": "<brief>"}`

function buildUserContent(
  input: { albumUrl: string; threadTitle?: string; blurb?: string },
  candidates: EventCandidate[],
): string {
  const lines: string[] = [`Album URL: ${input.albumUrl}`]
  if (input.threadTitle) lines.push(`Thread title: ${input.threadTitle}`)
  if (input.blurb) lines.push(`Thread blurb: ${input.blurb}`)
  lines.push('', 'Candidate events:')
  for (const c of candidates) {
    lines.push(
      `- code=${c.eventCode} | ${c.name} | ${c.startDate ?? 'date?'} | week ${c.week ?? '?'} | ${c.stateProv ?? ''}`,
    )
  }
  return lines.join('\n')
}

function parseResult(text: string, validCodes: Set<string>): EventMatchResult {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const parsed = JSON.parse(fence ? fence[1].trim() : text.trim()) as EventMatchResult
  const code = parsed.eventCode && validCodes.has(parsed.eventCode) ? parsed.eventCode : null
  let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
  if (confidence < 0) confidence = 0
  if (confidence > 1) confidence = 1
  return { eventCode: code, confidence, reasoning: parsed.reasoning }
}

export async function matchEventWithAI(
  input: { albumUrl: string; threadTitle?: string; blurb?: string },
  candidates: EventCandidate[],
): Promise<EventMatchResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[match-event] ANTHROPIC_API_KEY not set - skipping AI match')
    return { eventCode: null, confidence: 0 }
  }
  if (candidates.length === 0) return { eventCode: null, confidence: 0 }

  const validCodes = new Set(candidates.map((c) => c.eventCode))
  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(input, candidates) }],
    })
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) return { eventCode: null, confidence: 0 }
    return parseResult(textBlock.text, validCodes)
  } catch (err) {
    console.error('[match-event] API error:', err)
    return { eventCode: null, confidence: 0 }
  }
}
