/**
 * The shape every gated tool shares: check the owner's GO, then spend it around
 * the single call that changes the site.
 *
 * An ungated target keeps the response it always had. A gated one wraps the
 * result with the GO that authorized it, so the caller's record — and the
 * activity log — can name the ticket and the owner key.
 *
 * `connector_import_replace` does not use this: it runs a dry run between the
 * check and the import, so it calls `checkGo` and `runUnderGo` itself.
 */

import type { ToolResult } from './tools'
import { resolveTarget } from '../http/config'
import type { InstaticSession } from '../http/session'
import type { Go, GoAction } from '../go/message'
import { checkGo, currentSiteDigest, goRefusal, runUnderGo, type GoBinding } from '../go/verify'
import { connectorRevision } from './revision'

export { currentRowsDigest } from '../go/verify'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string, detail?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...(detail ? { detail } : {}) }, null, 2) }],
  isError: true,
})

const targetOf = (args: Record<string, unknown>): string =>
  resolveTarget(typeof args.target === 'string' ? args.target : '').name

export async function runGated<T>(
  args: Record<string, unknown>,
  action: GoAction,
  binding: GoBinding,
  run: (go: Go | undefined) => Promise<T>,
  options: {
    /**
     * A last check, run after the GO verifies and BEFORE it is spent.
     *
     * The order matters and is the same one the replace path uses by hand: a
     * refusal here must not consume the approval, or the owner has to sign
     * again for a bundle nobody ever acted on. Returning a refusal stops the
     * action; returning null lets it proceed.
     */
    before?: () => Promise<{ message: string; detail: Record<string, unknown> } | null>
  } = {},
): Promise<ToolResult> {
  const gate = await checkGo({ action, target: targetOf(args), go: args.go, binding })
  if (!gate.ok) return fail(goRefusal(gate.reason))
  const stop = await options.before?.()
  if (stop) return fail(stop.message, stop.detail)
  const result = await runUnderGo(gate, run)
  if (!result.ok) return fail(goRefusal(result.reason))
  // A deploy that ran under a GO names the build that ran it, so the record on
  // the relay pins a version rather than "whatever was deployed that day".
  // An ungated target keeps the response it always had.
  return ok(
    result.receipt
      ? { result: result.result, go: result.receipt, connector: connectorRevision() }
      : result.result,
  )
}

/** What a site-publish GO must name on the target these arguments resolve to. */
export function siteDigestReport(session: InstaticSession, args: Record<string, unknown>) {
  return currentSiteDigest(session, targetOf(args))
}
