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

import { MANAGED_AI_CREDENTIAL_ID } from '@core/ai'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type {
  AiResolvedCredential,
  AiProviderModel,
  AiProviderCapabilities,
} from './drivers/types'
import type { AiProviderId, ToolScope } from './runtime/types'
import type { CredentialView } from './credentials/types'

const MANAGED_LABEL = 'Managed by operator'
/**
 * The gateway speaks the OpenRouter wire format, so the driver has to be told
 * `openrouter`. That is plumbing between the tenant server and the operator's
 * proxy, NOT a provider the tenant picked — the picker keys off
 * `MANAGED_AI_CREDENTIAL_ID` to keep it off screen.
 */
const MANAGED_PROVIDER: AiProviderId = 'openrouter' as AiProviderId
/**
 * The operator's multimodal route. `design` and `content` are the two builtin
 * task-type categories every operator config must define, and Design is the one
 * wired to an image-capable model — the gateway sends any vision-flagged call
 * there. The tenant needs the slug to know whether THIS message's route can
 * read an image (see `routeReadsImages` in handlers/chat.ts).
 */
export const MANAGED_VISION_CATEGORY = 'design'
const MODEL_CACHE_TTL_MS = 10_000
const CONFIG_CACHE_TTL_MS = 10_000
// Classification is a tiny best-effort routing call — cap it hard so a slow or
// stuck classifier never stalls the tenant's actual chat.
const CLASSIFY_TIMEOUT_MS = 6_000
const CLASSIFY_MAX_TOKENS = 16

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

// ---------------------------------------------------------------------------
// Per-task-type routing config + prompt classification (managed mode only)
// ---------------------------------------------------------------------------

const ManagedAiConfigSchema = Type.Object({
  categories: Type.Array(
    Type.Object({
      slug: Type.String(),
      name: Type.String(),
      description: Type.String(),
    }),
  ),
  guidance: Type.String(),
  hasClassifier: Type.Boolean(),
})
export type ManagedAiConfig = Static<typeof ManagedAiConfigSchema>

