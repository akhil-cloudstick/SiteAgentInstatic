/**
 * The inbound half of the data plane — B0.7a-h from the studio's request.
 *
 * They built a 1.68 MB bundle and had no way to hand it over: inline is ~420,000
 * tokens as a tool argument, and `path` resolves on our filesystem, on a share
 * they cannot write to. That also made the agreed recovery mechanism
 * unexecutable — Instatic has no published-version restore, so recovery IS
 * re-importing a known-good bundle, and that was the operation with no route.
 *
 * Numbered against their acceptance IDs so a failure here names the test they
 * will run.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { handleMcpRequest } from '../src/mcp/server'
import {
  UPLOAD_DIR_ENV,
  UPLOAD_TTL_ENV,
  UPLOAD_ROUTE,
  resolveUpload,
  pruneExpiredUploads,
} from '../src/mcp/uploadStore'
import { resolveBundleSource } from '../src/mcp/bundleSource'
import { TOKEN_ENV_VAR } from '../src/mcp/auth'

const TOKEN = 'u'.repeat(48)
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connector-uploads-'))
  process.env[UPLOAD_DIR_ENV] = dir
  process.env[TOKEN_ENV_VAR] = TOKEN
})

afterEach(() => {
  delete process.env[UPLOAD_DIR_ENV]
  delete process.env[UPLOAD_TTL_ENV]
  delete process.env[TOKEN_ENV_VAR]
  rmSync(dir, { recursive: true, force: true })
})

/** A minimal but structurally real site bundle, as a ZIP. */
function bundleZip(options: { pages?: number; withMedia?: boolean } = {}): Uint8Array {
  const rows = Array.from({ length: options.pages ?? 18 }, (_, i) => ({
    id: `page-${i}`,
    tableId: 'pages',
    slug: i === 0 ? 'index' : `about-us-${i}`,
    cells: { title: `Page ${i}`, slug: `about-us-${i}` },
  }))
  const files: Record<string, Uint8Array> = {
    '.instatic/site-bundle.json': new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-09-02T00:00:00.000Z',
        tables: [{ id: 'pages', slug: 'pages' }],
        rows,
        // Archive-shaped media: METADATA, no bytes. The field the preview path
        // has to drop, because a JSON bundle carries bytes here instead.
        media: options.withMedia ? [{ id: 'm1', storagePath: 'logo.png' }] : undefined,
      }),
    ),
  }
  if (options.withMedia) files['media/logo.png'] = new Uint8Array([1, 2, 3, 4])
  return zipSync(files)
}

function bundleJson(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ schemaVersion: 1, exportedAt: '2026-09-02T00:00:00.000Z', tables: [], rows: [] }),
  )
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function upload(body: Uint8Array, init: RequestInit & { query?: string } = {}): Promise<Response | null> {
  const { headers, query, ...rest } = init
  return handleMcpRequest(
    new Request(`http://zaiserver:8787${UPLOAD_ROUTE}${query ?? ''}`, {
      method: 'POST',
      body,
      ...rest,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/zip',
        ...(headers as Record<string, string> | undefined),
      },
    }),
  )
}

