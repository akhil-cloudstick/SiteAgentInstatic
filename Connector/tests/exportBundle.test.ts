/**
 * Regressions from the studio's first real acceptance run.
 *
 * B0.6d is the one that matters most: we reported "part 2 without exportId is
 * refused" as verified state, having written the code but never made that exact
 * call. They made it, three times, and it minted a fresh archive every time.
 * Each test here corresponds to a measured failure, not a hypothesised one.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { WRITE_TOOLS } from '../src/mcp/writeTools'
import { EXPORT_DIR_ENV, resolveExport, exportDir } from '../src/mcp/exportStore'
import { TARGETS_ENV } from '../src/http/config'
import { connect, disconnect } from '../src/http/store'
import { withRequestContext } from '../src/mcp/requestContext'

const exportTool = WRITE_TOOLS.find((t) => t.name === 'connector_export_bundle')!

let dir: string
const realFetch = globalThis.fetch

/** How many times a real export was taken. The whole point of B0.6d. */
let exportCalls = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connector-exports-'))
  process.env[EXPORT_DIR_ENV] = dir
  process.env[TARGETS_ENV] = JSON.stringify({
    acme: { url: 'http://127.0.0.1:7301', email: 'owner@acme.test', secret: 'pw' },
  })
  exportCalls = 0
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  delete process.env[EXPORT_DIR_ENV]
  delete process.env[TARGETS_ENV]
  rmSync(dir, { recursive: true, force: true })
})

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

/**
 * Stand in for a live CMS: login succeeds, and /export returns an archive whose
 * size is caller-chosen so multi-part behaviour can be exercised without
 * building a 40 MB fixture.
 */
function stubCms(options: { bytes?: number; withMedia?: boolean } = {}): void {
  const size = options.bytes ?? 1_000
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/export')) {
      exportCalls++
      const files: Record<string, Uint8Array> = {
        '.instatic/site-bundle.json': new TextEncoder().encode(
          JSON.stringify({ rows: [], padding: 'x'.repeat(size) }),
        ),
      }
      if (options.withMedia) files['media/logo.png'] = new Uint8Array([1, 2, 3, 4])
      return new Response(zipSync(files), { status: 200 })
    }
    return new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'instatic_admin_session=s; Path=/; HttpOnly' },
    })
  }) as typeof fetch
}

/** Stub the CMS and open the session every export tool call requires. */
async function readyCms(options: { bytes?: number; withMedia?: boolean } = {}): Promise<void> {
  stubCms(options)
  await connect('acme')
}

// ---------------------------------------------------------------------------
// B0.6d — the guard has to run BEFORE the export
// ---------------------------------------------------------------------------

test('B0.6d: part 2 with no exportId is refused, and takes no export (inline)', async () => {
  await readyCms()
  const res = await exportTool.handler({ target: 'acme', part: 2 })

  expect(res.isError).toBe(true)
  expect(parse(res).error).toContain('needs the exportId')
  // The measured bug: it refused only after minting a fresh archive.
  expect(exportCalls).toBe(0)
})

test('B0.6d: part 2 with no exportId is refused on the path route too', async () => {
  await readyCms()
  // `deliver: "path"` returned before the guard was ever reached, so this call
  // silently produced a whole new archive and reported success.
  const res = await exportTool.handler({ target: 'acme', part: 2, deliver: 'path' })

  expect(res.isError).toBe(true)
  expect(parse(res).error).toContain('needs the exportId')
  expect(exportCalls).toBe(0)
})

test('B0.6d: the refusal names the missing exportId, not a range', async () => {
  await readyCms()
  // A single-part archive used to hit the range check first, so the message
  // blamed the part number and hid the real cause.
  const res = await exportTool.handler({ target: 'acme', part: 2 })
  const error = String(parse(res).error)

  expect(error).toContain('exportId')
  expect(error).not.toContain('out of range')
})

test('B0.6d: no archive file is written by a refused call', async () => {
  await readyCms()
  await exportTool.handler({ target: 'acme', part: 2, deliver: 'path' })

  expect(existsSync(exportDir())).toBe(true)
  expect(Array.from(new Bun.Glob('*.zip').scanSync(dir))).toHaveLength(0)
})

test('part 1 needs no exportId and still exports normally', async () => {
  await readyCms()
  const res = await exportTool.handler({ target: 'acme', part: 1, deliver: 'path' })

  expect(res.isError).toBeUndefined()
  expect(exportCalls).toBe(1)
})

// ---------------------------------------------------------------------------
// Continuation — the mechanism the studio confirmed was sound
// ---------------------------------------------------------------------------

test('a valid exportId serves the same archive without re-exporting', async () => {
  await readyCms()
  const first = parse(await exportTool.handler({ target: 'acme', deliver: 'path' }))
  expect(exportCalls).toBe(1)

  const again = parse(
    await exportTool.handler({ exportId: String(first.exportId), part: 1, deliver: 'path' }),
  )

  expect(again.exportId).toBe(first.exportId)
  expect(again.bytes).toBe(first.bytes)
  expect(exportCalls).toBe(1) // served from disk
})

