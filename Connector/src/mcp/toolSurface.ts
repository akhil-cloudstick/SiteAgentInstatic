/**
 * A revision marker for the tool surface, so a stale client can notice.
 *
 * An MCP client caches `tools/list`. A human notices a new capability from a
 * changelog or a colleague; an agent has neither — the schemas ARE its
 * documentation. So a client holding yesterday's list does not conclude "my
 * cache is old", it concludes "that parameter does not exist", and falls back
 * to whatever the old schema allowed. The studio hit exactly this: they used
 * `uploadId` successfully all day against a cached schema that said it would be
 * rejected, and only because we had described it in prose.
 *
 * This cannot stop a client caching. What it can do is make staleness
 * *detectable* in one cheap call: `connector_environment` reports the current
 * revision, a caller records it beside its cached list, and a mismatch on a
 * later run means refetch. No hashing on their side, no algorithm to agree on —
 * just "is this the same string I saw when I cached?"
 *
 * The revision covers names AND input schemas, because the failure being
 * guarded against was a schema that gained properties while its name stayed
 * put.
 */

import { createHash } from 'node:crypto'

interface Surface {
  count: number
  revision: string
}

let surface: Surface = { count: 0, revision: 'unknown' }

/**
 * Record the live tool surface. Called wherever the server is assembled, which
 * is the only place that knows the full set.
 */
export function setToolSurface(
  tools: readonly { name: string; inputSchema: unknown }[],
): void {
  // Sorted, so the revision tracks the CONTENT of the surface rather than the
  // order the tool arrays happen to be concatenated in — otherwise moving a
  // tool between files would look like a capability change to every client.
  const canonical = JSON.stringify(
    [...tools]
      .map((t) => [t.name, t.inputSchema] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  )
  surface = {
    count: tools.length,
    revision: createHash('sha256').update(canonical).digest('hex').slice(0, 12),
  }
}

export function toolSurface(): Surface {
  return surface
}
