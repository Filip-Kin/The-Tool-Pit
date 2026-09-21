import { Client, Events, GatewayIntentBits, Partials, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js'
import { eq } from 'drizzle-orm'
import { getDb, discordApprovalMessages } from '@the-tool-pit/db'
import { APPROVE_EMOJI, REJECT_EMOJI, DISCORD_BOT_TOKEN_ENV, DISCORD_APPROVALS_CHANNEL_ENV, siteUrl } from '@the-tool-pit/types'

/**
 * The FRC.Tools bot's ears. One gateway connection, one event: a reaction
 * added in the approvals channel.
 *
 * WHY THE WORKER. A gateway connection is a websocket that has to stay up,
 * and this is the one process here that stays up. The web app is request
 * scoped and would drop it between requests.
 *
 * WHAT IT DOES NOT DO. It does not approve anything. It checks that the
 * reaction is ✅ or ❌, on a message the bot posted, from a member who holds
 * the developer role, and then asks the site to decide, over HTTPS with a
 * shared secret. The decision bodies live in apps/web because they are the
 * same code the admin buttons run, and one copy is the point. The site edits
 * the post afterwards; this file never touches a message it did not have to.
 *
 * WHAT A FAILURE LOOKS LIKE. The site's error is replied under the post and
 * the reaction is taken back off, so the channel never shows a ✅ that did
 * nothing. "Already approved" is the normal race, two people on one post,
 * and it reads the same way.
 *
 * Off entirely when DISCORD_BOT_TOKEN, DISCORD_APPROVALS_CHANNEL_ID,
 * DISCORD_DEV_ROLE_ID or INTERNAL_API_SECRET is unset: one log line at boot,
 * the rest of the worker unaffected.
 */

const DEV_ROLE_ENV = 'DISCORD_DEV_ROLE_ID'
const SECRET_ENV = 'INTERNAL_API_SECRET'

interface ListenerConfig {
  token: string
  channelId: string
  devRoleId: string
  secret: string
  moderateUrl: string
}

function config(): ListenerConfig | null {
  const token = process.env[DISCORD_BOT_TOKEN_ENV]?.trim()
  const channelId = process.env[DISCORD_APPROVALS_CHANNEL_ENV]?.trim()
  const devRoleId = process.env[DEV_ROLE_ENV]?.trim()
  const secret = process.env[SECRET_ENV]?.trim()
  const missing = [
    [DISCORD_BOT_TOKEN_ENV, token],
    [DISCORD_APPROVALS_CHANNEL_ENV, channelId],
    [DEV_ROLE_ENV, devRoleId],
    [SECRET_ENV, secret],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) {
    console.warn(`[discord] reaction listener off: ${missing.join(', ')} unset`)
    return null
  }
  return {
    token: token!,
    channelId: channelId!,
    devRoleId: devRoleId!,
    secret: secret!,
    // The worker's own env may carry NEXT_PUBLIC_URL; siteUrl() reads it and
    // falls back to production. Override with WEB_INTERNAL_URL when the two
    // services can reach each other on a shorter path than the public one.
    moderateUrl: `${(process.env.WEB_INTERNAL_URL?.trim() || siteUrl()).replace(/\/+$/, '')}/api/internal/moderate`,
  }
}

async function askSiteToDecide(
  cfg: ListenerConfig,
  messageId: string,
  decision: 'approve' | 'reject',
  actorName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(cfg.moderateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': cfg.secret },
      body: JSON.stringify({ messageId, decision, actor: { name: actorName } }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true }
    return { ok: false, error: body.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: `could not reach the site: ${(err as Error).message}` }
  }
}

async function onReaction(
  cfg: ListenerConfig,
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return
  // A reaction on a message posted before this process started arrives
  // partial. Fetching fills in the message, and with it the author check.
  if (reaction.partial) {
    try {
      reaction = await reaction.fetch()
    } catch (err) {
      console.warn(`[discord] could not fetch a partial reaction: ${(err as Error).message}`)
      return
    }
  }
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message
  if (!message) return
  if (message.channelId !== cfg.channelId) return
  if (message.author?.id !== client.user?.id) return

  const emoji = reaction.emoji.name
  const decision = emoji === APPROVE_EMOJI ? 'approve' : emoji === REJECT_EMOJI ? 'reject' : null
  if (!decision) return

  // Is this post a decision at all? A summary is posted by the same bot and
  // gets no row. Cheap local check before any network.
  const [row] = await getDb()
    .select({ status: discordApprovalMessages.status })
    .from(discordApprovalMessages)
    .where(eq(discordApprovalMessages.messageId, message.id))
    .limit(1)
  if (!row) return

  const guild = message.guild
  if (!guild) return
  const member = await guild.members.fetch(user.id).catch(() => null)
  if (!member) return
  const actorName = member.displayName
  if (!member.roles.cache.has(cfg.devRoleId)) {
    // Not theirs to decide. The reaction comes off so the post does not read
    // as approved by somebody who cannot approve it.
    await reaction.users.remove(user.id).catch(() => undefined)
    return
  }

  if (row.status !== 'pending') {
    await reaction.users.remove(user.id).catch(() => undefined)
    return
  }

  const outcome = await askSiteToDecide(cfg, message.id, decision, actorName)
  if (outcome.ok) {
    console.log(`[discord] ${actorName} ${decision}d message ${message.id}`)
    return
  }
  console.warn(`[discord] ${decision} on ${message.id} by ${actorName} refused: ${outcome.error}`)
  await reaction.users.remove(user.id).catch(() => undefined)
  await message.reply({ content: `${emoji} ${actorName}: ${outcome.error}` }).catch((err: Error) => {
    console.warn(`[discord] could not reply under ${message.id}: ${err.message}`)
  })
}

/**
 * Connect and listen. Resolves to the client, or null when it is switched
 * off; the caller closes it on shutdown.
 */
export async function startDiscordListener(): Promise<Client | null> {
  const cfg = config()
  if (!cfg) return null

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  })

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void onReaction(cfg, client, reaction, user).catch((err: Error) => {
      console.error(`[discord] reaction handler threw: ${err.message}`)
    })
  })
  client.on(Events.Error, (err) => console.error(`[discord] gateway error: ${err.message}`))
  client.once(Events.ClientReady, (ready) => {
    console.log(`[discord] listening as ${ready.user.tag} in channel ${cfg.channelId}, decisions go to ${cfg.moderateUrl}`)
  })

  try {
    await client.login(cfg.token)
  } catch (err) {
    console.error(`[discord] login failed, reaction listener off: ${(err as Error).message}`)
    return null
  }
  return client
}
