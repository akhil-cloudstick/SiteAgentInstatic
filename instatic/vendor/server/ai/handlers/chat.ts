/**
 * POST /admin/api/ai/chat/:scope
 *
 * Opens an NDJSON stream against a chat. Body:
 *   {
 *     conversationId: string,
 *     prompt:         string,
 *     snapshot?:      unknown   // scope-specific per-request context
 *   }
 *
 * The conversation row already carries `(credentialId, modelId)` from when
 * it was created. The handler:
 *   1. Verifies `ai.chat` + ownership of the conversation.
 *   2. Loads + decrypts the credential (rejects if rotated).
 *   3. Resolves the driver for the credential's provider.
 *   4. Builds an `AiStreamRequest` (system prompt + tools + history).
 *      Write tools are filtered out unless the caller has `ai.tools.write`.
 *   5. Persists the user message, then runs `runChat({ ... })`.
 *   6. Streams NDJSON events back as the driver produces them.
 */

import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { AiContentBlock } from '@core/ai'
import { jsonResponse, readValidatedBody, badRequest } from '../../http'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import { createAuditEvent } from '../../repositories/audit'
import {
  appendMessage,
  listMessagesForConversation,
  readConversationForUser,
} from '../conversations/store'
import { buildMessageHistory } from '../conversations/history'
import {
  readCredentialForUser,
  resolveCredentialForDriver,
  touchCredentialLastUsed,
} from '../credentials/store'
import { resolveDriver } from '../drivers'
import { selectToolsForScope } from '../tools'
import {
  buildSiteSystemPrompt,
  SiteAgentSnapshotSchema,
  type SiteAgentSnapshot,
} from '../tools/site'
import {
  buildContentSystemPrompt,
  type ContentSnapshot,
} from '../tools/content'
import {
  createBridge,
  createConversationsPersister,
  encodeStreamEvent,
  runChat,
} from '../runtime'
import { normalizeContextTokens } from '../contextTokens'
import type {
  AiStreamEvent,
  ToolScope,
} from '../runtime/types'
import type { AiStreamRequest } from '../drivers/types'
import {
  isManagedAiMode,
  managedResolvedCredential,
  managedModelCapabilities,
  getManagedModel,
  getManagedAiConfig,
  classifyCategory,
} from '../managed'

// Reference images tenants attach to a message (screenshots / mockups). The
// browser downscales + base64-encodes before upload; these caps are the
// server-side backstop against an oversized or malformed payload.
const MAX_IMAGE_ATTACHMENTS = 8
// ~7 MB of base64 ≈ ~5 MB of image bytes. Generous — the client downscales the
// long edge to ~1568px first, so real screenshots land far below this.
const MAX_IMAGE_BASE64_LEN = 7_000_000
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const ImageInputSchema = Type.Object({
  mimeType: Type.String({ minLength: 1 }),
  data: Type.String({ minLength: 1 }), // raw base64, no `data:` URL prefix
})

const ChatRequestBodySchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  // May be empty when the message carries only images — the handler enforces
  // "text or at least one image" below.
  prompt: Type.String(),
  // Optional reference images. Empty/absent for a text-only message.
  images: Type.Optional(Type.Array(ImageInputSchema)),
  // snapshot stays loose here — scope-specific shape; tools cast it inside
  // their handlers. The handler narrows below based on the conversation's
  // scope before passing to the system-prompt builder.
  snapshot: Type.Optional(Type.Unknown()),
})

const VALID_SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']

/**
 * Match `/admin/api/ai/chat/:scope`. Returns `null` if path doesn't match.
 */
export function tryHandleAiChat(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (!pathname.startsWith('/admin/api/ai/chat/')) return null
  const scope = pathname.slice('/admin/api/ai/chat/'.length)
  if (!VALID_SCOPES.includes(scope as ToolScope)) return null
  return handleAiChat(req, db, scope as ToolScope)
}

