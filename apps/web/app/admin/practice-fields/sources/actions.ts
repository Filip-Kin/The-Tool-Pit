'use server'

import { revalidatePath } from 'next/cache'
import { assertAdmin } from '@/lib/admin/auth'
import { FIELD_CRAWL_SOURCE_KINDS } from '@the-tool-pit/db'
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
 * Practice-field discovery controls. Thin wrappers: the rules live in
 * lib/admin/listing-discovery.ts because the off-season event screen enforces
 * exactly the same ones.
 */

const PATH = listingSourcesPath('field')

export async function runFieldSource(sourceId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await runListingSourceRow('field', sourceId)
  revalidatePath(PATH)
  return res
}

/**
 * Run a connector with no source row behind it. The forum connector ships
 * without one, so without this there is no way to force a sweep before the
 * Sunday scheduler comes round.
 */
export async function runFieldConnector(connector: string): Promise<{ error?: string }> {
  await assertAdmin()
  if (!LISTING_CONNECTORS.field.some((c) => c.connector === connector)) {
    return { error: `Unknown connector: ${connector}` }
  }
  const res = await queueListingDiscover(connector)
  revalidatePath(PATH)
  return res
}

export async function setFieldSourceEnabled(sourceId: string, enabled: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await setListingSourceEnabled('field', sourceId, enabled)
  revalidatePath(PATH)
  return res
}

export async function setFieldSourceCadence(sourceId: string, cadenceHours: number): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await setListingSourceCadence('field', sourceId, cadenceHours)
  revalidatePath(PATH)
  return res
}

export async function createFieldSource(input: {
  kind: string
  label: string
  target: string
  cadenceHours: number
  notes?: string
}): Promise<{ error?: string }> {
  await assertAdmin()
  const res = await createListingSource('field', input, FIELD_CRAWL_SOURCE_KINDS)
  revalidatePath(PATH)
  return res
}