// Minimal shape of an OpenAI-style chat completion — validated at the boundary.
const ClassifyResponseSchema = Type.Object({
  choices: Type.Array(
    Type.Object({
      message: Type.Optional(
        Type.Object({ content: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
      ),
    }),
  ),
})

let configCache: { cfg: ManagedAiConfig; at: number } | null = null

/** Strip a trailing `/v1` from the gateway base to reach a probe endpoint. */
function probeBase(base: string): string {
  return base.replace(/\/v1\/?$/, '')
}

/**
 * The operator's task-type categories + global guidance, read live from the
 * gateway `/config` probe (10s cache). Returns null in standalone mode or when
 * the probe is unreachable/invalid — callers then skip routing + guidance.
 */
export async function getManagedAiConfig(): Promise<ManagedAiConfig | null> {
  const base = getGatewayUrl()
  if (!base) return null

  const now = Date.now()
  if (configCache && now - configCache.at < CONFIG_CACHE_TTL_MS) return configCache.cfg

  try {
    const res = await fetch(probeBase(base) + '/config')
    if (res.ok) {
      const parsed = safeParseValue(ManagedAiConfigSchema, await res.json())
      if (parsed.ok) {
        configCache = { cfg: parsed.value, at: now }
        return parsed.value
      }
    }
  } catch {
    // Gateway briefly unreachable — behave as if unconfigured (default routing).
  }
  return null
}

/** Test-only: clear the live-config cache so tests are order-independent. */
export function __resetManagedConfigCache(): void {
  configCache = null
}

/**
 * Pick the category slug that best fits a tenant prompt, via one cheap,
 * non-streaming classifier call through the gateway (the gateway swaps in the
 * operator's classifier model on the `x-instatic-ai-classify` header). Best
 * effort only: returns null on any failure/timeout/unknown reply so the caller
 * falls back to the operator's default model. Never throws.
 */
export async function classifyCategory(
  prompt: string,
  categories: ManagedAiConfig['categories'],
  signal?: AbortSignal,
): Promise<string | null> {
  const base = getGatewayUrl()
  if (!base || categories.length === 0) return null

  const menu = categories.map((c) => `- ${c.slug}: ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
  const body = {
    // Placeholder — the gateway overrides `model` with the classifier model.
    model: 'router',
    stream: false,
    temperature: 0,
    max_tokens: CLASSIFY_MAX_TOKENS,
    messages: [
      {
        role: 'system',
        content:
          'You route a website-editing request to ONE category. Reply with ONLY the exact category slug ' +
          'from the list — no punctuation, no explanation.\n\nCategories:\n' + menu,
      },
      { role: 'user', content: prompt },
    ],
  }

  // Cap the classify call independently of the main request, but still abort if
  // the whole chat is cancelled.
  const timeout = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS)
  const composite = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-instatic-ai-classify': '1',
        Authorization: `Bearer ${process.env.INSTATIC_AI_GATEWAY_TOKEN?.trim() || MANAGED_AI_CREDENTIAL_ID}`,
      },
      body: JSON.stringify(body),
      signal: composite,
    })
    if (!res.ok) return null
    const parsed = safeParseValue(ClassifyResponseSchema, await res.json())
    if (!parsed.ok) return null
    const reply = (parsed.value.choices[0]?.message?.content ?? '').trim().toLowerCase()
    if (!reply) return null
    // Accept an exact slug, or a model that echoed the display name instead.
    const hit = categories.find(
      (c) => c.slug.toLowerCase() === reply || c.name.toLowerCase() === reply,
    )
    return hit ? hit.slug : null
  } catch {
    return null
  }
}

/** The resolved credential drivers receive — points OpenRouter at the gateway. */
export function managedResolvedCredential(): AiResolvedCredential {
  const base = getGatewayUrl() ?? ''
  return {
    id: MANAGED_AI_CREDENTIAL_ID,
    providerId: MANAGED_PROVIDER,
    authMode: 'apiKey',
    // The gateway authenticates by the token baked into the URL and injects the
    // real key upstream, so the api key here is only a non-empty placeholder.
    apiKey: process.env.INSTATIC_AI_GATEWAY_TOKEN?.trim() || MANAGED_AI_CREDENTIAL_ID,
    baseUrl: base,
  }
}

/** The single wire-safe credential surfaced to the picker in managed mode. */
export function managedCredentialView(): CredentialView {
  return {
    id: MANAGED_AI_CREDENTIAL_ID,
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
    out[scope] = { credentialId: MANAGED_AI_CREDENTIAL_ID, modelId: model }
  }
  return out
}

/**
 * Capabilities the tenant's chat assumes for an operator-routed model.
 *
 * In managed mode the real model is resolved by the gateway per request (per
 * task-type category), so the tenant server can't introspect it — the
 * OpenRouter driver's sync `capabilities()` only knows a permissive default
 * that reports `visionInput: false`. Rejecting images on that basis would kill
 * every reference screenshot a tenant attaches ("build a page like this
 * design"), so `visionInput` is asserted here instead.
 *
 * That assertion is not blind optimism: the chat handler flags any request
 * carrying an image and the gateway routes those to the Design category's
 * model, which the operator wires to a multimodal model. Vision is therefore
 * true *by construction* for exactly the requests that need it. If an operator
 * still points Design at a text-only model, the tool loop's `imageUnsupported`
 * retry resends without images rather than surfacing the provider's refusal.
 */
export function managedModelCapabilities(): AiProviderCapabilities {
  return {
    toolCalling: true,
    visionInput: true,
    // The gateway speaks the OpenRouter/Responses wire format, whose
    // `function_call_output` item is text-only — a tool-result image is
    // downgraded to a "[N screenshot(s) omitted]" note before it ever leaves.
    // Claiming otherwise makes `render_snapshot` pay the html-to-image cost for
    // a PNG that is always discarded, and tells the model it has seen a
    // screenshot it never received.
    toolResultImages: false,
    promptCache: false,
    streaming: true,
  }
}

/**
 * How ONE message's images affect its routing. Decided per message, never per
 * conversation: a chat that starts with a design screenshot must be able to
 * drop back to the cheap Content model for "fix that typo" and return to Design
 * for "now restyle it", inside the same thread.
 *
 *  - `requiresVision` — this turn carries an image, so the gateway must
 *    override the text-classified category and route to Design.
 *  - `routeReadsImages` — the model this message lands on can decode an image.
 *    False makes the handler project older images down to breadcrumbs, so a
 *    screenshot from turn 1 cannot break a text-only turn 6. History is left
 *    untouched, so the images return as soon as the chat routes to Design again.
 *
 * In standalone mode there is no category routing: the selected model's real
 * `visionInput` decides both.
 */
export function resolveImageRouting(input: {
  readonly managed: boolean
  readonly currentTurnHasImage: boolean
  readonly category: string | null
  readonly visionInput: boolean
}): { requiresVision: boolean; routeReadsImages: boolean } {
  if (!input.managed) {
    return { requiresVision: false, routeReadsImages: input.visionInput }
  }
  return {
    requiresVision: input.currentTurnHasImage,
    // An unknown category (classifier failed or timed out) is treated as
    // text-only. Losing an old screenshot on that turn costs a weaker answer;
    // assuming vision and being wrong costs a failed request.
    routeReadsImages:
      input.currentTurnHasImage || input.category === MANAGED_VISION_CATEGORY,
  }
}

/** The picker's model list in managed mode: exactly the operator's model. */
export function managedModelList(model: string): AiProviderModel[] {
  return [
    {
      id: model,
      label: model,
      capabilities: managedModelCapabilities(),
    },
  ]
}