async function handleAiChat(
  req: Request,
  db: DbClient,
  scope: ToolScope,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }

  // `ai.chat` is the read floor for the conversation endpoint — required
  // for every caller. Write tools are filtered separately below based on
  // the caller's `ai.tools.write` capability so a Client granted chat
  // can use the agent for ideas without it being able to mutate the
  // editor store.
  const userOrResponse = await requireCapability(req, db, 'ai.chat')
  if (userOrResponse instanceof Response) return userOrResponse
  const user = userOrResponse

  const chatBody = await readValidatedBody(req, ChatRequestBodySchema)
  if (!chatBody) return badRequest('Invalid request body.')
  const { conversationId, prompt, snapshot } = chatBody
  const images = chatBody.images ?? []
  const text = prompt.trim()

  // A message needs a body: either text, at least one image, or both.
  if (!text && images.length === 0) {
    return badRequest('Message must include text or at least one image.')
  }
  if (images.length > MAX_IMAGE_ATTACHMENTS) {
    return badRequest(`Too many images — attach at most ${MAX_IMAGE_ATTACHMENTS}.`)
  }
  for (const img of images) {
    if (!ALLOWED_IMAGE_MIME.has(img.mimeType)) {
      return badRequest(`Unsupported image type "${img.mimeType}". Use PNG, JPEG, WebP, or GIF.`)
    }
    if (img.data.length > MAX_IMAGE_BASE64_LEN) {
      return badRequest('One of the images is too large. Attach a smaller screenshot.')
    }
  }

  const conversation = await readConversationForUser(db, user.id, conversationId)
  if (!conversation) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 })
  }
  if (conversation.scope !== scope) {
    return jsonResponse(
      { error: `Conversation scope is "${conversation.scope}", not "${scope}".` },
      { status: 400 },
    )
  }
  // Managed mode: route every chat through the operator's AI Gateway with the
  // operator's fixed model, ignoring any per-conversation credential. Otherwise
  // resolve the user's own credential from the conversation.
  let resolvedCredential
  let providerId
  let modelId: string
  let credentialIdToTouch: string | null
  if (isManagedAiMode()) {
    resolvedCredential = managedResolvedCredential()
    providerId = resolvedCredential.providerId
    modelId = await getManagedModel()
    credentialIdToTouch = null
  } else {
    if (!conversation.credentialId) {
      return jsonResponse(
        { error: 'Conversation has no credential set. Open AI settings to configure a provider.' },
        { status: 400 },
      )
    }

    const credential = await readCredentialForUser(db, user.id, conversation.credentialId)
    if (!credential) {
      return jsonResponse(
        { error: 'Credential not found or no longer accessible.' },
        { status: 404 },
      )
    }
    try {
      resolvedCredential = await resolveCredentialForDriver(credential)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Credential resolution failed.'
      return jsonResponse({ error: message }, { status: 409 })
    }
    providerId = credential.providerId
    modelId = conversation.modelId
    credentialIdToTouch = credential.id
  }

  const driver = resolveDriver(providerId)

  // In managed mode the model is gateway-routed per request, so the OpenRouter
  // driver's sync `capabilities()` can't introspect it — it returns a permissive
  // default with `visionInput: false`. Trust the operator's managed capabilities
  // instead; otherwise every attached reference image is wrongly rejected below,
  // and the tool loop would never capture a screenshot the model can read.
  const modelCapabilities = isManagedAiMode()
    ? managedModelCapabilities()
    : driver.capabilities(modelId)

  // Reject attached images up front when the resolved model can't read them,
  // rather than silently dropping them or letting the provider 400 mid-stream.
  if (images.length > 0 && !modelCapabilities.visionInput) {
    return jsonResponse(
      {
        error:
          'The selected model cannot read images. Choose a vision-capable model, or remove the attachments.',
      },
      { status: 400 },
    )
  }

  // Capability-filtered toolset. Callers without `ai.tools.write` only see
  // read tools registered with the driver — the model has no way to
  // emit a write call. See B6 in the capabilities review.
  const tools = selectToolsForScope(scope, user.capabilities)

  // Append the user's message BEFORE streaming so it's persisted even if
  // the stream aborts mid-response. Images render first, then the text — the
  // order the composer shows them and vision models read best.
  const userContent: AiContentBlock[] = [
    ...images.map((img) => ({
      kind: 'image' as const,
      mimeType: img.mimeType,
      data: img.data,
    })),
    ...(text ? [{ kind: 'text' as const, text }] : []),
  ]
  await appendMessage(db, conversation.id, {
    role: 'user',
    content: userContent,
  })

  const existingMessages = await listMessagesForConversation(db, conversation.id)
  const messages = buildMessageHistory(existingMessages)

  // Managed mode: auto-route this message to the operator's per-task-type model
  // (Design / Content / custom) and inject the operator's global plain-English
  // guidance. Classification is best-effort — a null category tells the gateway
  // to use the operator's default model, so a slow/failed classify never blocks
  // the tenant's chat.
  let managedCategory: string | null = null
  let guidance = ''
  if (isManagedAiMode()) {
    const cfg = await getManagedAiConfig()
    if (cfg) {
      guidance = cfg.guidance
      // Classify off the text only. An image-only message has nothing to
      // classify, so it falls through to the operator's default model.
      if (cfg.hasClassifier && cfg.categories.length > 0 && text) {
        managedCategory = await classifyCategory(text, cfg.categories, req.signal)
      }
    }
  }

  const systemPrompt = buildSystemPromptForScope(scope, snapshot, guidance)

  // Captures the gateway's echo of the model that actually ran, so the audit
  // records the routed model rather than the nominal probe model.
  let resolvedModel: string | null = null
  const onResponseHeaders = (h: Headers): void => {
    const m = h.get('x-instatic-resolved-model')
    if (m) resolvedModel = m
  }

  // Capture totals reported by the persister so the audit row can hold
  // them when the stream completes (we read them off the conversation row
  // diff post-stream — see the post-loop block).
  const tokensAtStart = {
    prompt: conversation.promptTokensTotal,
    completion: conversation.completionTokensTotal,
    cost: conversation.costUsdTotal,
  }

  await createAuditEvent(db, {
    actorUserId: user.id,
    action: 'ai.chat.started',
    targetType: 'ai_conversation',
    targetId: conversation.id,
    metadata: {
      scope,
      providerId,
      modelId,
    },
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false
      let destroyBridge: (() => void) | null = null
      let streamError: string | null = null

      const closeStream = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch { /* already closed */ }
      }
      const emit = (event: AiStreamEvent): void => {
        if (streamClosed) return
        if (event.type === 'error') streamError = event.message
        // Inject the live "context used" count onto each per-round `context`
        // event: the provider-normalised input the model held that round.
        // Drivers report raw token buckets; the handler knows the provider, so
        // it normalises here for the composer meter. (The window is resolved
        // client-side from the model catalogue, so it isn't carried on the
        // wire.) `usage` stays billing-only — the meter is driven by `context`.
        const wireEvent: AiStreamEvent =
          event.type === 'context'
            ? { ...event, contextTokens: normalizeContextTokens(providerId, event) }
            : event
        try {
          controller.enqueue(encodeStreamEvent(wireEvent))
        } catch {
          streamClosed = true
        }
      }

      try {
        // Mutable per-turn context. `snapshot` starts at the value the browser
        // posted with the request and is refreshed in place by the bridge's
        // onSnapshot after each mutating browser tool — so a read tool run
        // later in the same turn sees current state, not stale turn-start state.
        const toolContextBase = {
          db,
          userId: user.id,
          capabilities: user.capabilities,
          scope,
          conversationId: conversation.id,
          snapshot,
        }
        const { bridgeId, bridge, destroy } = createBridge(
          emit,
          req.signal,
          undefined,
          (next) => { toolContextBase.snapshot = next },
        )
        destroyBridge = destroy
        emit({ type: 'bridgeReady', bridgeId })

        const request: AiStreamRequest = {
          systemPrompt,
          // Full conversation history — direct HTTP drivers replay it every
          // turn (there is no server-side session to resume).
          messages,
          tools,
          modelId,
          modelCapabilities,
          credentials: resolvedCredential,
          signal: req.signal,
          bridge,
          toolContextBase,
          ...(isManagedAiMode()
            ? { managedRouting: { categorySlug: managedCategory }, onResponseHeaders }
            : {}),
        }

        const persister = createConversationsPersister(db, conversation.id, {
          providerId,
          // The gateway echoes the actually-routed model (managed mode) on the
          // response headers, captured into `resolvedModel` above. Resolve it
          // lazily so each turn's usage row records the model that really ran,
          // not the conversation's nominal default.
          resolveModelId: () => resolvedModel ?? modelId,
        })
        await runChat({ driver, request, persister, emit })

        // Best-effort: record that this credential was used (managed mode has
        // no DB credential to touch).
        if (credentialIdToTouch) {
          await touchCredentialLastUsed(db, credentialIdToTouch).catch(() => { /* noop */ })
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        // Full Error preserves the stack trace in the operator's terminal.
        console.error('[ai/chat] stream failed:', err)
        streamError = detail
        emit({ type: 'error', message: `AI chat failed: ${detail}` })
      } finally {
        if (destroyBridge) destroyBridge()
        closeStream()
        // Emit the terminal audit event. Re-read the conversation row to
        // capture the deltas the persister just committed.
        try {
          const post = await readConversationForUser(db, user.id, conversation.id)
          const promptDelta = post ? post.promptTokensTotal - tokensAtStart.prompt : 0
          const completionDelta = post ? post.completionTokensTotal - tokensAtStart.completion : 0
          const costDelta = post ? Number((post.costUsdTotal - tokensAtStart.cost).toFixed(6)) : 0
          await createAuditEvent(db, {
            actorUserId: user.id,
            action: streamError ? 'ai.chat.failed' : 'ai.chat.completed',
            targetType: 'ai_conversation',
            targetId: conversation.id,
            metadata: {
              scope,
              providerId,
              // The model the gateway actually ran (managed routing), falling
              // back to the nominal model id when there was no echo.
              modelId: resolvedModel ?? modelId,
              ...(managedCategory ? { aiCategory: managedCategory } : {}),
              promptTokens: promptDelta,
              completionTokens: completionDelta,
              costUsd: costDelta,
              ...(streamError ? { error: streamError.slice(0, 200) } : {}),
            },
          })
        } catch (auditErr) {
          // Audit failures must never break the user-visible stream — the
          // request already finished by the time we hit this branch.
          console.error('[ai/chat] audit emit failed:', auditErr)
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildSystemPromptForScope(
  scope: ToolScope,
  snapshot: unknown,
  guidance = '',
): string[] {
  return withGuidance(buildScopePrompt(scope, snapshot), guidance)
}

function buildScopePrompt(scope: ToolScope, snapshot: unknown): string[] {
  if (scope === 'site') {
    if (snapshot === undefined || snapshot === null) {
      return buildSiteSystemPrompt(emptySiteAgentSnapshot())
    }
    // The snapshot comes straight off the untyped HTTP body — validate it
    // before handing it to the prompt builder, and fall back to an empty
    // snapshot (rather than crashing the stream) when it's malformed.
    const result = safeParseValue(SiteAgentSnapshotSchema, snapshot)
    if (!result.ok) {
      console.error('[ai/chat] invalid site snapshot, using empty fallback:', result.errors)
      return buildSiteSystemPrompt(emptySiteAgentSnapshot())
    }
    return buildSiteSystemPrompt(result.value)
  }
  if (scope === 'content') {
    return buildContentSystemPrompt((snapshot ?? emptyContentSnapshot()) as ContentSnapshot)
  }
  // Other scopes don't have system prompts yet. The driver gets a minimal
  // prompt so the conversation isn't completely contextless.
  return [
    `You are an AI assistant embedded in the "${scope}" workspace of a CMS. ` +
    `No scope-specific tools are wired up yet — respond conversationally only.`,
  ]
}

/**
 * Prepend the operator's global guidance to the STATIC prefix (element 0) of a
 * scope prompt so it stays inside the cacheable region (a 3-element prompt is
 * [prefix, DYNAMIC_BOUNDARY, suffix]; guidance is stable across a conversation
 * so it must live before the boundary, not in the per-request suffix).
 */
function withGuidance(prompt: string[], guidance: string): string[] {
  const text = guidance.trim()
  if (!text || prompt.length === 0) return prompt
  const block = `# Operator guidance\n\n${text}\n\n`
  return [`${block}${prompt[0]}`, ...prompt.slice(1)]
}

function emptySiteAgentSnapshot(): SiteAgentSnapshot {
  return {
    page: {
      id: '',
      title: 'Untitled',
      slug: '',
      rootNodeId: '',
      nodes: {},
    } as SiteAgentSnapshot['page'],
    currentDocument: { type: 'page', id: 'empty' },
    site: {
      pages: [],
      breakpoints: [],
      styleRules: {},
      visualComponents: [],
      settings: { shortcuts: {} },
    } as unknown as SiteAgentSnapshot['site'],
    selectedNodeId: null,
    activeBreakpointId: '',
  }
}

function emptyContentSnapshot(): ContentSnapshot {
  return {
    collections: [],
    activeTableId: null,
    activeDocument: null,
    currentUser: { id: '', displayName: 'Anonymous', email: '' },
  }
}
