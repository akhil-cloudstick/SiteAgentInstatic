/**
 * Managed-mode vision routing.
 *
 * The tenant classifies a prompt on its TEXT alone, so "rewrite this heading"
 * lands in the Content category even when the heading is supposed to be read
 * off an attached screenshot — and the Content model is typically text-only.
 * The chat handler therefore flags any request carrying an image and the
 * OpenRouter driver forwards that as `x-instatic-ai-vision`, which the AI
 * Gateway resolves to the Design (multimodal) model regardless of category.
 */
import { describe, test, expect, afterEach } from 'bun:test'
import { openrouterDriver } from '../../../server/ai/drivers/openrouter'
import type { AiStreamRequest } from '../../../server/ai/drivers/types'
import type { AiBrowserBridge, AiStreamEvent, AiMessage } from '../../../server/ai/runtime/types'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const DONE = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 1 } } })}\n\n`

function sseResponse(): Response {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(DONE))
        controller.close()
      },
    }),
    { status: 200 },
  )
}

const bridge: AiBrowserBridge = { async callBrowser() { return { ok: true } } }

function makeRequest(
  messages: AiMessage[],
  managedRouting: { categorySlug: string | null; requiresVision: boolean },
): AiStreamRequest {
  return {
    systemPrompt: ['You are a test.'],
    messages,
    tools: [],
    modelId: 'router',
    modelCapabilities: { toolCalling: true, visionInput: true, toolResultImages: false, promptCache: false, streaming: true },
    credentials: {
      id: 'managed',
      providerId: 'openrouter',
      authMode: 'apiKey',
      apiKey: 'sk-test',
      baseUrl: 'http://127.0.0.1:9/ai/token/v1',
    },
    signal: new AbortController().signal,
    bridge,
    toolContextBase: { db: {} as never, userId: 'u1', scope: 'site', conversationId: 'c1', snapshot: {} },
    managedRouting,
  }
}

async function headersFor(req: AiStreamRequest): Promise<Record<string, string>> {
  let sent: Record<string, string> = {}
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = init.headers as Record<string, string>
    return sseResponse()
  }) as typeof fetch
  const events: AiStreamEvent[] = []
  for await (const event of openrouterDriver.stream(req)) events.push(event)
  return sent
}

describe('managed vision routing headers', () => {
  test('flags an image-carrying request so the gateway overrides the text category', async () => {
    const headers = await headersFor(makeRequest(
      [{
        role: 'user',
        content: [
          { kind: 'text', text: 'Use the headings from this screenshot' },
          { kind: 'image', mimeType: 'image/png', data: 'iVBOR' },
        ],
      }],
      { categorySlug: 'content', requiresVision: true },
    ))

    // Both travel: the gateway prefers vision, but the classified category is
    // still logged so the operator can see what the text alone resolved to.
    expect(headers['x-instatic-ai-vision']).toBe('1')
    expect(headers['x-instatic-ai-category']).toBe('content')
  })

  test('leaves a text-only request on its classified category', async () => {
    const headers = await headersFor(makeRequest(
      [{ role: 'user', content: [{ kind: 'text', text: 'Rewrite this heading' }] }],
      { categorySlug: 'content', requiresVision: false },
    ))

    expect(headers['x-instatic-ai-vision']).toBeUndefined()
    expect(headers['x-instatic-ai-category']).toBe('content')
  })
})
