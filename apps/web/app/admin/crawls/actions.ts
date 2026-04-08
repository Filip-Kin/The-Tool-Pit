'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'
import type {
  CrawlJobPayload,
  FreshnessCheckPayload,
  ReindexPayload,
} from '@the-tool-pit/types'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

function getQueue<T>(name: string) {
  return new Queue<T>(name, {
    connection: getRedis(),
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
  })
}

/** Trigger a crawl for one of the registered connectors. */
export async function triggerCrawl(connector: string): Promise<{ error?: string }> {
  await assertAdmin()

  const VALID_CONNECTORS = [
    'fta_tools',
    'volunteer_systems',
    'github_topics',
    'awesome_list',
    'chief_delphi',
    'tba_teams',
  ] as const

  if (!VALID_CONNECTORS.includes(connector as (typeof VALID_CONNECTORS)[number])) {
    return { error: `Unknown connector: ${connector}` }
  }

  try {
    const queue = getQueue<CrawlJobPayload>('crawl')
    await queue.add('crawl', { connector, jobId: '' })
    revalidatePath('/admin/crawls')
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/** Queue a freshness check for ALL published tools. */
export async function triggerFreshnessCheckAll(): Promise<{ error?: string }> {
  await assertAdmin()

  try {
    const queue = getQueue<FreshnessCheckPayload>('freshness')
    await queue.add('check-freshness', { toolId: '__all__' })
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/** Rebuild PostgreSQL full-text + trigram search indexes. */
export async function triggerReindex(): Promise<{ error?: string }> {
  await assertAdmin()

  try {
    const queue = getQueue<ReindexPayload>('reindex')
    await queue.add('reindex', {})
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}
