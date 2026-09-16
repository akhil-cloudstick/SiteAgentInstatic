/**
 * The owner-signed GO gate on every deploy-class Connector tool.
 *
 * Every refusal is asserted on its side effect — the calls that reached the
 * CMS — and not only on its message. That is the B0.6d lesson: a guard in the
 * wrong place still produces the right refusal, after the damage is done.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { connect, disconnect } from '../src/http/store'
import { DEFAULT_TARGET_ENV, TARGETS_ENV } from '../src/http/config'
import { saveUpload, UPLOAD_DIR_ENV } from '../src/mcp/uploadStore'
import { IMPORT_TOOLS } from '../src/mcp/importTools'
import { CRUD_TOOLS } from '../src/mcp/crudTools'
import { ADMIN_TOOLS } from '../src/mcp/adminTools'
import type { ToolResult } from '../src/mcp/tools'
import { goMessage, parseGo, type Go } from '../src/go/message'
import { GO_POLICY_ENV, ownerKeyFromBase64 } from '../src/go/policy'
import { GO_LEDGER_ENV } from '../src/go/ledger'
import { verifyGoSignature } from '../src/go/verify'

interface Vectors {
  owner: { seedHex: string; publicKey: string; fingerprint: string }
  other: { seedHex: string; publicKey: string; fingerprint: string }
  cases: { name: string; message?: string; go: Go; valid: boolean }[]
}
const VECTORS = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../docs/relay/go-test-vectors.json'), 'utf8'),
) as Vectors

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const keyFromSeed = (seedHex: string): KeyObject =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
const OWNER = keyFromSeed(VECTORS.owner.seedHex)
const OTHER = keyFromSeed(VECTORS.other.seedHex)

const API = '/cms/api/cms'
const IMPORT_PATH = `${API}/import`
const PREVIEW_PATH = `${API}/import/preview`
const ARCHIVE_PATH = `${API}/import/archive`
const PUBLISH_PATH = `${API}/publish`
const STATUS_PATH = `${API}/publish/status`

interface FixtureRow {
  id: string
  tableId: string
  slug: string
  cells: Record<string, unknown>
  status: string
  authorUserId: string | null
}

const realFetch = globalThis.fetch
let dir = ''
let cmsCalls: string[] = []
let failImport = false
let rows = new Map<string, FixtureRow>()
/** Stands in for the CMS draft site; its sha256 plays the draft site hash. */
let draftSite = 'draft site v1'
/** Simulates an editor change still in flight, which the CMS flushes in at publish time. */
let editWhilePublishing = false

const hashOf = (s: string): string => createHash('sha256').update(s).digest('hex')
const writes = (): string[] => cmsCalls.filter((c) => !c.startsWith('GET '))

function writePolicy(policy: unknown): void {
  writeFileSync(process.env[GO_POLICY_ENV]!, typeof policy === 'string' ? policy : JSON.stringify(policy))
}

