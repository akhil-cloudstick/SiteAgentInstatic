/**
 * `connector_upload_bundle_part` — a bundle uploaded in base64 parts through
 * tool calls, `connector_export_bundle` in reverse, for a caller that can send
 * arguments but not an HTTP request.
 *
 * Refusals are asserted on the upload directory, not only on the message: a
 * refused call must leave nothing behind.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { IMPORT_TOOLS } from '../src/mcp/importTools'
import type { ToolResult } from '../src/mcp/tools'
import { resolveBundleSource } from '../src/mcp/bundleSource'
import { UPLOAD_DIR_ENV, UPLOAD_PART_MAX_BYTES, UPLOAD_TTL_ENV, resolveUpload } from '../src/mcp/uploadStore'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connector-upload-parts-'))
  process.env[UPLOAD_DIR_ENV] = dir
})

afterEach(() => {
  delete process.env[UPLOAD_DIR_ENV]
  delete process.env[UPLOAD_TTL_ENV]
  rmSync(dir, { recursive: true, force: true })
})

const tool = IMPORT_TOOLS.find((t) => t.name === 'connector_upload_bundle_part')!
const send = (args: Record<string, unknown>) => tool.handler(args)
const parse = (r: ToolResult): Record<string, any> => JSON.parse(r.content[0]!.text) as Record<string, any>
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const stored = (): string[] => readdirSync(dir)

function refusal(r: ToolResult): string {
  expect(r.isError).toBe(true)
  return String(parse(r).error)
}

function split(bytes: Uint8Array, parts: number): string[] {
  const size = Math.ceil(bytes.length / parts)
  return Array.from({ length: parts }, (_, i) =>
    Buffer.from(bytes.subarray(i * size, (i + 1) * size)).toString('base64'),
  )
}

function bundleZip(): Uint8Array {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `page-${i}`,
    tableId: 'pages',
    slug: `page-${i}`,
    cells: { title: `Page ${i}`, body: `<p>${'content '.repeat(40)}</p>` },
  }))
  return zipSync({
    '.instatic/site-bundle.json': strToU8(JSON.stringify({ schemaVersion: 1, tables: [{ id: 'pages' }], rows })),
    'media/logo.png': new Uint8Array([1, 2, 3, 4]),
  })
}

test('a ZIP bundle sent in parts, out of order, becomes one upload an import can name', async () => {
  const bytes = bundleZip()
  const hash = sha(bytes)
  const parts = split(bytes, 3)

  const third = parse(await send({ sha256: hash, parts: 3, part: 3, data: parts[2] }))
  expect(third).toMatchObject({ done: false, parts: 3, received: 1, missing: [1, 2] })
  const first = parse(await send({ sha256: hash, parts: 3, part: 1, data: parts[0] }))
  expect(first).toMatchObject({ done: false, missing: [2] })

  const last = parse(await send({ sha256: hash, parts: 3, part: 2, data: parts[1] }))
  expect(last).toMatchObject({ done: true, kind: 'zip', bytes: bytes.length, sha256: hash, parts: 3 })

  const found = resolveUpload(last.uploadId)
  expect(found.ok).toBe(true)
  if (found.ok) expect(sha(found.bytes)).toBe(hash)

  const source = resolveBundleSource({ uploadId: last.uploadId })
  expect(source.ok).toBe(true)
  if (source.ok) {
    expect(source.value.sha256).toBe(hash)
    expect(source.value.mediaFilesInArchive).toBe(1)
  }
  // The part set is gone once the bundle is stored.
  expect(existsSync(join(dir, '.parts', `${hash}-3`))).toBe(false)
})

test('a JSON bundle in parts is stored as JSON', async () => {
  const bytes = strToU8(JSON.stringify({ schemaVersion: 1, tables: [], rows: [{ id: 'r1', cells: { body: 'x'.repeat(500) } }] }))
  const hash = sha(bytes)
  const parts = split(bytes, 2)
  await send({ sha256: hash, parts: 2, part: 1, data: parts[0], kind: 'json' })
  const done = parse(await send({ sha256: hash, parts: 2, part: 2, data: parts[1], kind: 'json' }))
  expect(done).toMatchObject({ done: true, kind: 'json', sha256: hash })
})

test('a single-part upload completes in one call', async () => {
  const bytes = bundleZip()
  const done = parse(await send({ sha256: sha(bytes), parts: 1, part: 1, data: Buffer.from(bytes).toString('base64') }))
  expect(done).toMatchObject({ done: true, kind: 'zip' })
})

test('malformed arguments are refused before anything is written', async () => {
  const data = Buffer.from(bundleZip()).toString('base64')
  const hash = sha(bundleZip())
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['sha256 not hex', { sha256: 'not-a-hash', parts: 1, part: 1, data }, /64-hex sha256 of the WHOLE bundle/],
    ['parts zero', { sha256: hash, parts: 0, part: 1, data }, /parts must be a whole number/],
    ['part beyond parts', { sha256: hash, parts: 2, part: 3, data }, /part must be a whole number from 1 to 2/],
    ['part not a whole number', { sha256: hash, parts: 2, part: 1.5, data }, /part must be a whole number/],
    ['data not base64', { sha256: hash, parts: 1, part: 1, data: 'not base64!' }, /standard base64/],
    ['data empty', { sha256: hash, parts: 1, part: 1, data: '' }, /standard base64/],
  ]
  for (const [name, args, message] of cases) {
    expect({ name, error: refusal(await send(args)) }).toMatchObject({ name, error: expect.stringMatching(message) })
  }
  expect(stored()).toEqual([])
})

test('a part over the size limit is refused and nothing is written', async () => {
  const big = new Uint8Array(UPLOAD_PART_MAX_BYTES + 1)
  const r = await send({ sha256: 'a'.repeat(64), parts: 2, part: 1, data: Buffer.from(big).toString('base64') })
  expect(refusal(r)).toMatch(/limit is \d+ per part/)
  expect(stored()).toEqual([])
})

test('a resent part is accepted; different bytes under the same part number are refused', async () => {
  const bytes = bundleZip()
  const hash = sha(bytes)
  const parts = split(bytes, 2)

  await send({ sha256: hash, parts: 2, part: 1, data: parts[0] })
  const resend = parse(await send({ sha256: hash, parts: 2, part: 1, data: parts[0] }))
  expect(resend).toMatchObject({ done: false, received: 1, missing: [2] })

  const different = await send({ sha256: hash, parts: 2, part: 1, data: Buffer.from('other bytes').toString('base64') })
  expect(refusal(different)).toMatch(/already received with different bytes/)

  const done = parse(await send({ sha256: hash, parts: 2, part: 2, data: parts[1] }))
  expect(done).toMatchObject({ done: true, sha256: hash })
})

test('parts that do not reassemble to the sha256 are discarded and nothing is stored', async () => {
  const bytes = bundleZip()
  const parts = split(bytes, 2)
  const wrongHash = 'b'.repeat(64)
  await send({ sha256: wrongHash, parts: 2, part: 1, data: parts[0] })
  const r = await send({ sha256: wrongHash, parts: 2, part: 2, data: parts[1] })
  expect(refusal(r)).toMatch(/reassemble to sha256 [0-9a-f]{64}, not b{64}/)
  expect(stored().filter((f) => f !== '.parts')).toEqual([])
  expect(existsSync(join(dir, '.parts', `${wrongHash}-2`))).toBe(false)
})

test('bytes that are neither ZIP nor JSON, or not the declared kind, are refused', async () => {
  const text = strToU8('this is not a bundle')
  const notBundle = await send({ sha256: sha(text), parts: 1, part: 1, data: Buffer.from(text).toString('base64') })
  expect(refusal(notBundle)).toMatch(/neither a ZIP archive nor JSON/)

  const zip = bundleZip()
  const wrongKind = await send({ sha256: sha(zip), parts: 1, part: 1, data: Buffer.from(zip).toString('base64'), kind: 'json' })
  expect(refusal(wrongKind)).toMatch(/kind says json, but the reassembled bytes are zip/)
  expect(stored().filter((f) => f !== '.parts')).toEqual([])
})

test('an incomplete part set older than the retention period is discarded', async () => {
  process.env[UPLOAD_TTL_ENV] = '60000'
  const bytes = bundleZip()
  const hash = sha(bytes)
  const parts = split(bytes, 2)

  await send({ sha256: hash, parts: 2, part: 1, data: parts[0] })
  const setDir = join(dir, '.parts', `${hash}-2`)
  const old = new Date(Date.now() - 120_000)
  utimesSync(setDir, old, old)

  const after = parse(await send({ sha256: hash, parts: 2, part: 2, data: parts[1] }))
  expect(after).toMatchObject({ done: false, received: 1, missing: [1] })
})
