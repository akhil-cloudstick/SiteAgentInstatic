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
import type { AppConfig } from '../types';

export function isManagedSession(): boolean {
  if (process.env.NEXT_PUBLIC_OD_MANAGED_AI === '1') return true;
  return getHubContext() != null;
}

/**
 * The Settings section a managed session opens on.
 *
 * `execution` is the standalone default and no longer exists here, so every
 * entry point that used to name it is redirected through this one constant
 * rather than each picking its own replacement.
 */
export const MANAGED_SETTINGS_SECTION = 'instructions';

/**
 * Shown when a managed session can't run because the platform side isn't ready
 * — no operator model yet, or the runtime is missing on the host.
 *
 * Deliberately says nothing about providers, keys, models or status codes: a
 * tenant owns none of those and cannot act on any of them. The operator gets
 * the real diagnostic in the control-plane terminal instead.
 */
export const MANAGED_AI_UNCONFIGURED_MESSAGE =
  "AI isn't set up for this workspace yet. Please contact your operator.";

/**
 * Generic runtime failure text for a managed tenant.
 *
 * The daemon's own error formatters name the execution engine and its session
 * internals ("OpenCode session…"), which to a tenant is a program they never
 * installed and cannot fix. They get an action they can actually take instead.
 */
export const MANAGED_RUNTIME_ERROR_MESSAGE =
  'Something went wrong running that request. Try again — if it keeps happening, contact your operator.';

// Placeholders that stand in for credentials the tenant does not own. None of
// them are authoritative: the daemon overwrites provider, key and model on
// every run (see apps/daemon/src/managed-ai.ts). They exist only so the
// client-side guards that predate managed mode — "is there an API key?", "is
// the base URL valid?" — see a well-formed config instead of an empty one and
// stop short-circuiting the run before it reaches the daemon.
const MANAGED_API_KEY_PLACEHOLDER = 'managed-by-operator';
// Syntactically valid https URL on purpose: an invalid one would make Settings'
// save-guard treat execution fields as dirty-but-invalid and silently revert
// them whenever the tenant saves an unrelated section. It is also honest —
// the operator's gateway is an OpenRouter proxy.
const MANAGED_BASE_URL_PLACEHOLDER = 'https://openrouter.ai/api/v1';
const MANAGED_MODEL_FALLBACK = 'managed';

// The real model id, learned at runtime from the daemon's /api/app-config.
// It cannot be baked into the build: one shared Next bundle serves every
// tenant, while the model is per-deployment and changeable without a restart.
let managedModel: string | null = null;

export function setManagedAiModel(model: string | null | undefined): void {
  managedModel = typeof model === 'string' && model.trim() ? model.trim() : null;
}

/** The operator's model, for display only. Null until the probe lands. */
export function getManagedAiModel(): string | null {
  return managedModel;
}

/**
 * Force a managed session's execution config to the operator-managed runtime.
 *
 * Applied on every config read (fresh load and daemon merge alike) so there is
 * exactly one place that decides what a tenant runs on, and no ordering bug can
 * leave a half-managed config behind. A no-op outside a managed session.
 */
export function applyManagedAiConfig(cfg: AppConfig): AppConfig {
  if (!isManagedSession()) return cfg;
  return {
    ...cfg,
    mode: 'api',
    agentId: 'byok-opencode',
    apiProtocol: 'openai',
    apiProviderBaseUrl: MANAGED_BASE_URL_PLACEHOLDER,
    baseUrl: MANAGED_BASE_URL_PLACEHOLDER,
    apiKey: MANAGED_API_KEY_PLACEHOLDER,
    model: managedModel ?? MANAGED_MODEL_FALLBACK,
  };
}
