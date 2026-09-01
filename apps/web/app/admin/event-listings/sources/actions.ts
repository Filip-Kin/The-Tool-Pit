'use server'

import { revalidatePath } from 'next/cache'
import { assertAdmin } from '@/lib/admin/auth'
import { EVENT_LISTING_SOURCE_KINDS } from '@the-tool-pit/db'
import {
  LISTING_CONNECTORS,
  createListingSource,
  listingSourcesPath,
  queueListingDiscover,
  runListingSourceRow,
  setListingSourceCadence,
  setListingSourceEnabled,
} from '@/lib/admin/listing-discovery'

/**
 * Off-season event discovery controls. Thin wrappers: the rules live in
 * lib/admin/listing-discovery.ts because the practice-field screen enforces
 * exactly the same ones.
 */

const PATH = listingSourcesPath('event')

export async function runEventSource(sourceId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await runListingSourceRow('event', sourceId)
  revalidatePath(PATH)
  return res
}

/**
 * Run a connector with no source row behind it. All three connectors ship
 * without one, so without this there is no way to force a sweep before the
 * scheduler comes round.
 */
export async function runEventConnector(connector: string): Promise<{ error?: string }> {
  await assertAdmin()
  if (!LISTING_CONNECTORS.event.some((c) => c.connector === connector)) {
    return { error: `Unknown connector: ${connector}` }
  }
  const res = await queueListingDiscover(connector)
  revalidatePath(PATH)
  return res
}

export async function setEventSourceEnabled(sourceId: string, enabled: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await setListingSourceEnabled('event', sourceId, enabled)
  revalidatePath(PATH)
  return res
}

export async function setEventSourceCadence(sourceId: string, cadenceHours: number): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await setListingSourceCadence('event', sourceId, cadenceHours)
  revalidatePath(PATH)
  return res
}

export async function createEventSource(input: {
  kind: string
  label: string
  target: string
  cadenceHours: number
  notes?: string
}): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await createListingSource('event', input, EVENT_LISTING_SOURCE_KINDS)
  revalidatePath(PATH)
  return res
}
