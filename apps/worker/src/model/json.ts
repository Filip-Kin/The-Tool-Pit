/**
 * Pull the JSON object out of a model reply, whatever it wrapped it in.
 *
 * The prompts forbid fences; Haiku adds them anyway. The old strip matched a
 * fence only when it was CLOSED, so a reply that opened with ```json and then
 * ran out of tokens before the closing fence fell through to JSON.parse on the
 * raw text, which failed on the backticks, and the whole extraction was thrown
 * away as "bad_response". This is more forgiving in the two ways that matter:
 * an opening fence with no closing one is still stripped, and any prose before
 * or after the object is ignored by taking the first "{" to the last "}".
 *
 * Truncated JSON (no final "}") still fails, as it should: the caller's fix for
 * that is a higher max_tokens, not a guess at the missing fields.
 */
export function parseModelJson<T>(text: string): T {
  let body = text.trim()
  // Closed fence: take the inside. Unclosed: drop the opening line only.
  const closed = body.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (closed) body = closed[1]
  else body = body.replace(/^```(?:json)?\s*/i, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object in model reply')
  }
  return JSON.parse(body.slice(start, end + 1)) as T
}
