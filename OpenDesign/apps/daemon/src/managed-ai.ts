// Managed AI — MMSBUILD hosted mode.
//
// In the platform, an operator (not the tenant) owns the model relationship:
// they save ONE OpenRouter key and pick the MMS Design model in the control-plane
// Settings panel. Every tenant's /design then runs on it. The tenant has no
// provider picker, no key field, and no model chip — those controls would decide
// nothing.
//
// The control plane hands this daemon two env vars at spawn (see
// Operator/control-plane/runtime/odRuntime.mjs):
//
//   OD_MANAGED_AI      = '1'
//   OD_AI_GATEWAY_URL  = http://<cp>/ai/<signed-tenant-token>/design/v1
//
// That URL is a CREDENTIAL: the signed token is the only thing authenticating to
// the operator's gateway, so anyone holding it can spend the operator's balance.
// It must never leave this process — not to the browser, not into app-config.json,
// not into a log line. Only the resolved model ID is safe to disclose.
//
// The real provider key is never here at all: the gateway discards whatever
// Authorization header we send and injects the operator's key itself.
//
// Everything below is inert unless the gateway URL is present, so a daemon with
// none of these env vars behaves exactly as it did before. A developer running
// this repo outside the platform gets the same override path from
// OD_BYOK_BASE_URL / OD_BYOK_API_KEY / OD_BYOK_MODEL — see standaloneByokModel.
import type { ByokChatProviderConfig } from '@open-design/contracts';
import { BYOK_OPENCODE_AGENT_ID } from './runtimes/byok-opencode.js';

/**
 * Media generation does not go through the AI gateway.
 *
 * The operator's image, video, speech and search keys are injected into this
 * daemon as environment variables, and those calls go straight from here to the
 * provider. That is a deliberate design — it keeps large binary responses off
 * the control plane — but it means a gateway-side spending cap cannot see a
 * penny of that spend, and could not stop it either.
 *
 * So media is handled here instead, and the split is worth stating because the
 * two halves are not equally complete:
 *
 *   * CAPPED — yes. `assertMediaSpendAllowed` asks the control plane before a
 *     generation and refuses when the project has stopped. This is the half that
 *     matters: at the limit, new media work stops like any other AI work.
 *   * COUNTED — yes. Every generation is reported, so the ledger shows how much
 *     media a project actually used.
 *   * PRICED — no, not reliably. Image, video and speech providers do not return
 *     a cost, and their pricing is per-model and per-parameter in ways this
 *     daemon has no table for. So a media call is recorded with an UNKNOWN cost
 *     rather than a guessed one, and the ledger reports how many such calls a
 *     month holds. A month containing them has a total that is a floor, not a
 *     figure — and anyone setting a cap from it should be told so rather than
 *     left to assume.
 */
async function reportMediaSpendUrl(): Promise<string | null> {
  const base = managedGatewayUrl();
  if (!base || standaloneByokModel()) return null;
  return `${base.replace(/\/v1\/?$/, '')}/media-spend`;
}

/**
 * Refuse a media generation when the project has reached its limit.
 *
 * Throws, rather than returning a flag, because every caller of
 * `generateMedia` already handles a thrown error by surfacing its message —
 * so this reaches the tenant as the sentence written above rather than as a
 * shape each call site has to remember to check.
 */
export async function assertMediaSpendAllowed(): Promise<void> {
  const refusal = await managedSpendRefusal();
  if (refusal) throw new ManagedAiLimitReachedError(refusal);
}

/**
 * Record that a media generation happened. Fire-and-forget.
 *
 * A failed report understates the month, which means the cap errs towards
 * allowing. That is the right way for a metering failure to fall: the
 * alternative is refusing a tenant's work on the strength of a number we know is
 * wrong.
 */
export function reportMediaSpend(detail: { surface: string; model: string; providerId?: string }): void {
  void (async () => {
    try {
      const url = await reportMediaSpendUrl();
      if (!url) return;
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(detail),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // Never the reason a generation that already succeeded reports failure.
    }
  })();
}

/**
 * Sent as the bearer token to the gateway. It is deliberately not a secret: the
 * gateway replaces it with the operator's real key. It exists only because
 * `buildOpenCodeByokProviderConfig` refuses an empty apiKey.
 */
export const MANAGED_API_KEY_PLACEHOLDER = 'managed-by-operator';

