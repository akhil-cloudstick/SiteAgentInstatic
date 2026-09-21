/**
 * The push, driven end to end with nobody in the middle (R13).
 *
 * AC-C13.2 is a COUNT, not a behaviour: "a full push of a new site completes
 * end-to-end with developer round-trip count = 0". So the assertion that
 * matters here is arithmetic — the owner signs twice, and no third party does
 * anything at all. Everything else in this file exists to make that count
 * meaningful: a loop that skipped the gates would also score zero.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { connect, disconnect } from '../src/http/store'
import { TARGETS_ENV } from '../src/http/config'
import { saveUpload, UPLOAD_DIR_ENV } from '../src/mcp/uploadStore'
import { PUSH_DIR_ENV, PUSH_TOOLS, sweepParkedPushes } from '../src/mcp/pushTools'
import { goMessage, type Go } from '../src/go/message'
import { GO_POLICY_ENV } from '../src/go/policy'
import { forgetApprovers, REGISTRY_CACHE_ENV, RELAY_URL_ENV } from '../src/go/registry'
import { GO_LEDGER_ENV } from '../src/go/ledger'
import { RELAY_TOKEN_FILE_ENV } from '../src/http/relay'

interface Vectors {
  owner: { seedHex: string; publicKey: string; fingerprint: string }
}
const VECTORS = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../docs/relay/go-test-vectors.json'), 'utf8'),
) as Vectors

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const OWNER_KEY: KeyObject = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(VECTORS.owner.seedHex, 'hex')]),
  format: 'der',
  type: 'pkcs8',
})

const realFetch = globalThis.fetch
let dir = ''
let draftSite = 'draft site v1'

/** Who did what, in order. The milestone is measured off this list. */
let actions: { by: 'connector' | 'owner' | 'developer'; what: string }[] = []

/** The relay's tickets, and the GO an owner has signed for each. */
let tickets = new Map<string, { id: string; action: string; target: string; sha256: string; contentDigest?: string }>()
let goByTicket = new Map<string, Go>()
let ticketSeq = 0

const hashOf = (s: string): string => createHash('sha256').update(s).digest('hex')

const cleanExport = () => ({
  site: { name: 'fixture', styleRules: {} },
  tables: [{ id: 'pages', slug: 'pages' }],
  rows: [
    {
      id: 'p1',
      tableId: 'pages',
      slug: 'index',
      status: 'published',
      cells: {
        title: 'Home',
        body: { rootNodeId: 'r', nodes: { r: { id: 'r', moduleId: 'base.container', props: {}, children: [], classIds: [] } } },
      },
    },
  ],
})
let exportedSite: unknown = cleanExport()

const call = (name: string, args: Record<string, unknown>) => PUSH_TOOLS.find((t) => t.name === name)!.handler(args)
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text)

