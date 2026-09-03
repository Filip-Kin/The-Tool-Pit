/**
 * A single JSON-LD structured-data block.
 *
 * The standard Next.js pattern: a <script type="application/ld+json"> whose
 * body is JSON.stringify of a schema.org object, injected with
 * dangerouslySetInnerHTML because the payload is our own serialized data, not
 * user HTML. Rendered inside a Server Component so the markup ships in the
 * first response where a crawler can read it without running JavaScript.
 *
 * `data` is one schema.org node (it must carry its own "@context" and "@type").
 * Undefined/null are not accepted, so a caller that has nothing to say renders
 * nothing rather than an empty block: build the object first, only render this
 * when it is worth rendering.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Some string values (a crawled tool description, a grant summary) are not
  // ours to trust, and a "</script>" inside one would close this tag early.
  // Escaping "<" to its < form keeps the payload inside the script block
  // while staying valid JSON, which is the standard hardening for ld+json.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
