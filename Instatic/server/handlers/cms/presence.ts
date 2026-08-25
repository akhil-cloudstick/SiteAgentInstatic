/**
 * Workspace presence endpoints.
 *
 *   GET  /cms/api/cms/presence/events?scope=site  — SSE roster stream
 *   POST /cms/api/cms/presence/heartbeat          — announce / refresh / leave
 *
 * Both are gated by `site.read`: presence reveals who is working in the admin,
 * which is exactly the population that already holds that capability.
 *
 * Why two endpoints instead of one long-lived socket: the SSE stream is
 * strictly a *read* channel and carries no identity beyond the session cookie,
 * so it needs no CSRF consideration; announcing is a normal POST that goes
 * through the same origin check as every other mutation. Splitting them also
 * means a client whose stream is buffered by a proxy still keeps itself alive
 * in the roster through heartbeats.
 *
 * The SSE mechanics (initial ping, 30s heartbeat comment, lease cap, abort +
 * cancel cleanup) are deliberately identical to
 * `server/handlers/cms/plugins/events.ts` — same failure modes, same fixes.
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { jsonResponse, methodNotAllowed, readValidatedBody } from '../../http'
import {
  HEARTBEAT_INTERVAL_MS,
  getRoster,
  removePeer,
  subscribePresence,
  touchPeer,
} from '../../presence/presenceRegistry'
import {
  PresenceHeartbeatSchema,
  PresenceScopeSchema,
  type PresenceScope,
} from '@core/presence'
import { Value } from '@sinclair/typebox/value'

const EVENTS_PATH = '/cms/api/cms/presence/events'
const HEARTBEAT_PATH = '/cms/api/cms/presence/heartbeat'

/** Cap an orphaned stream's lifetime; EventSource reconnects on its own. */
const STREAM_LEASE_MS = 120_000
const SSE_KEEPALIVE_MS = 30_000

function parseScope(raw: string | null): PresenceScope | null {
  return Value.Check(PresenceScopeSchema, raw) ? raw : null
}

export async function handlePresenceRoutes(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== EVENTS_PATH && url.pathname !== HEARTBEAT_PATH) return null

  const user = await requireCapability(req, db, 'site.read')
  if (user instanceof Response) return user

  if (url.pathname === EVENTS_PATH) {
    if (req.method !== 'GET') return methodNotAllowed()
    const scope = parseScope(url.searchParams.get('scope'))
    if (!scope) return jsonResponse({ error: 'Unknown presence scope' }, { status: 400 })
    return presenceEventStream(req, scope)
  }

  if (req.method !== 'POST') return methodNotAllowed()
  const body = await readValidatedBody(req, PresenceHeartbeatSchema)
  if (!body) return jsonResponse({ error: 'Invalid presence heartbeat' }, { status: 400 })

  if (body.leave) {
    removePeer(body.scope, body.sessionId)
    return jsonResponse({ ok: true })
  }

  // Identity comes from the authenticated session, never from the body — a
  // client can choose its own tab id but not who it claims to be.
  touchPeer({
    scope: body.scope,
    sessionId: body.sessionId,
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    gravatarHash: user.gravatarHash,
    lastSeen: Date.now(),
  })
  return jsonResponse({ ok: true, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS })
}

function presenceEventStream(req: Request, scope: PresenceScope): Response {
  const encoder = new TextEncoder()
  let closeStream: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe = (): void => {}
      let keepalive: ReturnType<typeof setInterval> | null = null
      let lease: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (closed) return
        closed = true
        if (keepalive) clearInterval(keepalive)
        if (lease) clearTimeout(lease)
        req.signal.removeEventListener('abort', cleanup)
        unsubscribe()
        try { controller.close() } catch { /* already closed or cancelled */ }
      }
      closeStream = cleanup

      function send(payload: string): void {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          cleanup()
        }
      }

      function sendRoster(): void {
        send(`event: roster\ndata: ${JSON.stringify({ scope, peers: getRoster(scope) })}\n\n`)
      }

      unsubscribe = subscribePresence((changedScope) => {
        if (changedScope === scope) sendRoster()
      })

      keepalive = setInterval(() => send(': heartbeat\n\n'), SSE_KEEPALIVE_MS)
      lease = setTimeout(cleanup, STREAM_LEASE_MS)

      if (req.signal.aborted) cleanup()
      else req.signal.addEventListener('abort', cleanup, { once: true })

      // Send the current roster immediately so a joining tab renders the
      // existing peers without waiting for someone else to change something.
      sendRoster()
    },
    cancel() {
      closeStream?.()
      closeStream = null
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}
