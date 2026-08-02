/**
 * Album connector contract + shared host canonicalization.
 * The canonicalizer itself lives in @the-tool-pit/db so the web app (manual
 * submissions) and the worker (connectors) dedup on identical canonical URLs.
 */
import type { AlbumProvider, AlbumCandidateMetadata } from '@the-tool-pit/db'
import { canonicalizeAlbumUrl, detectAlbumProvider } from '@the-tool-pit/db'

export { canonicalizeAlbumUrl, detectAlbumProvider }

// ---------------------------------------------------------------------------
// Album connector contract (distinct from the tool CandidateInput shape)
// ---------------------------------------------------------------------------

export interface AlbumCandidateInput {
  /** FiM event page, CD thread, or submission origin URL. */
  sourceUrl: string
  canonicalUrl: string
  provider: AlbumProvider
  /** Intended event, carried through the pipeline until matched. */
  targetEventCode?: string
  targetEventYear?: number
  rawMetadata?: AlbumCandidateMetadata
}

export interface AlbumConnectorResult {
  candidates: AlbumCandidateInput[]
  stats: { discovered: number; skipped: number; errors: string[] }
}

export interface AlbumConnector {
  name: string
  /** @param year season year for context (query building / event matching). */
  run(year: number): Promise<AlbumConnectorResult>
}
