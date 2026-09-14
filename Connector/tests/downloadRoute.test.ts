/**
 * The archive needs an address the caller can actually reach.
 *
 * Every URL this server produced was written from its own point of view —
 * loopback hosts and paths on a share the caller cannot mount — which the
 * studio hit three separate times: the export path, the invite link, and the
 * ports they probed and found closed. The fix is to build outbound URLs from
 * the inbound request, so whatever address reached us round-trips back.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMcpRequest } from '../src/mcp/server'
import { EXPORT_DIR_ENV, EXPORT_DOWNLOAD_PREFIX } from '../src/mcp/exportStore'
import { originOf, prefixOf, callerRootUrl, reachableFrom, withRequestContext, PUBLIC_URL_ENV } from '../src/mcp/requestContext'
import { TOKEN_ENV_VAR } from '../src/mcp/auth'

const TOKEN = 'a'.repeat(48)
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connector-download-'))
  process.env[EXPORT_DIR_ENV] = dir
  process.env[TOKEN_ENV_VAR] = TOKEN
})

afterEach(() => {
  delete process.env[EXPORT_DIR_ENV]
  delete process.env[TOKEN_ENV_VAR]
  delete process.env[PUBLIC_URL_ENV]
  rmSync(dir, { recursive: true, force: true })
})

function seedArchive(name = 'site-bundle-acme-2026-09-02T10-00-00.zip', body = 'PK-not-really'): string {
  writeFileSync(join(dir, name), body)
  return name
}

function request(path: string, init: RequestInit = {}): Request {
  // Headers MERGED, not replaced: spreading init over a headers default silently
  // drops the bearer token and every test then asserts against a 401.
  const { headers, ...rest } = init
  return new Request(`http://zaiserver:8787${path}`, {
    ...rest,
    headers: { authorization: `Bearer ${TOKEN}`, ...(headers as Record<string, string> | undefined) },
  })
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

test('an archive can be fetched whole, with the bearer token', async () => {
  const name = seedArchive()
  const res = await handleMcpRequest(request(`${EXPORT_DOWNLOAD_PREFIX}${name}`))

  expect(res).not.toBeNull()
  expect(res!.status).toBe(200)
  expect(res!.headers.get('content-type')).toBe('application/zip')
  expect(await res!.text()).toBe('PK-not-really')
})

test('the download refuses an unauthenticated caller', async () => {
  const name = seedArchive()
  const res = await handleMcpRequest(
    new Request(`http://zaiserver:8787${EXPORT_DOWNLOAD_PREFIX}${name}`),
  )

  // The archive is a whole copy of a site's content, so it is exactly as
  // sensitive as the tools that produced it.
  expect(res!.status).toBe(401)
})

test('the download refuses a wrong token', async () => {
  const name = seedArchive()
  const res = await handleMcpRequest(
    new Request(`http://zaiserver:8787${EXPORT_DOWNLOAD_PREFIX}${name}`, {
      headers: { authorization: `Bearer ${'b'.repeat(48)}` },
    }),
  )

  expect(res!.status).toBe(401)
})

test('a traversal attempt on the download path is refused', async () => {
  const res = await handleMcpRequest(request(`${EXPORT_DOWNLOAD_PREFIX}..%2F..%2Fetc%2Fpasswd`))

  expect(res!.status).toBe(400)
  expect(await res!.text()).toContain('not allowed in a file name')
})

test('an unknown archive is a 404, not a 500', async () => {
  const res = await handleMcpRequest(request(`${EXPORT_DOWNLOAD_PREFIX}no-such.zip`))

  expect(res!.status).toBe(404)
})

test('HEAD reports the size without transferring the archive', async () => {
  const name = seedArchive('sized.zip', 'x'.repeat(1234))
  const res = await handleMcpRequest(request(`${EXPORT_DOWNLOAD_PREFIX}${name}`, { method: 'HEAD' }))

  expect(res!.status).toBe(200)
  expect(res!.headers.get('content-length')).toBe('1234')
  expect(await res!.text()).toBe('')
})

test('an unrelated path is still not ours', async () => {
  expect(await handleMcpRequest(request('/nothing-here'))).toBeNull()
})

test('the archive is gzipped on the wire when the caller accepts it', async () => {
  // The archive is a STORED zip, so its manifest ships uncompressed — 39.5 MB
  // on a real site that deflates to 7.5 MB. Transport compression collects that
  // without changing the format import has always parsed.
  const name = seedArchive('compressible.zip', 'a'.repeat(50_000))
  const res = await handleMcpRequest(
    request(`${EXPORT_DOWNLOAD_PREFIX}${name}`, { headers: { 'accept-encoding': 'gzip' } }),
  )

  expect(res!.status).toBe(200)
  expect(res!.headers.get('content-encoding')).toBe('gzip')
  expect(res!.headers.get('x-archive-bytes')).toBe('50000')

  // Decoded here by hand because this Response was built in-process; over a
  // real connection an HTTP client unwraps content-encoding itself. What
  // matters is that it round-trips to the exact archive bytes, and that the
  // transfer was genuinely smaller.
  const wire = await res!.arrayBuffer()
  expect(wire.byteLength).toBeLessThan(50_000)

  const decoded = await new Response(
    new Response(wire).body!.pipeThrough(new DecompressionStream('gzip')),
  ).text()
  expect(decoded.length).toBe(50_000)
})

test('a caller that does not accept gzip gets the raw archive and a length', async () => {
  const name = seedArchive('plain.zip', 'a'.repeat(50_000))
  const res = await handleMcpRequest(
    request(`${EXPORT_DOWNLOAD_PREFIX}${name}`, { headers: { 'accept-encoding': 'identity' } }),
  )

  expect(res!.headers.get('content-encoding')).toBeNull()
  expect(res!.headers.get('content-length')).toBe('50000')
})

// ---------------------------------------------------------------------------
// Deriving the caller-facing address
// ---------------------------------------------------------------------------

test('the origin comes from the request host, not the listener', () => {
  expect(originOf(request('/mcp'))).toBe('http://zaiserver:8787')
})

test('a proxy that rewrites Host is honoured', () => {
  const req = new Request('http://127.0.0.1:8787/mcp', {
    headers: { 'x-forwarded-host': 'mms.tailnet.ts.net', 'x-forwarded-proto': 'https' },
  })

  expect(originOf(req)).toBe('https://mms.tailnet.ts.net')
})

test('only the first forwarded host is used', () => {
  // The rest were appended by hops further out; naming one of those would send
  // the caller somewhere we do not serve.
  const req = new Request('http://127.0.0.1:8787/mcp', {
    headers: { 'x-forwarded-host': 'mms.tailnet.ts.net, evil.example' },
  })

  expect(originOf(req)).toBe('http://mms.tailnet.ts.net')
})

test('an explicit public URL overrides the derivation', () => {
  process.env[PUBLIC_URL_ENV] = 'https://cms.example.com/'

  expect(originOf(request('/mcp'))).toBe('https://cms.example.com')
})

// ---------------------------------------------------------------------------
// The mount prefix — getting the host right was not enough
// ---------------------------------------------------------------------------

test('the mount prefix is taken from the proxy that stripped it', () => {
  const req = new Request('http://127.0.0.1:8787/mcp', {
    headers: { 'x-forwarded-prefix': '/connector-mcp' },
  })

  expect(prefixOf(req)).toBe('/connector-mcp')
})

test('a direct caller has no prefix', () => {
  expect(prefixOf(request('/mcp'))).toBe('')
})

test('the prefix is normalised, and a bare slash counts as none', () => {
  const withPrefix = (value: string) =>
    prefixOf(new Request('http://x/mcp', { headers: { 'x-forwarded-prefix': value } }))

  expect(withPrefix('connector-mcp')).toBe('/connector-mcp')
  expect(withPrefix('/connector-mcp/')).toBe('/connector-mcp')
  expect(withPrefix('/')).toBe('')
  expect(withPrefix('')).toBe('')
})

test('the caller root joins origin and prefix', () => {
  const req = new Request('http://127.0.0.1:8787/mcp', {
    headers: {
      'x-forwarded-host': 'siteagent.tailbbb0d2.ts.net',
      'x-forwarded-proto': 'https',
      'x-forwarded-prefix': '/connector-mcp',
    },
  })

  // The exact shape the studio measured as a 404 — it named a real archive at
  // an address the gateway does not route, because the prefix was missing.
  expect(withRequestContext(req, () => callerRootUrl())).toBe(
    'https://siteagent.tailbbb0d2.ts.net/connector-mcp',
  )
})

test('the download route still answers on the path the prefixed URL resolves to', async () => {
  // The gateway strips `/connector-mcp` and forwards the rest, so a caller
  // fetching `<root>/exports/<id>` arrives here as `/exports/<id>`. This is the
  // half we serve; the prefix is what makes the caller's half reach us.
  const name = seedArchive('prefixed.zip', 'archive')
  const res = await handleMcpRequest(
    request(`${EXPORT_DOWNLOAD_PREFIX}${name}`, {
      headers: { 'x-forwarded-prefix': '/connector-mcp' },
    }),
  )

  expect(res!.status).toBe(200)
  expect(await res!.text()).toBe('archive')
})

// ---------------------------------------------------------------------------
// Rewriting URLs the control plane minted against loopback
// ---------------------------------------------------------------------------

test('a loopback invite URL is re-addressed to the caller host, keeping its port', () => {
  const rewritten = withRequestContext(request('/mcp'), () =>
    reachableFrom('http://127.0.0.1:4400/invite/abc123'),
  )

  // Port preserved: the control plane is a different service on a different
  // port, so only the host is wrong.
  expect(rewritten).toBe('http://zaiserver:4400/invite/abc123')
})

test('a URL that is already public is left alone', () => {
  const url = 'https://console.example.com/invite/abc123'
  expect(withRequestContext(request('/mcp'), () => reachableFrom(url))).toBe(url)
})

test('outside a request there is nothing to rewrite to, so the URL is unchanged', () => {
  const url = 'http://127.0.0.1:4400/invite/abc123'
  expect(reachableFrom(url)).toBe(url)
})