async function json(res: Response | null): Promise<Record<string, unknown>> {
  return (await res!.json()) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// B0.7a — the upload itself
// ---------------------------------------------------------------------------

test('B0.7a: a bundle uploads and reports a matching sha256', async () => {
  const bytes = bundleZip()
  const res = await upload(bytes)
  const body = await json(res)

  expect(res!.status).toBe(201)
  expect(body.uploadId).toBeString()
  expect(body.bytes).toBe(bytes.length)
  // Their bar: the hash we report matches the one they computed before sending.
  expect(body.sha256).toBe(sha(bytes))
  expect(body.kind).toBe('zip')
  expect(body.expiresAt).toBeString()
})

test('B0.7a: the uploaded bytes are retrievable byte-for-byte', async () => {
  const bytes = bundleZip()
  const body = await json(await upload(bytes))
  const found = resolveUpload(String(body.uploadId))

  expect(found.ok).toBe(true)
  if (found.ok) {
    expect(found.bytes.length).toBe(bytes.length)
    expect(sha(found.bytes)).toBe(sha(bytes))
  }
})

test('B0.7b: a gzipped upload arrives intact', async () => {
  const bytes = bundleZip()
  const gz = Bun.gzipSync(bytes)
  expect(gz.length).toBeLessThan(bytes.length)

  const res = await upload(gz, { headers: { 'content-encoding': 'gzip' } })
  const body = await json(res)

  // Decompressed by the runtime, so the stored artefact is the ORIGINAL archive
  // — same hash the caller computed over the uncompressed bytes.
  expect(res!.status).toBe(201)
  expect(body.bytes).toBe(bytes.length)
  expect(body.sha256).toBe(sha(bytes))
})

// ---------------------------------------------------------------------------
// B0.7c — the guard
// ---------------------------------------------------------------------------

test('B0.7c: an unauthenticated upload is refused with 401, not 404', async () => {
  const res = await handleMcpRequest(
    new Request(`http://zaiserver:8787${UPLOAD_ROUTE}`, {
      method: 'POST',
      body: bundleZip(),
      headers: { 'content-type': 'application/zip' },
    }),
  )

  // Matching /mcp exactly: a 404 here would read as "the route does not exist"
  // and send them hunting for a routing bug, which is precisely the confusion
  // the export side caused.
  expect(res!.status).toBe(401)
})

test('B0.7c: a wrong token is refused with 401', async () => {
  const res = await upload(bundleZip(), { headers: { authorization: `Bearer ${'x'.repeat(48)}` } })
  expect(res!.status).toBe(401)
})

test('nothing is stored by a refused upload', async () => {
  await upload(bundleZip(), { headers: { authorization: 'Bearer nope' } })
  expect(Array.from(new Bun.Glob('*').scanSync(dir))).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// B0.7g — corruption
// ---------------------------------------------------------------------------

test('B0.7g: a sha256 mismatch is refused and nothing is stored', async () => {
  const res = await upload(bundleZip(), { query: `?sha256=${'0'.repeat(64)}` })
  const body = await json(res)

  expect(res!.status).toBe(422)
  expect(String(body.error)).toContain('sha256 mismatch')
  // Refused BEFORE storing: a corrupt bundle that is kept gets discovered by an
  // import already part-way through replacing a site.
  expect(Array.from(new Bun.Glob('*').scanSync(dir))).toHaveLength(0)
})

test('B0.7g: a matching sha256 is accepted', async () => {
  const bytes = bundleZip()
  const res = await upload(bytes, { query: `?sha256=${sha(bytes)}` })

  expect(res!.status).toBe(201)
})

test('a body that is not a ZIP is refused rather than stored', async () => {
  const res = await upload(new TextEncoder().encode('not a zip at all'))
  const body = await json(res)

  expect(res!.status).toBe(400)
  expect(String(body.error)).toContain('not a ZIP')
})

test('a JSON body declared as JSON is accepted', async () => {
  const res = await upload(bundleJson(), { headers: { 'content-type': 'application/json' } })
  const body = await json(res)

  expect(res!.status).toBe(201)
  expect(body.kind).toBe('json')
})

test('invalid JSON declared as JSON is refused', async () => {
  const res = await upload(new TextEncoder().encode('{ broken'), {
    headers: { 'content-type': 'application/json' },
  })

  expect(res!.status).toBe(400)
})

test('an empty body is refused', async () => {
  const res = await upload(new Uint8Array(0))
  expect(res!.status).toBe(400)
})

test('GET on the upload route is refused with 405', async () => {
  const res = await handleMcpRequest(
    new Request(`http://zaiserver:8787${UPLOAD_ROUTE}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  )
  expect(res!.status).toBe(405)
})

// ---------------------------------------------------------------------------
// B0.7h — expiry and unknown ids
// ---------------------------------------------------------------------------

test('B0.7h: an unknown uploadId is refused with a message naming the cause', () => {
  const found = resolveUpload('upload-doesnotexist.zip')

  expect(found.ok).toBe(false)
  if (!found.ok) {
    expect(found.reason).toContain('No upload named')
    expect(found.reason).toContain('expired')
  }
})

test('B0.7h: an expired uploadId is refused and removed', async () => {
  process.env[UPLOAD_TTL_ENV] = '1000'
  const body = await json(await upload(bundleZip()))
  const id = String(body.uploadId)

  // Age the file rather than waiting, so the test is about the rule and not
  // about elapsed wall-clock time.
  const past = new Date(Date.now() - 60_000)
  utimesSync(join(dir, id), past, past)

  const found = resolveUpload(id)
  expect(found.ok).toBe(false)
  if (!found.ok) expect(found.reason).toContain('expired')
  expect(existsSync(join(dir, id))).toBe(false)
})

test('pruning removes expired uploads and keeps live ones', async () => {
  process.env[UPLOAD_TTL_ENV] = '1000'
  const stale = await json(await upload(bundleZip({ pages: 1 })))
  const fresh = await json(await upload(bundleZip({ pages: 2 })))

  const past = new Date(Date.now() - 60_000)
  utimesSync(join(dir, String(stale.uploadId)), past, past)

  expect(pruneExpiredUploads()).toBe(1)
  expect(existsSync(join(dir, String(stale.uploadId)))).toBe(false)
  expect(existsSync(join(dir, String(fresh.uploadId)))).toBe(true)
})

test('a traversal attempt on uploadId is refused', () => {
  for (const bad of ['../../etc/passwd', 'a/b.zip', '/etc/passwd', '..']) {
    const found = resolveUpload(bad)
    expect(found.ok).toBe(false)
  }
})

// ---------------------------------------------------------------------------
// B0.7d / B0.7f — naming an upload from the tools
// ---------------------------------------------------------------------------

test('B0.7d: an uploaded ZIP resolves to a previewable bundle', async () => {
  const body = await json(await upload(bundleZip({ pages: 18 })))
  const source = resolveBundleSource({ uploadId: String(body.uploadId) })

  expect(source.ok).toBe(true)
  if (source.ok) {
    const bundle = source.value.bundle as { rows: unknown[] }
    expect(bundle.rows).toHaveLength(18)
    expect(source.value.archive).toBeDefined()
    expect(source.value.source).toContain('upload')
  }
})

test('B0.7d: archive-shaped media metadata is dropped from the previewable bundle', async () => {
  const body = await json(await upload(bundleZip({ withMedia: true })))
  const source = resolveBundleSource({ uploadId: String(body.uploadId) })

  expect(source.ok).toBe(true)
  if (source.ok) {
    // In an archive `media` is metadata and the bytes are separate entries; a
    // JSON bundle carries the bytes inline. Passing one shape where the other
    // is expected fails the dry run for a reason unrelated to the content.
    expect((source.value.bundle as Record<string, unknown>).media).toBeUndefined()
    // Counted from the entries instead, so the number is visible not hidden.
    expect(source.value.mediaFilesInArchive).toBe(1)
  }
})

test('an uploaded JSON bundle resolves without an archive', async () => {
  const body = await json(await upload(bundleJson(), { headers: { 'content-type': 'application/json' } }))
  const source = resolveBundleSource({ uploadId: String(body.uploadId) })

  expect(source.ok).toBe(true)
  if (source.ok) {
    expect(source.value.archive).toBeUndefined()
    expect((source.value.bundle as { schemaVersion: number }).schemaVersion).toBe(1)
  }
})

test('exactly one source is required', () => {
  expect(resolveBundleSource({}).ok).toBe(false)
  expect(resolveBundleSource({ bundle: {}, uploadId: 'x.zip' }).ok).toBe(false)
  expect(resolveBundleSource({ bundle: {}, path: '/tmp/x.zip' }).ok).toBe(false)

  const none = resolveBundleSource({})
  if (!none.ok) expect(none.reason).toContain('exactly one')
})

test('a ZIP with no manifest is refused with a message naming the cause', async () => {
  const notABundle = zipSync({ 'readme.txt': new TextEncoder().encode('hello') })
  const body = await json(await upload(notABundle))
  const source = resolveBundleSource({ uploadId: String(body.uploadId) })

  expect(source.ok).toBe(false)
  if (!source.ok) expect(source.reason).toContain('site bundle')
})

test('the same bytes uploaded twice do not accumulate copies', async () => {
  const bytes = bundleZip()
  const first = await json(await upload(bytes))
  const second = await json(await upload(bytes))

  // A caller retrying after a timeout should not litter the directory with
  // whole copies of a client site.
  expect(second.uploadId).toBe(first.uploadId)
  expect(Array.from(new Bun.Glob('*.zip').scanSync(dir))).toHaveLength(1)
})
