/**
 * Managed AI mode — hosted / multi-tenant operation.
 *
 * When an operator (e.g. SiteAgent) runs this Instatic instance FOR a tenant,
 * the tenant must not bring their own provider key, change the model, or reach
 * the operator's real key. AI routes through the operator's **AI Gateway** (an
 * OpenRouter-compatible reverse proxy that injects the operator's key upstream),
 * and the model is chosen by the operator.
 *
 * Enabled by ONE env var:
 *   - `INSTATIC_AI_GATEWAY_URL` — OpenRouter-compatible base URL carrying the
 *     signed tenant token, e.g. `http://127.0.0.1:4000/ai/<token>/v1`.
 *
 * The MODEL is NOT taken from env (that would freeze it until a restart).
 * Instead it is read LIVE from the gateway's `/model` probe, which returns the
 * operator's current Settings value from the DB. So changing the model in the
 * console takes effect on the tenant's next request — no restart, no
 * re-provision. `INSTATIC_AI_MODEL` is honoured only as an offline fallback if
 * the gateway is briefly unreachable.
 *
 * When `INSTATIC_AI_GATEWAY_URL` is absent this module is inert and standalone
 * Instatic behaves exactly as before (users add their own providers).
 */

import type { AiResolvedCredential, AiProviderModel } from './drivers/types'
import type { AiProviderId, ToolScope } from './runtime/types'
import type { CredentialView } from './credentials/types'

/** The synthetic credential id used everywhere in managed mode. */
export const MANAGED_CREDENTIAL_ID = 'managed'

const MANAGED_LABEL = 'Managed by operator'
const MANAGED_PROVIDER: AiProviderId = 'openrouter' as AiProviderId
const MODEL_CACHE_TTL_MS = 10_000

/** The gateway base URL (with the signed tenant token), or null if not managed. */
export function getGatewayUrl(): string | null {
  return process.env.INSTATIC_AI_GATEWAY_URL?.trim() || null
}

/** True when the operator has wired this instance to a managed AI Gateway. */
export function isManagedAiMode(): boolean {
  return getGatewayUrl() !== null
}

let modelCache: { model: string; at: number } | null = null

/**
 * The operator's CURRENT model, read live from the gateway (10s cache) so a
 * Settings change reflects without a tenant restart. Falls back to the
 * `INSTATIC_AI_MODEL` env value if the gateway probe is unreachable.
 */
export async function getManagedModel(): Promise<string> {
  const envModel = process.env.INSTATIC_AI_MODEL?.trim() || ''
  const base = getGatewayUrl()
  if (!base) return envModel

  const now = Date.now()
  if (modelCache && now - modelCache.at < MODEL_CACHE_TTL_MS) return modelCache.model

  try {
    const probe = base.replace(/\/v1\/?$/, '') + '/model'
    const res = await fetch(probe)
    if (res.ok) {
      const data = (await res.json()) as { model?: string }
      const model = (data.model ?? '').trim() || envModel
      modelCache = { model, at: now }
      return model
    }
  } catch {
    // Gateway briefly unreachable — fall back to the env value.
  }
  return envModel
}

/** Test-only: clear the live-model cache so tests are order-independent. */
export function __resetManagedModelCache(): void {
  modelCache = null
}

/** The resolved credential drivers receive — points OpenRouter at the gateway. */
export function managedResolvedCredential(): AiResolvedCredential {
  const base = getGatewayUrl() ?? ''
  return {
    id: MANAGED_CREDENTIAL_ID,
    providerId: MANAGED_PROVIDER,
    authMode: 'apiKey',
    // The gateway authenticates by the token baked into the URL and injects the
    // real key upstream, so the api key here is only a non-empty placeholder.
    apiKey: process.env.INSTATIC_AI_GATEWAY_TOKEN?.trim() || MANAGED_CREDENTIAL_ID,
    baseUrl: base,
  }
}

/** The single wire-safe credential surfaced to the picker in managed mode. */
export function managedCredentialView(): CredentialView {
  return {
    id: MANAGED_CREDENTIAL_ID,
    providerId: MANAGED_PROVIDER,
    authMode: 'apiKey',
    displayLabel: MANAGED_LABEL,
    baseUrl: null,
    keyFingerprintCurrent: true,
    createdAt: new Date(0).toISOString(),
    lastUsedAt: null,
  }
}

/** Every scope defaults to the managed credential + the given (live) model. */
export function managedDefaultsMap(
  model: string,
): Record<string, { credentialId: string; modelId: string }> {
  const scopes: ToolScope[] = ['site', 'content', 'data', 'plugin']
  const out: Record<string, { credentialId: string; modelId: string }> = {}
  for (const scope of scopes) {
    out[scope] = { credentialId: MANAGED_CREDENTIAL_ID, modelId: model }
  }
  return out
}

/** The picker's model list in managed mode: exactly the operator's model. */
export function managedModelList(model: string): AiProviderModel[] {
  return [
    {
      id: model,
      label: model,
      capabilities: {
        toolCalling: true,
        visionInput: false,
        promptCache: false,
        streaming: true,
      },
    },
  ]
}