function article(id: string, title: string): FixtureRow {
  return { id, tableId: 'news', slug: id, cells: { title, body: `<p>${title}</p>` }, status: 'draft', authorUserId: null }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'go-gate-'))
  process.env[GO_POLICY_ENV] = join(dir, 'go-policy.json')
  process.env[GO_LEDGER_ENV] = join(dir, 'go-ledger.jsonl')
  process.env[UPLOAD_DIR_ENV] = join(dir, 'uploads')
  process.env[TARGETS_ENV] = JSON.stringify({
    alpha: { url: 'http://alpha.test', email: 'a@example.test', secret: 'pw' },
    beta: { url: 'http://beta.test', email: 'b@example.test', secret: 'pw' },
    'alpha-staging': { url: 'http://staging.test', email: 's@example.test', secret: 'pw' },
  })
  writePolicy({ ownerPublicKey: VECTORS.owner.publicKey, ungated: ['alpha-staging'] })

  failImport = false
  editWhilePublishing = false
  draftSite = 'draft site v1'
  cmsCalls = []
  rows = new Map([
    ['news-1', article('news-1', 'First article')],
    ['news-2', article('news-2', 'Second article')],
  ])
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname.endsWith('/login')) {
      return new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'instatic_admin_session=test; Path=/; HttpOnly' },
      })
    }
    const call = `${method} ${url.pathname}`
    cmsCalls.push(call)

    if (method === 'GET' && url.pathname === STATUS_PATH) {
      return new Response(JSON.stringify({ draftMatchesPublished: false, draftSiteHash: hashOf(draftSite) }), { status: 200 })
    }
    if (method === 'POST' && url.pathname === PUBLISH_PATH) {
      if (editWhilePublishing) draftSite = 'edited while the publish flushed'
      const ifMatch = new Headers(init?.headers).get('if-match')?.replace(/"/g, '')
      if (ifMatch && ifMatch !== hashOf(draftSite)) {
        return new Response(JSON.stringify({ error: 'The draft site has changed since the expected hash was taken.' }), {
          status: 412,
        })
      }
      return new Response(JSON.stringify({ publishedPages: 1 }), { status: 200 })
    }
    const rowRead = /\/data\/rows\/([^/]+)$/.exec(url.pathname)
    if (method === 'GET' && rowRead) {
      const row = rows.get(decodeURIComponent(rowRead[1]!))
      return row ? new Response(JSON.stringify(row), { status: 200 }) : new Response('{"error":"not found"}', { status: 404 })
    }
    if (failImport && url.pathname === IMPORT_PATH) return new Response('{"error":"boom"}', { status: 500 })
    return new Response(JSON.stringify({ ok: true, call }), { status: 200 })
  }) as typeof fetch

  for (const target of ['alpha', 'beta', 'alpha-staging']) await connect(target)
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  for (const name of [GO_POLICY_ENV, GO_LEDGER_ENV, UPLOAD_DIR_ENV, TARGETS_ENV, DEFAULT_TARGET_ENV]) {
    delete process.env[name]
  }
  rmSync(dir, { recursive: true, force: true })
})

function tool(name: string) {
  const found = [...IMPORT_TOOLS, ...CRUD_TOOLS, ...ADMIN_TOOLS].find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}
const call = (name: string, args: Record<string, unknown>) => tool(name).handler(args)
const importReplace = (args: Record<string, unknown>) => call('connector_import_replace', args)
const publishSite = (args: Record<string, unknown>) => call('connector_publish_site', args)
const replaceAlpha = (extra: Record<string, unknown>) => importReplace({ target: 'alpha', confirm: 'REPLACE alpha', ...extra })

const parse = (r: ToolResult): Record<string, any> => JSON.parse(r.content[0]!.text) as Record<string, any>
function refusal(r: ToolResult): string {
  expect(r.isError).toBe(true)
  return String(parse(r).error)
}

function upload(content: unknown = { site: { name: 'fixture' }, pages: [] }): { uploadId: string; sha256: string } {
  const saved = saveUpload(new TextEncoder().encode(JSON.stringify(content)), 'json')
  if (!saved.ok) throw new Error(saved.reason)
  return { uploadId: saved.upload.uploadId, sha256: saved.upload.sha256 }
}

function uploadZip(): { uploadId: string; sha256: string } {
  const zip = zipSync({ '.instatic/site-bundle.json': strToU8(JSON.stringify({ site: { name: 'zip' }, pages: [] })) })
  const saved = saveUpload(zip, 'zip')
  if (!saved.ok) throw new Error(saved.reason)
  return { uploadId: saved.upload.uploadId, sha256: saved.upload.sha256 }
}

function signGo(fields: Partial<Omit<Go, 'signature'>>, key: KeyObject = OWNER): Go {
  const full: Omit<Go, 'signature'> = {
    ticketId: 'DR-000001',
    action: 'import',
    target: 'alpha',
    sha256: '0'.repeat(64),
    contentDigest: '-',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: randomBytes(18).toString('base64url'),
    ...fields,
  }
  return { ...full, signature: sign(null, Buffer.from(goMessage(full), 'utf8'), key).toString('base64') }
}

/** A site-publish GO for the bundle `sha256`, bound to the draft as it is right now. */
const publishGo = (sha256: string, extra: Partial<Omit<Go, 'signature'>> = {}) =>
  signGo({ ticketId: 'DR-000002', action: 'publish', sha256, contentDigest: hashOf(draftSite), ...extra })

async function importUnderGo(): Promise<string> {
  const { uploadId, sha256 } = upload()
  const imported = await replaceAlpha({ uploadId, go: signGo({ sha256 }) })
  expect(imported.isError).toBeUndefined()
  cmsCalls = []
  return sha256
}

