/**
 * Base connector interface.
 * All source connectors implement this contract.
 */
export interface ConnectorResult {
  candidates: CandidateInput[]
  stats: {
    discovered: number
    skipped: number
    errors: string[]
  }
}

export interface CandidateInput {
  sourceUrl: string
  canonicalUrl?: string
  title?: string
  description?: string
  githubUrl?: string
  homepageUrl?: string
  docsUrl?: string
  keywords?: string[]
  notes?: string
}

export interface Connector {
  name: string
  run(): Promise<ConnectorResult>
}

/**
 * Polite fetch with a User-Agent header and timeout.
 * Never hammer sites — add delays at the connector level.
 */
export async function politeFetch(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'TheToolPit/1.0 (+https://thetoolpit.com; discovery bot)',
        Accept: 'text/html,application/json',
        ...options?.headers,
      },
    })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

/** Delay helper — use between requests to be polite */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
