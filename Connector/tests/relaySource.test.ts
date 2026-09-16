/**
 * Importing straight from a relay artefact: the caller names only a sha256, and
 * the Connector fetches the bytes from the configured relay itself.
 *
 * The relay is trusted for transport, never for content — every test that
 * refuses also checks nothing was stored, and the tamper test checks that bytes
 * which do not hash to the requested sha256 are never used.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { resolveBundleSourceWithRelay } from '../src/mcp/bundleSource'
import { RELAY_TOKEN_FILE_ENV, RELAY_URL_ENV } from '../src/http/relay'
import { UPLOAD_DIR_ENV } from '../src/mcp/uploadStore'
import { IMPORT_TOOLS } from '../src/mcp/importTools'
import type { ToolResult } from '../src/mcp/tools'
import { connect, disconnect } from '../src/http/store'
import { TARGETS_ENV } from '../src/http/config'
import { GO_POLICY_ENV } from '../src/go/policy'
import { GO_LEDGER_ENV } from '../src/go/ledger'

const RELAY = 'https://relay.test'
const TOKEN_ID = 'builder-token-id.access'
const TOKEN_SECRET = 'builder-token-secret-value'

const realFetch = globalThis.fetch
let dir = ''
let uploads = ''
let artefacts = new Map<string, Uint8Array>()
let relayCalls: { path: string; id: string | null; secret: string | null }[] = []
let cmsCalls: string[] = []
let relayMode: 'normal' | 'login-redirect' | 'tampered' = 'normal'

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
/** What the upload store holds — an empty list when nothing was ever stored and the directory does not exist. */
const held = (): string[] => {
  try {
    return readdirSync(uploads)
  } catch {
    return []
  }
}

function bundleZip(title = 'Home'): Uint8Array {
  return zipSync({
    '.instatic/site-bundle.json': strToU8(
      JSON.stringify({ schemaVersion: 1, tables: [{ id: 'pages' }], rows: [{ id: 'p1', tableId: 'pages', slug: 'index', cells: { title } }] }),
    ),
    'media/logo.png': new Uint8Array([1, 2, 3, 4]),
  })
}

function onRelay(bytes: Uint8Array): string {
  const hash = sha(bytes)
  artefacts.set(hash, bytes)
  return hash
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'connector-relay-source-'))
  uploads = join(dir, 'uploads')
  process.env[UPLOAD_DIR_ENV] = uploads
  process.env[RELAY_URL_ENV] = RELAY
  process.env[RELAY_TOKEN_FILE_ENV] = join(dir, 'relay-token.txt')
  writeFileSync(process.env[RELAY_TOKEN_FILE_ENV]!, `CF-Access-Client-Id: ${TOKEN_ID}\nCF-Access-Client-Secret: ${TOKEN_SECRET}\n`)
  process.env[GO_POLICY_ENV] = join(dir, 'go-policy.json')
  process.env[GO_LEDGER_ENV] = join(dir, 'go-ledger.jsonl')
  writeFileSync(process.env[GO_POLICY_ENV]!, JSON.stringify({ ownerPublicKey: '', ungated: ['staging'] }))
  process.env[TARGETS_ENV] = JSON.stringify({ staging: { url: 'http://staging.test', email: 's@example.test', secret: 'pw' } })

  artefacts = new Map()
  relayCalls = []
  cmsCalls = []
  relayMode = 'normal'

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)
    if (url.origin === RELAY) {
      relayCalls.push({ path: url.pathname, id: headers.get('CF-Access-Client-Id'), secret: headers.get('CF-Access-Client-Secret') })
      if (relayMode === 'login-redirect') {
        return new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/login' } })
      }
      const hash = url.pathname.split('/').pop() ?? ''
      const bytes = artefacts.get(hash)
      if (!bytes) return new Response('{"error":"No such artefact."}', { status: 404 })
      return new Response(relayMode === 'tampered' ? strToU8('{"rows":["swapped in transit"]}') : bytes, { status: 200 })
    }
    if (url.pathname.endsWith('/login')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=test; Path=/; HttpOnly' } })
    }
    cmsCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  await connect('staging')
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  for (const name of [UPLOAD_DIR_ENV, RELAY_URL_ENV, RELAY_TOKEN_FILE_ENV, GO_POLICY_ENV, GO_LEDGER_ENV, TARGETS_ENV]) {
    delete process.env[name]
  }
  rmSync(dir, { recursive: true, force: true })
})

