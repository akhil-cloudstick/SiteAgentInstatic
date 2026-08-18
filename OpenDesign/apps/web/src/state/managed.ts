/**
 * isManagedSession — true when this MMS Design session was opened from the
 * MMSBUILD Product Hub rather than run standalone.
 *
 * A managed session has already authenticated: the operator created the tenant,
 * the tenant signed in once at the Hub, and the gateway handed the session over
 * via signed SSO. Asking again inside MMS Design — the first-run panel's
 * "Sign in to MMS Design" / "Local coding agent" / "Bring your own key" fork —
 * is a second login for an already-authenticated person and a dead end for a
 * tenant who has no vela binary and no key of their own. Managed sessions
 * therefore skip first-run onboarding entirely.
 *
 * Model and provider are equally not the tenant's to choose: the operator picks
 * them in the control-plane Settings panel and the AI Gateway injects the key
 * and rewrites the model server-side (`OD_MANAGED_AI` / `OD_AI_GATEWAY_URL`),
 * so a tenant-facing provider picker would be a control that decides nothing.
 *
 * Two independent signals, either of which is sufficient:
 *  - `window.__mmsHub` — injected per-document by the control-plane gateway on
 *    every /design navigation. Runtime, per-tenant, needs no rebuild.
 *  - `NEXT_PUBLIC_OD_MANAGED_AI` — baked into the shared web build by
 *    `odRuntime.buildWeb()`. Survives a document that missed the injection
 *    (a client-side reload served straight from the Next server).
 */
import { getHubContext } from './hubContext';

export function isManagedSession(): boolean {
  if (process.env.NEXT_PUBLIC_OD_MANAGED_AI === '1') return true;
  return getHubContext() != null;
}