/**
 * Shown to a tenant when the operator has not finished configuring AI. Plain
 * language on purpose — no status codes, no provider names, no model ids. The
 * tenant cannot fix any of those; the only useful action is to tell the operator.
 * The diagnostic detail goes to the operator's terminal instead (the gateway
 * logs `✗ BLOCKED — no model configured`).
 */
export const MANAGED_AI_UNCONFIGURED_MESSAGE =
  "AI isn't set up for this workspace yet. Please contact your operator.";

/**
 * Shown to a tenant whose project has reached its AI limit for the month.
 *
 * Same rules as the message above: plain language, no status codes, no numbers
 * the operator has not chosen to share. It says what still works, because "AI
 * stopped" and "my website stopped" are the same sentence to somebody who did
 * not build this, and only one of them is true.
 */
export const MANAGED_AI_LIMIT_MESSAGE =
  "This workspace has reached its AI limit for this month. Editing, publishing and your live site "
  + 'are unaffected. Please contact your operator to continue using AI.';

/** Thrown when the project has reached its monthly AI spending limit. */
export class ManagedAiLimitReachedError extends Error {
  readonly code = 'MANAGED_AI_LIMIT_REACHED';

  constructor(message: string = MANAGED_AI_LIMIT_MESSAGE) {
    super(message);
    this.name = 'ManagedAiLimitReachedError';
  }
}

/** Thrown when managed mode is on but no model has been configured yet. */
export class ManagedAiUnconfiguredError extends Error {
  readonly code = 'MANAGED_AI_UNCONFIGURED';

  constructor() {
    super(MANAGED_AI_UNCONFIGURED_MESSAGE);
    this.name = 'ManagedAiUnconfiguredError';
  }
}