async function digestOf(rowIds: string[]): Promise<string> {
  const r = await call('connector_rows_digest', { target: 'alpha', rowIds })
  expect(r.isError).toBeUndefined()
  cmsCalls = []
  return String(parse(r).digest)
}

test('the Connector verifies the shared vectors exactly as the relay does', () => {
  const owner = ownerKeyFromBase64(VECTORS.owner.publicKey)
  expect(owner).toBeDefined()
  for (const c of VECTORS.cases) {
    expect({ name: c.name, valid: verifyGoSignature(c.go, owner!.key) }).toEqual({ name: c.name, valid: c.valid })
    if (c.message) expect(goMessage(c.go)).toBe(c.message)
    if (c.valid) expect(parseGo(c.go).ok).toBe(true)
  }
})

test('no GO on a gated target — every deploy-class tool refuses, nothing sent to the CMS', async () => {
  const json = upload()
  const zip = uploadZip()
  const refusals = [
    [await replaceAlpha({ uploadId: json.uploadId }), 'import'],
    [await call('connector_import_archive', { target: 'alpha', uploadId: zip.uploadId, strategy: 'merge-add' }), 'merge-add'],
    [await publishSite({ target: 'alpha' }), 'publish'],
    [await call('connector_publish_row', { target: 'alpha', rowId: 'news-1' }), 'publish-row'],
    [await call('connector_publish_rows', { target: 'alpha', rowIds: ['news-1', 'news-2'] }), 'publish-row'],
    [await call('connector_set_row_status', { target: 'alpha', rowId: 'news-1', status: 'unpublished' }), 'set-status-unpublished'],
    [await call('connector_delete_row', { target: 'alpha', rowId: 'news-1' }), 'delete'],
    [await call('connector_delete_rows', { target: 'alpha', rowIds: ['news-1'], confirm: 'DELETE 1 FROM alpha' }), 'delete'],
  ] as const
  for (const [result, action] of refusals) {
    expect(refusal(result)).toContain(`needs an owner-signed GO for "${action}"`)
  }
  expect(cmsCalls).toEqual([])
})

test('a garbled signature, or one by another key — refused, nothing sent', async () => {
  const { uploadId, sha256 } = upload()
  const garbled = { ...signGo({ sha256 }), signature: `${'A'.repeat(86)}==` }
  expect(refusal(await replaceAlpha({ uploadId, go: garbled }))).toMatch(/does not verify/)
  expect(refusal(await replaceAlpha({ uploadId, go: signGo({ sha256 }, OTHER) }))).toMatch(/does not verify/)
  expect(cmsCalls).toEqual([])
})

test('a GO for one action cannot be spent on another', async () => {
  const { uploadId, sha256 } = upload()
  const asPublish = await replaceAlpha({ uploadId, go: signGo({ sha256, action: 'publish', contentDigest: 'c'.repeat(64) }) })
  expect(refusal(asPublish)).toMatch(/authorizes "publish"/)

  const zip = uploadZip()
  const mergeAdd = signGo({ sha256: zip.sha256, action: 'merge-add' })
  const overwrite = await call('connector_import_archive', { target: 'alpha', uploadId: zip.uploadId, strategy: 'merge-overwrite', go: mergeAdd })
  expect(refusal(overwrite)).toMatch(/authorizes "merge-add" and this call is "merge-overwrite"/)

  const draftGo = signGo({ action: 'set-status-draft', sha256: '0'.repeat(64) })
  const unpublish = await call('connector_set_row_status', { target: 'alpha', rowId: 'news-1', status: 'unpublished', go: draftGo })
  expect(refusal(unpublish)).toMatch(/authorizes "set-status-draft"/)
  expect(cmsCalls).toEqual([])
})

test('the GO binds the RESOLVED target — an omitted target that defaults elsewhere is refused', async () => {
  process.env[DEFAULT_TARGET_ENV] = 'beta'
  const { uploadId, sha256 } = upload()
  const r = await importReplace({ confirm: 'REPLACE ', uploadId, go: signGo({ sha256, target: 'alpha' }) })
  expect(refusal(r)).toMatch(/is for target "alpha" and this call would write to "beta"/)
  expect(cmsCalls).toEqual([])
})