test('a relay artefact is fetched with the token, verified, and resolved like an upload', async () => {
  const bytes = bundleZip()
  const hash = onRelay(bytes)

  const source = await resolveBundleSourceWithRelay({ relaySha256: hash })
  expect(source.ok).toBe(true)
  if (!source.ok) return
  expect(source.value.sha256).toBe(hash)
  expect(source.value.mediaFilesInArchive).toBe(1)
  expect(source.value.source).toContain(`relay artefact ${hash} (fetched from the relay`)
  expect(relayCalls).toEqual([{ path: `/api/artefacts/${hash}`, id: TOKEN_ID, secret: TOKEN_SECRET }])
})

test('a preview and the import after it fetch the artefact once', async () => {
  const hash = onRelay(bundleZip())
  await resolveBundleSourceWithRelay({ relaySha256: hash })
  const second = await resolveBundleSourceWithRelay({ relaySha256: hash.toUpperCase() })
  expect(second.ok && second.value.source).toContain('already held')
  expect(relayCalls).toHaveLength(1)
})

test('a JSON bundle artefact resolves as JSON', async () => {
  const bytes = strToU8(JSON.stringify({ schemaVersion: 1, tables: [], rows: [] }))
  const source = await resolveBundleSourceWithRelay({ relaySha256: onRelay(bytes) })
  expect(source.ok).toBe(true)
  if (source.ok) expect(source.value.archive).toBeUndefined()
})

test('bytes that do not hash to the requested sha256 are refused and never stored', async () => {
  const hash = onRelay(bundleZip())
  relayMode = 'tampered'
  const source = await resolveBundleSourceWithRelay({ relaySha256: hash })
  expect(source.ok).toBe(false)
  if (!source.ok) expect(source.reason).toMatch(/hash to [0-9a-f]{64}, not [0-9a-f]{64}\. They were not used/)
  expect(held()).toEqual([])
})

test('an artefact the relay does not hold is refused with the fix named', async () => {
  const source = await resolveBundleSourceWithRelay({ relaySha256: 'c'.repeat(64) })
  expect(source.ok).toBe(false)
  if (!source.ok) expect(source.reason).toMatch(/holds no artefact with sha256 c{64}\. Upload the bundle to the relay first/)
})

test('a token the relay login rejects is reported as such', async () => {
  const hash = onRelay(bundleZip())
  relayMode = 'login-redirect'
  const source = await resolveBundleSourceWithRelay({ relaySha256: hash })
  expect(source.ok).toBe(false)
  if (!source.ok) expect(source.reason).toMatch(/login did not accept the Connector's token/)
})

test('malformed hashes, a second source, or a missing token file are refused without contacting the relay', async () => {
  const hash = onRelay(bundleZip())

  const bad = await resolveBundleSourceWithRelay({ relaySha256: 'not-a-hash' })
  expect(bad.ok).toBe(false)

  const two = await resolveBundleSourceWithRelay({ relaySha256: hash, uploadId: 'upload-0000000000000000.zip' })
  expect(two.ok).toBe(false)
  if (!two.ok) expect(two.reason).toMatch(/exactly one of bundle, uploadId, path or relaySha256/)

  rmSync(process.env[RELAY_TOKEN_FILE_ENV]!)
  const noToken = await resolveBundleSourceWithRelay({ relaySha256: hash })
  expect(noToken.ok).toBe(false)
  if (!noToken.ok) expect(noToken.reason).toMatch(/has no relay token/)

  expect(relayCalls).toEqual([])
})

test('connector_import_replace imports straight from a relay artefact by sha256', async () => {
  const hash = onRelay(bundleZip('Imported from the relay'))
  const tool = IMPORT_TOOLS.find((t) => t.name === 'connector_import_replace')!
  const r: ToolResult = await tool.handler({ target: 'staging', confirm: 'REPLACE staging', relaySha256: hash })
  expect(r.isError).toBeUndefined()
  const body = JSON.parse(r.content[0]!.text) as { preview: { sha256: string; bundleSource: string; mediaFilesInArchive: number } }
  expect(body.preview).toMatchObject({ sha256: hash, mediaFilesInArchive: 1 })
  expect(body.preview.bundleSource).toContain(`relay artefact ${hash}`)
  expect(cmsCalls).toEqual(['POST /cms/api/cms/import/preview', 'POST /cms/api/cms/import/archive'])
  expect(relayCalls).toHaveLength(1)
})