function envValue(name: string): string | null {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** The per-tenant AI gateway base URL, or null when not running under the hub. */
export function managedGatewayUrl(): string | null {
  return envValue('OD_AI_GATEWAY_URL') ?? envValue('OD_BYOK_BASE_URL');
}

/**
 * Standalone development escape hatch.
 *
 * The Local CLI and the Execution-mode settings pane are gone from this build,
 * so there is no longer any in-app way to hand Open Design a provider key. That
 * is correct for tenants — the operator supplies it — but it would otherwise
 * leave a developer running this repo outside the platform with no way to run
 * the agent at all. Setting these three env vars restores that:
 *
 *   OD_BYOK_BASE_URL   an OpenAI-compatible /v1 endpoint
 *   OD_BYOK_API_KEY    the key for it
 *   OD_BYOK_MODEL      the model id to run
 *
 * Unset in the platform, where OD_AI_GATEWAY_URL takes precedence.
 */
function standaloneByokModel(): string | null {
  return envValue('OD_BYOK_MODEL');
}

/**
 * The key to send upstream: the inert placeholder under the control plane (which
 * swaps in the operator's real key), or the developer's own key standalone.
 */
export function managedApiKey(): string {
  // Under the control plane the gateway replaces this; standalone, it is the
  // developer's real key.
  return envValue('OD_AI_GATEWAY_URL')
    ? MANAGED_API_KEY_PLACEHOLDER
    : envValue('OD_BYOK_API_KEY') ?? MANAGED_API_KEY_PLACEHOLDER;
}

/**
 * True when the operator owns this daemon's model choice.
 *
 * Requires the gateway URL as well as the flag: `OD_MANAGED_AI=1` on its own
 * would mean "hide the tenant's controls" with nothing to replace them, which
 * is worse than either mode on its own.
 */
export function isManagedAi(): boolean {
  if (managedGatewayUrl() === null) return false;
  // Either the control plane declared this a managed tenant, or a developer
  // supplied standalone BYOK env vars — both mean "the daemon owns the AI
  // selection", which is the only thing callers actually branch on.
  return process.env.OD_MANAGED_AI === '1' || standaloneByokModel() !== null;
}

// The gateway's model probe lives one level up from the OpenAI-compatible root:
//   base  = .../ai/<token>/design/v1
//   probe = .../ai/<token>/design/model
function modelProbeUrl(base: string): string {
  return `${base.replace(/\/v1\/?$/, '')}/model`;
}

function spendProbeUrl(base: string): string {
  return `${base.replace(/\/v1\/?$/, '')}/spend`;
}

/**
 * Whether this project may start new AI work, asked of the control plane.
 *
 * Returns a message when it may not, and null when it may. Never throws, and
 * ALLOWS when the probe cannot be answered — deliberately the opposite of the
 * gateway's own rule, and the asymmetry is the point: the gateway is the
 * enforcement and it fails closed on a capped project, so this pre-check only
 * has to improve the message. If it failed closed too, a momentary blip between
 * the daemon and the control plane would stop runs the gateway would happily
 * have allowed, and it would do so with a message about spending limits that was
 * not true.
 */
export async function managedSpendRefusal(): Promise<string | null> {
  const base = managedGatewayUrl();
  if (!base || standaloneByokModel()) return null;
  try {
    const resp = await fetch(spendProbeUrl(base), { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { allow?: unknown };
    // The gateway's own reason is written for the operator's terminal. The
    // tenant gets this module's wording, which is the one reviewed for what a
    // tenant should be told.
    return data.allow === false ? MANAGED_AI_LIMIT_MESSAGE : null;
  } catch {
    return null;
  }
}

// Short cache so a long agent loop doesn't re-probe on every turn, while an
// operator changing the model in Settings still sees it apply within seconds
// and without restarting anything.
const MODEL_CACHE_MS = 10_000;
let cachedModel: string | null = null;
let cachedAt = 0;

/**
 * The model the operator picked, or null when they haven't picked one (or the
 * control plane is unreachable). Never throws: a probe failure must surface as
 * the friendly "not set up" message, not as a stack trace mid-run.
 */
export async function getManagedModel(): Promise<string | null> {
  const base = managedGatewayUrl();
  if (!base) return null;
  // Standalone: the model is stated outright, there is no gateway to ask.
  const standalone = standaloneByokModel();
  if (standalone) return standalone;

  const now = Date.now();
  if (cachedModel && now - cachedAt < MODEL_CACHE_MS) return cachedModel;

  try {
    const resp = await fetch(modelProbeUrl(base), {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return cachedModel;
    const data = (await resp.json()) as { model?: unknown };
    const model = typeof data.model === 'string' ? data.model.trim() : '';
    if (!model) return null;
    cachedModel = model;
    cachedAt = now;
    return model;
  } catch {
    // Control plane briefly unreachable — keep serving the last known model
    // rather than failing a run that would otherwise have worked.
    return cachedModel;
  }
}

/** Test seam / restart hook: drop the cached model so the next read re-probes. */
export function resetManagedModelCache(): void {
  cachedModel = null;
  cachedAt = 0;
}

/**
 * The BYOK provider config that points OpenCode at the operator's gateway.
 *
 * `protocol: 'openai'` is plumbing, not a provider choice. Because the gateway
 * host is not api.openai.com, `buildOpenCodeByokProviderConfig` routes it through
 * `@ai-sdk/openai-compatible` and calls `<baseUrl>/chat/completions` — exactly
 * the OpenRouter wire shape the gateway proxies.
 */
export function managedByokProvider(model: string): ByokChatProviderConfig {
  return {
    protocol: 'openai',
    apiKey: managedApiKey(),
    baseUrl: managedGatewayUrl() ?? '',
    apiVersion: '',
    model,
  };
}

/**
 * Overwrite a run's AI selection with the operator's.
 *
 * Unconditional by design: a tenant browser can post any agentId/model/provider
 * it likes, and this is the server-side point where that stops mattering. Called
 * at the top of `startChatRun` (the funnel every run passes through) and again in
 * the two run-creation routes, which validate the provider before that funnel is
 * reached.
 *
 * Throws `ManagedAiUnconfiguredError` when the operator hasn't picked a model —
 * deliberately, rather than silently falling back to some other model.
 */
export async function applyManagedRunAi<T extends Record<string, unknown>>(
  meta: T,
): Promise<T> {
  if (!isManagedAi()) return meta;
  const model = await getManagedModel();
  if (!model) throw new ManagedAiUnconfiguredError();
  // Asked once per run, not per turn: this is the funnel every run passes
  // through, so refusing here stops scheduled work and the CMS correction loop
  // too, not just somebody pressing send.
  const refusal = await managedSpendRefusal();
  if (refusal) throw new ManagedAiLimitReachedError(refusal);
  return {
    ...meta,
    agentId: BYOK_OPENCODE_AGENT_ID,
    model,
    byokProvider: managedByokProvider(model),
  };
}