test('an expired GO — refused, nothing sent', async () => {
  const { uploadId, sha256 } = upload()
  const go = signGo({ sha256, expiresAt: new Date(Date.now() - 1_000).toISOString() })
  expect(refusal(await replaceAlpha({ uploadId, go }))).toMatch(/expired/)
  expect(cmsCalls).toEqual([])
})

test('a GO for other bytes — refused, nothing sent', async () => {
  const { uploadId } = upload()
  expect(refusal(await replaceAlpha({ uploadId, go: signGo({ sha256: '1'.repeat(64) }) }))).toMatch(
    /the GO was signed for 1{64}/,
  )
  expect(cmsCalls).toEqual([])
})

test('an inline bundle cannot be bound to a GO on a gated target', async () => {
  const r = await replaceAlpha({ bundle: { site: {}, pages: [] }, go: signGo({}) })
  expect(refusal(r)).toMatch(/inline bundle cannot be bound/)
  expect(cmsCalls).toEqual([])
})

test('a missing policy file refuses everything; an unreadable one refuses staging too', async () => {
  const { uploadId, sha256 } = upload()
  rmSync(process.env[GO_POLICY_ENV]!)
  expect(refusal(await replaceAlpha({ uploadId, go: signGo({ sha256 }) }))).toMatch(/No GO policy/)

  writePolicy('{ "ungated": ["alpha-staging"], ')
  const staging = await importReplace({ target: 'alpha-staging', confirm: 'REPLACE alpha-staging', uploadId })
  expect(refusal(staging)).toMatch(/not readable JSON/)
  expect(cmsCalls).toEqual([])
})

test('a corrupted ledger refuses rather than forgetting which GOs were spent', async () => {
  const { uploadId, sha256 } = upload()
  writeFileSync(process.env[GO_LEDGER_ENV]!, 'not json\n')
  expect(refusal(await replaceAlpha({ uploadId, go: signGo({ sha256 }) }))).toMatch(/ledger .* unreadable/)
  expect(cmsCalls).toEqual([])
})

test('import then publish under GO — runs, reports the GO, and each GO works once', async () => {
  const { uploadId, sha256 } = upload()
  const importGo = signGo({ sha256 })

  const imported = await replaceAlpha({ uploadId, go: importGo })
  expect(imported.isError).toBeUndefined()
  expect(parse(imported).go).toEqual({
    ticketId: 'DR-000001',
    nonce: importGo.nonce,
    ownerKeyFingerprint: VECTORS.owner.fingerprint,
  })
  expect(cmsCalls).toEqual([`POST ${PREVIEW_PATH}`, `POST ${IMPORT_PATH}`])

  expect(refusal(await replaceAlpha({ uploadId, go: importGo }))).toMatch(/already been used/)
  expect(cmsCalls).toHaveLength(2)

  const go = publishGo(sha256)
  const published = await publishSite({ target: 'alpha', go })
  expect(published.isError).toBeUndefined()
  expect(parse(published).go.nonce).toBe(go.nonce)
  expect(cmsCalls).toEqual([`POST ${PREVIEW_PATH}`, `POST ${IMPORT_PATH}`, `GET ${STATUS_PATH}`, `POST ${PUBLISH_PATH}`])
})

test('a merge import under GO is what a following publish GO binds to', async () => {
  const zip = uploadZip()
  const merged = await call('connector_import_archive', {
    target: 'alpha',
    uploadId: zip.uploadId,
    strategy: 'merge-overwrite',
    go: signGo({ action: 'merge-overwrite', sha256: zip.sha256 }),
  })
  expect(merged.isError).toBeUndefined()
  expect(cmsCalls).toEqual([`POST ${ARCHIVE_PATH}`])

  const published = await publishSite({ target: 'alpha', go: publishGo(zip.sha256) })
  expect(published.isError).toBeUndefined()
})

test('a publish GO must name the artefact the last import under GO landed', async () => {
  const { uploadId, sha256 } = upload()
  expect(refusal(await publishSite({ target: 'alpha', go: publishGo(sha256) }))).toMatch(/no artefact for a publish GO/)

  await replaceAlpha({ uploadId, go: signGo({ sha256 }) })
  const wrong = await publishSite({ target: 'alpha', go: publishGo('2'.repeat(64)) })
  expect(refusal(wrong)).toMatch(/this publish GO names 2{64}/)
  expect(cmsCalls.filter((c) => c.endsWith(PUBLISH_PATH))).toEqual([])
})