test('B0.6e: a traversal attempt on exportId is refused', async () => {
  await readyCms()
  const res = await exportTool.handler({ exportId: '../../../../etc/passwd', part: 1 })

  expect(res.isError).toBe(true)
  expect(String(parse(res).error)).toContain('not allowed in a file name')
  expect(exportCalls).toBe(0)
})

test('an unknown exportId is refused rather than silently re-exporting', async () => {
  await readyCms()
  const res = await exportTool.handler({ exportId: 'no-such-export.zip', part: 1 })

  expect(res.isError).toBe(true)
  expect(String(parse(res).error)).toContain('is on disk')
  expect(exportCalls).toBe(0)
})

// ---------------------------------------------------------------------------
// includeMedia must describe the ARCHIVE, not the request
// ---------------------------------------------------------------------------

test('a continuation read reports includeMedia from the archive, not the default', async () => {
  await readyCms({ withMedia: false })
  const first = parse(
    await exportTool.handler({ target: 'acme', includeMedia: false, deliver: 'path' }),
  )
  expect(first.includeMedia).toBe(false)

  // The measured bug: re-reading it with includeMedia omitted echoed the
  // parameter default (true) for an archive taken with false.
  const again = parse(
    await exportTool.handler({ exportId: String(first.exportId), deliver: 'path' }),
  )

  expect(again.includeMedia).toBe(false)
  expect(again.includeMediaSource).toBe('read from the archive contents')
})

test('a continuation read reports includeMedia true when media is present', async () => {
  await readyCms({ withMedia: true })
  const first = parse(await exportTool.handler({ target: 'acme', deliver: 'path' }))

  const again = parse(
    await exportTool.handler({ exportId: String(first.exportId), includeMedia: false, deliver: 'path' }),
  )

  // includeMedia is ignored on a continuation, so `false` here must not win
  // over what the archive actually holds.
  expect(again.includeMedia).toBe(true)
})

// ---------------------------------------------------------------------------
// The archive has to be fetchable by whoever asked for it
// ---------------------------------------------------------------------------

test('the response carries a downloadUrl addressed to the calling host', async () => {
  await readyCms()
  const res = await withRequestContext(
    new Request('http://zaiserver:8787/mcp', { headers: { host: 'zaiserver:8787' } }),
    () => exportTool.handler({ target: 'acme', deliver: 'path' }),
  )
  const body = parse(await res)

  // Addressed to the caller, not to this host: inline base64 cannot carry a
  // 40 MB archive through an agent's context, and the on-disk path names a
  // share the caller cannot mount.
  expect(body.downloadUrl).toBe(`http://zaiserver:8787/exports/${body.exportId}`)
})

test('the downloadUrl carries the gateway mount prefix', async () => {
  await readyCms()
  const req = new Request('http://127.0.0.1:8787/mcp', {
    headers: {
      'x-forwarded-host': 'siteagent.tailbbb0d2.ts.net',
      'x-forwarded-proto': 'https',
      'x-forwarded-prefix': '/connector-mcp',
    },
  })
  const body = parse(await withRequestContext(req, () => exportTool.handler({ target: 'acme', deliver: 'path' })))

  // The measured 404: the host was right and the prefix was missing, so the URL
  // named a real archive at a path the gateway does not route. The gateway
  // strips `/connector-mcp` and forwards the rest, so this is the form that
  // arrives here as `/exports/<id>`.
  expect(body.downloadUrl).toBe(
    `https://siteagent.tailbbb0d2.ts.net/connector-mcp/exports/${body.exportId}`,
  )
})

test('the downloadUrl actually resolves to the archive that was just written', async () => {
  await readyCms()
  const req = new Request('http://zaiserver:8787/mcp')
  const body = parse(await withRequestContext(req, () => exportTool.handler({ target: 'acme', deliver: 'path' })))

  // Round-trip: the URL the tool handed out is one the route will serve.
  const path = new URL(String(body.downloadUrl)).pathname
  const found = resolveExport(decodeURIComponent(path.replace('/exports/', '')))

  expect(found.ok).toBe(true)
})

test('outside a request there is no host to address, so downloadUrl is absent', async () => {
  await readyCms()
  const body = parse(await exportTool.handler({ target: 'acme', deliver: 'path' }))

  // Better absent than pointing at a loopback address that fails from the
  // caller's machine and reads as "your server is down".
  expect(body.downloadUrl).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Path safety, independent of the tool
// ---------------------------------------------------------------------------

test('resolveExport refuses separators, traversal and absolute paths', () => {
  for (const bad of ['../secrets.zip', 'a/b.zip', '/etc/passwd', 'C:\\windows\\win.ini', '..']) {
    expect(resolveExport(bad).ok).toBe(false)
  }
})

test('resolveExport accepts a real archive in the export directory', () => {
  writeFileSync(join(dir, 'site-bundle-acme-2026-09-02T10-00-00.zip'), 'zip')
  const found = resolveExport('site-bundle-acme-2026-09-02T10-00-00.zip')

  expect(found.ok).toBe(true)
})
