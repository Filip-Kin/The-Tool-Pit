'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'
import type { AlbumIngestPayload } from '@the-tool-pit/types'

const ALBUM_CONNECTORS = ['tba_events', 'fim_albums', 'chief_delphi_albums'] as const

async function assertAdmin() {
  const cookieStore = await cookies()
  if (cookieStore.get('admin_token')?.value !== process.env.ADMIN_SECRET) redirect('/admin/login')
}

export async function triggerAlbumIngest(connector: string, year?: number): Promise<{ error?: string }> {
  await assertAdmin()

  if (!ALBUM_CONNECTORS.includes(connector as (typeof ALBUM_CONNECTORS)[number])) {
    return { error: `Unknown album connector: ${connector}` }
  }

  try {
    const queue = new Queue<AlbumIngestPayload>('album-ingest', {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
    })
    await queue.add('album-ingest', { connector, year: year ?? new Date().getFullYear(), jobId: '' })
    revalidatePath('/admin/album-sources')
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}
