/**
 * Worker entry: configuration, identity, bindings — then `app.ts` does the rest.
 */

import { handle } from './app'
import { authenticate } from './auth'
import { readConfig, type ConfigRead, type Env } from './config'
import { runScheduled } from './cron'
import { approvers, APPROVERS_PATH } from './approvers'
import { health, HEALTH_PATH } from './health'
import type { Deps } from './deps'
import { sendWebhook } from './notify'
import { D1Store, R2Blobs } from './store.d1'
import type { ExecutionContext, ScheduledController } from './worker-types'

type Configured = Extract<ConfigRead, { ok: true }>

function depsFor(env: Env, cfg: Configured, ctx: ExecutionContext): Deps {
  return {
    store: new D1Store(env.RELAY_DB),
    blobs: new R2Blobs(env.RELAY_ARTEFACTS),
    config: cfg.relay,
    now: () => new Date(),
    notify: (event) => ctx.waitUntil(sendWebhook(cfg.webhookUrl, cfg.publicUrl, event)),
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The one route that needs no login, answered before configuration and
    // identity, and reading nothing else. Everything below it requires both.
    const path = new URL(request.url).pathname
    if (path === HEALTH_PATH) return health(request, env)
    // The approver registry is read by the side that CHECKS approvals, which
    // holds no relay credential and should need none: every field is a public
    // key. Answered here for the same reason health is — before identity, and
    // reading only the registry.
    if (path === APPROVERS_PATH) return approvers(request, new D1Store(env.RELAY_DB))

    const cfg = readConfig(env)
    if (!cfg.ok) {
      return new Response(`The relay stays closed until it is configured:\n- ${cfg.problems.join('\n- ')}\n`, {
        status: 503,
      })
    }
    const who = await authenticate(request, cfg.access)
    if (!who.ok) return new Response(who.reason, { status: 403 })
    return handle(request, who.actor, depsFor(env, cfg, ctx))
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = readConfig(env)
    if (!cfg.ok) {
      console.warn(`relay scheduler skipped: ${cfg.problems.join('; ')}`)
      return
    }
    ctx.waitUntil(runScheduled(depsFor(env, cfg, ctx)))
  },
}