/** The owner signs the GO the ticket asks for. This is a PERSON acting. */
function ownerSigns(ticketId: string): void {
  const t = tickets.get(ticketId)!
  const full: Omit<Go, 'signature'> = {
    ticketId,
    action: t.action as Go['action'],
    target: t.target,
    sha256: t.sha256,
    contentDigest: t.contentDigest ?? '-',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: randomBytes(18).toString('base64url'),
  }
  goByTicket.set(ticketId, {
    ...full,
    signature: sign(null, Buffer.from(goMessage(full), 'utf8'), OWNER_KEY).toString('base64'),
  })
  actions.push({ by: 'owner', what: `signed ${t.action} GO for ${ticketId}` })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'push-'))
  process.env[GO_POLICY_ENV] = join(dir, 'go-policy.json')
  process.env[GO_LEDGER_ENV] = join(dir, 'go-ledger.jsonl')
  process.env[UPLOAD_DIR_ENV] = join(dir, 'uploads')
  process.env[PUSH_DIR_ENV] = join(dir, 'pushes')
  process.env[REGISTRY_CACHE_ENV] = join(dir, 'approver-cache.json')
  process.env[RELAY_URL_ENV] = 'https://relay.test'
  process.env[RELAY_TOKEN_FILE_ENV] = join(dir, 'relay-token.txt')
  writeFileSync(
    process.env[RELAY_TOKEN_FILE_ENV]!,
    'CF-Access-Client-Id: connector.access\nCF-Access-Client-Secret: s3cret\n',
  )
  writeFileSync(process.env[GO_POLICY_ENV]!, JSON.stringify({}))
  process.env[TARGETS_ENV] = JSON.stringify({
    alpha: { url: 'http://alpha.test', email: 'a@example.test', secret: 'pw' },
  })

  forgetApprovers()
  writeFileSync(
    process.env[REGISTRY_CACHE_ENV]!,
    JSON.stringify({
      at: new Date().toISOString(),
      approvers: [
        {
          property: 'alpha',
          level: 'project',
          publicKey: VECTORS.owner.publicKey,
          fingerprint: VECTORS.owner.fingerprint,
          effectiveFrom: '2026-09-14T00:00:00.000Z',
        },
      ],
    }),
  )

  actions = []
  tickets = new Map()
  goByTicket = new Map()
  ticketSeq = 0
  draftSite = 'draft site v1'
  exportedSite = cleanExport()

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? 'GET'

    if (url.hostname === 'relay.test') {
      if (method === 'POST' && url.pathname === '/api/tickets') {
        const body = JSON.parse(String(init?.body)) as Record<string, string>
        const id = `DR-${String(++ticketSeq).padStart(6, '0')}`
        tickets.set(id, { id, action: body.action!, target: body.target!, sha256: body.sha256!, contentDigest: body.contentDigest })
        actions.push({ by: 'connector', what: `opened ${body.action} deploy-request ${id}` })
        return new Response(JSON.stringify({ ticket: { id, type: 'deploy-request', state: 'awaiting_go', title: body.title } }), { status: 201 })
      }
      const goRead = /^\/api\/tickets\/([^/]+)\/go$/.exec(url.pathname)
      if (method === 'GET' && goRead) {
        const go = goByTicket.get(goRead[1]!)
        if (go) return new Response(JSON.stringify({ go }), { status: 200 })
        // Exactly what the real relay answers while a deploy-request is still
        // with the owner: 409, naming the state. Not 404 — that means the
        // ticket does not exist, which is a different thing entirely and must
        // not be waited on.
        return new Response(
          JSON.stringify({ error: 'There is no usable GO: the deploy-request is awaiting_go.', state: 'awaiting_go' }),
          { status: 409 },
        )
      }
      if (method === 'POST' && /\/messages$/.test(url.pathname)) {
        return new Response(JSON.stringify({ ok: true }), { status: 201 })
      }
      return new Response(JSON.stringify({ error: 'unexpected relay call' }), { status: 400 })
    }

    if (url.pathname.endsWith('/login')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=t; Path=/; HttpOnly' } })
    }
    if (method === 'GET' && url.pathname.endsWith('/publish/status')) {
      return new Response(JSON.stringify({ draftMatchesPublished: false, draftSiteHash: hashOf(draftSite) }), { status: 200 })
    }
    if (method === 'GET' && url.pathname.endsWith('/export')) {
      return new Response(zipSync({ '.instatic/site-bundle.json': strToU8(JSON.stringify(exportedSite)) }) as unknown as BodyInit, { status: 200 })
    }
    if (method === 'POST' && url.pathname.endsWith('/cms/publish')) {
      return new Response(JSON.stringify({ publishedPages: 1, bakedRoutes: ['/'] }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  await connect('alpha')
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  rmSync(dir, { recursive: true, force: true })
})

function uploadBundle(content: unknown): string {
  const saved = saveUpload(zipSync({ '.instatic/site-bundle.json': strToU8(JSON.stringify(content)) }), 'zip')
  if (!saved.ok) throw new Error(saved.reason)
  return saved.upload.uploadId
}

const bundleUpload = (): string => uploadBundle(cleanExport())

test('a full push completes with the owner signing twice and no developer action at all (AC-C13.2)', async () => {
  const uploadId = bundleUpload()

  // 1. The studio asks. This is the only request anybody makes.
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId, title: 'Green Kitchen' }))
  expect(started.refusal ?? null).toBeNull()
  expect(started.step).toBe('awaiting-import-go')
  expect(started.waitingOn).toBe('owner')

  // 2. The owner signs the import.
  ownerSigns(started.importTicket)
  const afterImport = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(afterImport.step).toBe('awaiting-publish-go')
  expect(afterImport.waitingOn).toBe('owner')
  // The second approval is a separate one, on its own ticket (AC-B7.5).
  expect(afterImport.publishTicket).not.toBe(started.importTicket)

  // 3. The owner signs the publish.
  ownerSigns(afterImport.publishTicket)
  const done = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(done.step).toBe('done')
  expect(done.waitingOn).toBe('nobody')

  // The milestone, as arithmetic.
  expect(actions.filter((a) => a.by === 'developer')).toEqual([])
  expect(actions.filter((a) => a.by === 'owner').length).toBe(2)
  expect(done.developerActions).toBe(0)
  // And the publish reported its own route check rather than needing a look.
  expect(done.evidence.routeCheck).toMatchObject({ agrees: true })
})

