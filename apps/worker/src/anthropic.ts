import Anthropic from '@anthropic-ai/sdk'

/**
 * One place that builds the Anthropic client.
 *
 * Six call sites used to each do `new Anthropic({ apiKey })`, which was fine
 * until the account moved to an IDENTITY-LINKED api key. Those reject every
 * request that does not name the workspace it acts in:
 *
 *   anthropic-workspace-id is required when authenticating with an
 *   identity-linked API key; send the id of the workspace this request acts in
 *
 * The workspace id is not a secret and not guessable from the key, so it comes
 * from ANTHROPIC_WORKSPACE_ID. When the variable is absent the header is simply
 * not sent, which is exactly right for an ordinary key: sending a workspace it
 * does not belong to gets a 404 rather than being ignored.
 *
 * Verified against the live API before committing: the same key returns 400
 * without the header, 404 with the wrong workspace, and 200 with the right one.
 */
let client: Anthropic | null = null

export function anthropic(): Anthropic {
  if (client) return client
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  })
  return client
}

/**
 * Whether a model call can be attempted at all. Callers already branch on the
 * key being absent; this keeps that check in one place so a second requirement
 * (the workspace, next time) does not have to be added in six files again.
 */
export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
