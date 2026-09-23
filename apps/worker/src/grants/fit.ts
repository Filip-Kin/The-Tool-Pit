/**
 * Fit: would a FIRST robotics team realistically apply for this?
 *
 * The classifier's question is "is this a grant a team COULD apply to", and a
 * community foundation's disaster-relief fund passes it (a school is an
 * eligible nonprofit). That listing is noise on a robotics site. This pass
 * reads the extracted text (no fetch) and answers a narrower question, and
 * the publish gate refuses 'off'. About 700 input tokens on Haiku per call.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'
import type { GrantExtraction } from '@the-tool-pit/db'

export const GRANT_FIT_LEVELS = ['robotics', 'stem', 'general', 'off'] as const
export type GrantFitLevel = (typeof GRANT_FIT_LEVELS)[number]
export type GrantFit = NonNullable<GrantExtraction['fit']>

const FIT_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You judge whether a funding programme fits a FIRST robotics team: FRC, FTC or FLL, a school or community youth team that builds a competition robot, applying through its school, a booster-club nonprofit or a fiscal sponsor.

Reply with JSON only: {"level": "robotics" | "stem" | "general" | "off", "reason": "<one sentence, quoting the words that decide it>"}

- robotics: the programme names robotics, FIRST, FRC, FTC, FLL, VEX or robot competitions as its purpose or an eligible use.
- stem: it funds STEM, science, engineering, technology, computing, maker or career-technical education for youth or schools. A robotics team is a natural applicant.
- general: an open community, youth or education grant that any local nonprofit or school could apply to. A team could apply; it is not the point of the programme.
- off: the purpose or the eligible population rules a robotics team out or makes an application unrealistic. Any of these is off:
  * the cause, when it is the ONLY purpose (every focus area the funder names is one of these): disaster or wildfire relief, health care, foster care, housing, hunger, arts and culture, environment, conservation or marine work, climate, adult workforce, higher-education research, faith, a specific unrelated population;
  * the eligibility: schools, school districts, PTOs, booster clubs or youth clubs are named as ineligible; an operating budget floor of $100,000 or more; a track record of several years of programming; invitation-only or "no unsolicited requests"; prior participants only; applicants limited to the schools or employees of ONE named school district, or to ONE company's employees (a district education foundation's teacher grants), because no team outside it can apply;
  * the mechanism: a formula allocation to districts or agencies rather than an application; reimbursement of an individual's own expenses, an employee benefit, or a purchase discount or referral bonus; wages or stipends; money paid only to individuals (a scholarship, an educator stipend). A grant paid to the TEAM after it registers or competes is still money to the team and is not off;
  * a different competition: VEX-only, drone-only or another league named as the sole eligible programme.

A 501(c)(3) requirement alone is never off: teams apply through a booster-club nonprofit, a school or a fiscal sponsor. Eligibility limited to schools, public schools or school districts is likewise never off: a school-based team applies through its school, and a robotics-equipment grant to schools is the robotics level.

A community foundation, a corporate giving programme or a utility's foundation that names several focus areas is general whenever ONE of them is education, youth, STEM, workforce readiness or community development, even when the others are hunger, climate, health or the arts. Kellogg, Walmart Spark Good, Con Edison, a city's community foundation: general, never off. Read the whole list before judging; one unrelated cause in it proves nothing.

Judge only from the text you are given. When the text describes several programmes from the same funder, judge the programme named on the "Name" line and ignore the others. A broad list of causes that includes education alongside unrelated causes is general, not off. A programme aimed at elementary or middle school only is still stem or general (FLL teams are that age). A closed round on a recurring programme is not off.`

function field(v: unknown, limit = 1200): string {
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (v === null || v === undefined) return ''
  return String(v).slice(0, limit)
}

export function fitPrompt(fields: GrantExtraction['fields']): string {
  return [
    `Name: ${field(fields.name.value)}`,
    `Funder: ${field(fields.funderName.value)}`,
    `Programs named: ${field(fields.programs.value)}`,
    `Summary: ${field(fields.summary.value)}`,
    `Description: ${field(fields.description.value)}`,
    `Eligibility: ${field(fields.eligibilityText.value)}`,
    `Geography: ${field(fields.geographyRestriction.value, 300)}`,
  ].join('\n')
}

export function parseFit(text: string, checkedAt = new Date()): GrantFit {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`fit: no JSON in reply: ${text.slice(0, 120)}`)
  const parsed = JSON.parse(text.slice(start, end + 1)) as { level?: unknown; reason?: unknown }
  const level = String(parsed.level ?? '').toLowerCase()
  if (!(GRANT_FIT_LEVELS as readonly string[]).includes(level)) throw new Error(`fit: unknown level "${level}"`)
  return {
    level: level as GrantFitLevel,
    reason: String(parsed.reason ?? '').slice(0, 400),
    model: FIT_MODEL,
    checkedAt: checkedAt.toISOString(),
  }
}

export async function judgeFit(extraction: Pick<GrantExtraction, 'fields'>): Promise<GrantFit> {
  const f = extraction.fields
  const words = [f.summary.value, f.description.value, f.eligibilityText.value].map((v) => field(v)).join(' ').trim()
  // A name and a funder are not enough to judge; the model says so in prose
  // and the gate would read a guess. Leave the verdict missing, the gate
  // holds the row, and the next extraction with text judges it.
  if (words.split(/\s+/).length < 12) throw new Error('fit: too little text to judge (no summary, description or eligibility)')
  const response = await anthropic().messages.create({
    model: FIT_MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: fitPrompt(extraction.fields) }],
  })
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!block) throw new Error('fit: model returned no text')
  return parseFit(block.text)
}
