/**
 * Managed AI mode — gateway URL enables it; the model is read LIVE from the
 * gateway (no restart), with the env value as an offline fallback.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import {
  isManagedAiMode,
  getGatewayUrl,
  getManagedModel,
  managedResolvedCredential,
  managedCredentialView,
  managedDefaultsMap,
  managedModelList,
  MANAGED_CREDENTIAL_ID,
  __resetManagedModelCache,
} from './managed'

const GATEWAY = 'http://127.0.0.1:4000/ai/tok.abc/v1'
const MODEL = 'moonshotai/kimi-k2.6'

function setEnv(url?: string, model?: string) {
  if (url === undefined) delete process.env.INSTATIC_AI_GATEWAY_URL
  else process.env.INSTATIC_AI_GATEWAY_URL = url
  if (model === undefined) delete process.env.INSTATIC_AI_MODEL
  else process.env.INSTATIC_AI_MODEL = model
}

const realFetch = globalThis.fetch
afterEach(() => {
  setEnv(undefined, undefined)
  globalThis.fetch = realFetch
  __resetManagedModelCache()
})

describe('managed AI mode', () => {
  it('is enabled by the gateway URL alone', () => {
    setEnv(undefined)
    expect(isManagedAiMode()).toBe(false)
    setEnv(GATEWAY)
    expect(isManagedAiMode()).toBe(true)
    expect(getGatewayUrl()).toBe(GATEWAY)
  })

  it('resolves an openrouter credential pointing at the gateway (no real key)', () => {
    setEnv(GATEWAY)
    const cred = managedResolvedCredential()
    expect(cred.providerId).toBe('openrouter')
    expect(cred.authMode).toBe('apiKey')
    expect(cred.baseUrl).toBe(GATEWAY)
    expect(cred.apiKey).toBeTruthy() // placeholder, never the operator's key
  })

  it('reads the model live from the gateway /model probe', async () => {
    setEnv(GATEWAY, 'stale-env-model')
    globalThis.fetch = (async (url: string) => {
      expect(String(url)).toBe('http://127.0.0.1:4000/ai/tok.abc/model')
      return new Response(JSON.stringify({ model: MODEL }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await getManagedModel()).toBe(MODEL)
  })

  it('falls back to the env model when the gateway probe fails', async () => {
    setEnv(GATEWAY, 'fallback-model')
    globalThis.fetch = (async () => { throw new Error('unreachable') }) as unknown as typeof fetch
    expect(await getManagedModel()).toBe('fallback-model')
  })

  it('surfaces exactly one credential + one model + a default per scope', () => {
    setEnv(GATEWAY)
    expect(managedCredentialView().id).toBe(MANAGED_CREDENTIAL_ID)
    expect(managedModelList(MODEL).map((m) => m.id)).toEqual([MODEL])
    const defaults = managedDefaultsMap(MODEL)
    for (const scope of ['site', 'content', 'data', 'plugin']) {
      expect(defaults[scope]).toEqual({ credentialId: MANAGED_CREDENTIAL_ID, modelId: MODEL })
    }
  })
})