test('a site-publish GO binds the draft — a draft edited after signing is refused before publishing', async () => {
  const sha256 = await importUnderGo()
  const go = publishGo(sha256)

  draftSite = 'draft site v1, edited after the owner signed'
  const refused = await publishSite({ target: 'alpha', go })
  expect(refusal(refused)).toMatch(/draft site as it is now hashes to .*The draft changed after it was signed/)
  expect(writes()).toEqual([])
})

test('an edit still in flight when the CMS publishes is refused by the CMS itself, and the GO is spent', async () => {
  const sha256 = await importUnderGo()
  const go = publishGo(sha256)

  editWhilePublishing = true
  const refused = await publishSite({ target: 'alpha', go })
  expect(refusal(refused)).toMatch(/HTTP 412/)
  const ledger = readFileSync(process.env[GO_LEDGER_ENV]!, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(ledger.at(-1)).toMatchObject({ type: 'outcome', nonce: go.nonce, outcome: 'failed' })

  editWhilePublishing = false
  expect(refusal(await publishSite({ target: 'alpha', go }))).toMatch(/already been used/)
})

test('connector_site_digest reports exactly the two values a publish GO must name', async () => {
  const before = parse(await call('connector_site_digest', { target: 'alpha' }))
  expect(before).toMatchObject({ target: 'alpha', sha256: null, contentDigest: hashOf(draftSite), lastImportUnderGo: null })

  const sha256 = await importUnderGo()
  const after = parse(await call('connector_site_digest', { target: 'alpha' }))
  expect(after).toMatchObject({ sha256, contentDigest: hashOf(draftSite), lastImportUnderGo: { ticketId: 'DR-000001', action: 'import' } })

  const go = publishGo(after.sha256, { contentDigest: after.contentDigest })
  expect((await publishSite({ target: 'alpha', go })).isError).toBeUndefined()
})

test('a row GO binds exactly its rows and their content — reads them, never writes on a mismatch', async () => {
  const digest = await digestOf(['news-1'])
  const go = () => signGo({ action: 'publish-row', sha256: digest })

  const otherRow = await call('connector_publish_row', { target: 'alpha', rowId: 'news-2', go: go() })
  expect(refusal(otherRow)).toMatch(/the GO was signed for/)
  expect(writes()).toEqual([])

  rows.get('news-1')!.cells.title = 'First article, edited after signing'
  const edited = await call('connector_publish_row', { target: 'alpha', rowId: 'news-1', go: go() })
  expect(refusal(edited)).toMatch(/changed after it was signed/)
  expect(writes()).toEqual([])

  rows.set('news-1', article('news-1', 'First article'))
  const published = await call('connector_publish_row', { target: 'alpha', rowId: 'news-1', go: go() })
  expect(published.isError).toBeUndefined()
  expect(parse(published).go.ownerKeyFingerprint).toBe(VECTORS.owner.fingerprint)
  expect(writes()).toEqual([`POST ${API}/data/rows/news-1/publish`])
})

test('publish_rows: one GO publishes the whole set, and nothing outside it', async () => {
  const digest = await digestOf(['news-1', 'news-2'])
  const go = signGo({ action: 'publish-row', sha256: digest })

  const subset = await call('connector_publish_rows', { target: 'alpha', rowIds: ['news-2'], go })
  expect(refusal(subset)).toMatch(/the GO was signed for/)
  expect(writes()).toEqual([])

  const all = await call('connector_publish_rows', { target: 'alpha', rowIds: ['news-2', 'news-1'], go })
  expect(all.isError).toBeUndefined()
  expect(parse(all).result).toMatchObject({ requested: 2, published: 2, failed: [] })
  expect(writes()).toEqual([`POST ${API}/data/rows/news-2/publish`, `POST ${API}/data/rows/news-1/publish`])
  expect(refusal(await call('connector_publish_rows', { target: 'alpha', rowIds: ['news-1', 'news-2'], go }))).toMatch(
    /already been used/,
  )
})

test('delete_rows: one GO binds the whole set, in any order, and nothing outside it', async () => {
  const digest = await digestOf(['news-1', 'news-2'])
  const go = signGo({ action: 'delete', sha256: digest })

  const subset = await call('connector_delete_rows', { target: 'alpha', rowIds: ['news-1'], confirm: 'DELETE 1 FROM alpha', go })
  expect(refusal(subset)).toMatch(/the GO was signed for/)
  expect(writes()).toEqual([])

  const all = await call('connector_delete_rows', { target: 'alpha', rowIds: ['news-2', 'news-1'], confirm: 'DELETE 2 FROM alpha', go })
  expect(all.isError).toBeUndefined()
  expect(parse(all).result).toMatchObject({ requested: 2, deleted: 2 })
  expect(writes()).toEqual([`DELETE ${API}/data/rows/news-2`, `DELETE ${API}/data/rows/news-1`])
})

test('set_row_status under a matching GO runs once', async () => {
  const digest = await digestOf(['news-2'])
  const go = signGo({ action: 'set-status-unpublished', sha256: digest })
  const first = await call('connector_set_row_status', { target: 'alpha', rowId: 'news-2', status: 'unpublished', go })
  expect(first.isError).toBeUndefined()
  expect(refusal(await call('connector_set_row_status', { target: 'alpha', rowId: 'news-2', status: 'unpublished', go }))).toMatch(
    /already been used/,
  )
  expect(writes()).toEqual([`PATCH ${API}/data/rows/news-2/status`])
})

test('a GO spent on a failed import cannot run again, and nothing may publish after the failure', async () => {
  const { uploadId, sha256 } = upload()
  const go = signGo({ sha256 })

  failImport = true
  expect(refusal(await replaceAlpha({ uploadId, go }))).toMatch(/HTTP 500/)
  expect(cmsCalls).toEqual([`POST ${PREVIEW_PATH}`, `POST ${IMPORT_PATH}`])
  const ledger = readFileSync(process.env[GO_LEDGER_ENV]!, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(ledger.map((e) => (e.type === 'spend' ? 'spend' : e.outcome))).toEqual(['spend', 'failed'])

  failImport = false
  expect(refusal(await replaceAlpha({ uploadId, go }))).toMatch(/already been used/)
  expect(refusal(await publishSite({ target: 'alpha', go: publishGo(sha256) }))).toMatch(/did not succeed/)
  expect(cmsCalls).toHaveLength(2)
})

test('two concurrent calls carrying one GO — exactly one imports', async () => {
  const { uploadId, sha256 } = upload()
  const go = signGo({ sha256 })
  const results = await Promise.all([replaceAlpha({ uploadId, go }), replaceAlpha({ uploadId, go })])
  expect(results.filter((r) => !r.isError)).toHaveLength(1)
  expect(refusal(results.find((r) => r.isError)!)).toMatch(/used by another call first/)
  expect(cmsCalls.filter((c) => c === `POST ${IMPORT_PATH}`)).toHaveLength(1)
})

test('an ungated staging target needs no GO and keeps its original responses', async () => {
  const { uploadId } = upload()
  const imported = await importReplace({ target: 'alpha-staging', confirm: 'REPLACE alpha-staging', uploadId })
  expect(imported.isError).toBeUndefined()
  expect(parse(imported).go).toBeUndefined()

  const published = await publishSite({ target: 'alpha-staging' })
  expect(parse(published)).toEqual({ publishedPages: 1 })

  const row = await call('connector_publish_row', { target: 'alpha-staging', rowId: 'news-1' })
  expect(parse(row)).toEqual({ ok: true, call: `POST ${API}/data/rows/news-1/publish` })
  expect(cmsCalls).toEqual([`POST ${PREVIEW_PATH}`, `POST ${IMPORT_PATH}`, `POST ${PUBLISH_PATH}`, `POST ${API}/data/rows/news-1/publish`])
})

test('a dry run needs no GO, writes nothing, and says what the gate would decide', async () => {
  const { uploadId, sha256 } = upload()
  const r = await replaceAlpha({ uploadId, previewOnly: true })
  expect(r.isError).toBeUndefined()
  const body = parse(r)
  expect(body.previewOnly).toBe(true)
  expect(body.preview.sha256).toBe(sha256)
  expect(body.go).toMatchObject({ required: true, wouldPass: false })
  expect(cmsCalls).toEqual([`POST ${PREVIEW_PATH}`])
})
