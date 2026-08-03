'use server'

import { getEventsByDatePage } from '@/lib/queries/albums'

/** Next page of the chronological home feed, for infinite scroll. */
export async function loadMoreEvents(offset: number) {
  return getEventsByDatePage({ limit: 30, offset })
}