test('a bundle the pre-flight refuses stops the push before anyone is asked to approve it', async () => {
  // The whole point of a pre-flight that blocks: the owner is never shown a
  // bundle the machine already knows would publish broken. Asking them to
  // approve one and then refusing it afterwards is the round trip R13 removes.
  const styleRules: Record<string, unknown> = {}
  for (let i = 0; i < 40; i++) {
    styleRules[`sr_${i}`] = {
      id: `sr_${i}`,
      name: `dead-${i}`,
      kind: 'class',
      selector: `.dead-${i}`,
      order: 0,
      styles: { color: 'red' },
      contextStyles: {},
      createdAt: 0,
      updatedAt: 0,
    }
  }
  const uploadId = uploadBundle({ ...cleanExport(), site: { name: 'fixture', styleRules } })

  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  expect(started.step).toBe('refused')
  expect(started.refusal).toContain('Pre-flight refused')
  // No ticket was opened, so nobody was asked for anything.
  expect(tickets.size).toBe(0)
  expect(actions).toEqual([])
})

test('a push parked on an owner stays exactly where it was, however often it is nudged', async () => {
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  expect(started.step).toBe('awaiting-import-go')

  // The relay's webhook can fire for reasons that have nothing to do with this
  // push, so being called again while still waiting must be free. Opening a
  // second deploy-request each time is the failure this guards.
  for (let i = 0; i < 3; i++) {
    const again = parse(await call('connector_push_site', { pushId: started.pushId }))
    expect(again.step).toBe('awaiting-import-go')
    expect(again.importTicket).toBe(started.importTicket)
  }
  expect(tickets.size).toBe(1)
})

test('a push survives the process that started it', async () => {
  // The wait for an owner outlives any one call, and often the process. State
  // lives on disk so a restart resumes the run rather than starting a second.
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  ownerSigns(started.importTicket)

  const listed = parse(await call('connector_push_status', {}))
  expect(listed.pushes.map((p: { pushId: string }) => p.pushId)).toContain(started.pushId)

  const resumed = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(resumed.step).toBe('awaiting-publish-go')
})

test('a push that cannot reach the relay stops, rather than carrying on unapproved', async () => {
  const uploadId = bundleUpload()
  rmSync(process.env[RELAY_TOKEN_FILE_ENV]!, { force: true })

  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  expect(started.step).toBe('refused')
  expect(started.refusal).toMatch(/relay token|Could not open/)
  expect(tickets.size).toBe(0)
})

test('a parked push resumes on its own once the owner signs — nobody nudges it (R13)', async () => {
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  expect(started.step).toBe('awaiting-import-go')

  // A sweep while the owner has not signed changes nothing, and must not cost a
  // second ticket.
  const quiet = await sweepParkedPushes()
  expect(quiet.swept).toBe(1)
  expect(quiet.advanced).toEqual([])
  expect(tickets.size).toBe(1)

  // The owner signs. From here nothing else is asked of anybody: the next sweep
  // carries the run through the import and on to the second approval.
  ownerSigns(started.importTicket)
  const moved = await sweepParkedPushes()
  expect(moved.advanced.length).toBe(1)
  expect(parse(await call('connector_push_status', { pushId: started.pushId })).step).toBe('awaiting-publish-go')

  // And again for the publish, which finishes the push with no call from us
  // other than the sweep itself.
  const publishTicket = parse(await call('connector_push_status', { pushId: started.pushId })).publishTicket
  ownerSigns(publishTicket)
  await sweepParkedPushes()

  const final = parse(await call('connector_push_status', { pushId: started.pushId }))
  expect(final.step).toBe('done')
  expect(actions.filter((a) => a.by === 'developer')).toEqual([])
  expect(actions.filter((a) => a.by === 'owner').length).toBe(2)
})

test('a sweep that cannot reach the relay leaves the run parked, not refused', async () => {
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  expect(started.step).toBe('awaiting-import-go')

  // A relay outage is a reason to try again later, never a reason to abandon a
  // push an owner may already have approved.
  const previous = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('the network is down')
  }) as typeof fetch
  await sweepParkedPushes()
  globalThis.fetch = previous

  expect(parse(await call('connector_push_status', { pushId: started.pushId })).step).toBe('awaiting-import-go')
})

test('a finished push is not swept again', async () => {
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  ownerSigns(started.importTicket)
  await sweepParkedPushes()
  const publishTicket = parse(await call('connector_push_status', { pushId: started.pushId })).publishTicket
  ownerSigns(publishTicket)
  await sweepParkedPushes()

  const after = await sweepParkedPushes()
  expect(after.swept).toBe(0)
})
