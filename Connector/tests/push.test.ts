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

/**
 * The fake CMS's tables and rows.
 *
 * Defaults to the shape the first acceptance run actually hit: a `pages` table
 * plus a collection whose rows arrived as DRAFTS. That is the state a replace
 * import leaves, and publishing the site over it is what put 8 of 18 URLs on the
 * homepage — so it is the default here rather than a special case, and a test
 * that wants the simple world empties `cmsRows`.
 */
let cmsTables: { id: string; slug: string; kind?: string }[] = []
let cmsRows: { id: string; tableSlug: string; slug: string; status: string }[] = []

/** The routes the fake bake produces: `/` plus every PUBLISHED collection row. */
const bakedRoutes = (): string[] => [
  '/',
  ...cmsRows.filter((r) => r.status === 'published').map((r) => `/${r.tableSlug}/${r.slug}`),
]

/** The relay's tickets, and the GO an owner has signed for each. */
let tickets = new Map<string, { id: string; action: string; target: string; sha256: string; contentDigest?: string }>()
let goByTicket = new Map<string, Go>()
/** The state each deploy-request has been moved to, and whose GO is spent. */
let ticketStates = new Map<string, string>()
let consumedGos = new Set<string>()
let ticketSeq = 0
let steppedUp = false
/** A row id the fake CMS refuses to publish, for the partial-site test. */
let failRowPublish: string | null = null
/** The CMS answers 200 to a row publish but leaves the row a draft. */
let silentRowPublish = false

const hashOf = (s: string): string => createHash('sha256').update(s).digest('hex')

const emptyPageBody = () => ({
  rootNodeId: 'r',
  nodes: { r: { id: 'r', moduleId: 'base.container', props: {}, children: [], classIds: [] } },
})

/**
 * What the fake CMS exports as its current draft.
 *
 * Built from `cmsRows`, so the site the projection reads and the site the bake
 * reports are the SAME site. They used to disagree — the export knew only about
 * `pages` while the bake produced entry routes — and a fake whose two answers
 * describe different sites cannot tell a real route mismatch from its own
 * inconsistency, which is precisely the confusion this whole change is about.
 *
 * The `news` entry template is included because a collection with no template
 * bakes nothing for any of its rows (and is reported as a blocking finding), so
 * without it the rows here would be a different bug than the one under test.
 */
const cleanExport = () => ({
  site: { name: 'fixture', styleRules: {} },
  tables: [
    { id: 'pages', slug: 'pages' },
    { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' },
  ],
  rows: [
    {
      id: 'p1',
      tableId: 'pages',
      slug: 'index',
      status: 'published',
      cells: { title: 'Home', body: emptyPageBody() },
    },
    // The entry template, as a `pages` ROW — which is how the publisher finds one
    // (`pageFromRow` reads `templateEnabled` / `templateTarget` out of the cells).
    // Without it the projection blocks the whole bundle with
    // ENTRY_ROWS_WITHOUT_TEMPLATE, which is a different defect than the one under
    // test: rows that have a template and are left as drafts.
    {
      id: 'tpl-news',
      tableId: 'pages',
      slug: 'news-template',
      status: 'published',
      cells: {
        title: 'News template',
        body: emptyPageBody(),
        templateEnabled: true,
        templateTarget: { kind: 'postTypes', tableSlugs: ['news'] },
        templatePriority: 100,
      },
    },
    ...cmsRows.map((r) => ({
      id: r.id,
      tableId: 'news',
      slug: r.slug,
      status: r.status,
      cells: { title: r.slug, body: 'A news body.' },
    })),
  ],
})
let exportedSite: unknown = null

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
  // The real CMS demands a step-up for its two destructive operations, and the
  // fake here used to answer 200 to everything — which is precisely why a push
  // loop that never stepped up passed every test and then failed on a live run
  // with 401 step_up_required, having written nothing. The fake now refuses the
  // same way the real one does.
  steppedUp = false
  tickets = new Map()
  goByTicket = new Map()
  ticketSeq = 0
  ticketStates = new Map()
  cmsTables = [
    { id: 'pages', slug: 'pages' },
    { id: 'news', slug: 'news', kind: 'postType' },
  ]
  cmsRows = [
    { id: 'n1', tableSlug: 'news', slug: 'first', status: 'draft' },
    { id: 'n2', tableSlug: 'news', slug: 'second', status: 'draft' },
  ]
  consumedGos = new Set()
  failRowPublish = null
  silentRowPublish = false
  draftSite = 'draft site v1'
  // Left null so it is derived from cmsRows on each request; a test that wants a
  // specific bundle assigns exportedSite itself.
  exportedSite = null

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
      // The state machine, as strict as the real relay's on the two things that
      // matter here. Before this existed the fake answered 400 to every
      // transition, so the push loop could not have advanced a ticket even if it
      // tried — which is how the missing transitions went unnoticed until an
      // acceptance run read the ticket and found `go_granted` with a live site.
      const transition = /^\/api\/tickets\/([^/]+)\/transition$/.exec(url.pathname)
      if (method === 'POST' && transition) {
        const id = transition[1]!
        const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string; deployId?: string }
        const to = String(body.to ?? '')
        if (to === 'executing') {
          // `executing` is where the real relay consumes the GO, and consuming it
          // twice is refused — that IS the single-use guarantee. A fake that let
          // it through twice would hide a replayed approval.
          if (consumedGos.has(id)) {
            return new Response(
              JSON.stringify({ error: 'This GO has already been consumed. A GO authorizes one run.' }),
              { status: 409 },
            )
          }
          if (!goByTicket.has(id)) {
            return new Response(JSON.stringify({ error: 'There is no GO on this deploy-request.' }), { status: 409 })
          }
          consumedGos.add(id)
        }
        // The real relay refuses `verifying_live` without a deploy id, because a
        // record that cannot say WHAT was deployed is the gap this closes.
        if (to === 'verifying_live' && !body.deployId) {
          return new Response(
            JSON.stringify({ error: 'Moving to verifying_live needs the deployId the import or publish returned.' }),
            { status: 422 },
          )
        }
        ticketStates.set(id, to)
        actions.push({ by: 'connector', what: `moved ${id} to ${to}` })
        return new Response(JSON.stringify({ ok: true, state: to }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'unexpected relay call' }), { status: 400 })
    }

    if (method === 'POST' && url.pathname.endsWith('/auth/step-up')) {
      // The credential is the account's own, from configuration. The fake only
      // cares that one was presented.
      const body = JSON.parse(String(init?.body ?? '{}')) as { password?: string }
      if (!body.password) return new Response(JSON.stringify({ error: 'password required' }), { status: 400 })
      steppedUp = true
      actions.push({ by: 'connector', what: 'stepped up' })
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=t2; Path=/; HttpOnly' } })
    }

    // The two writes, each refusing an un-elevated session exactly as the CMS
    // does. The elevation is spent by the write, so a second write needs a
    // second step-up — which is what makes "elevate once at the start of the
    // run" the wrong shape, given a push waits on two human signatures between
    // them.
    const isWrite =
      method === 'POST' && (url.pathname.startsWith('/import') || url.pathname.endsWith('/cms/publish'))
    if (isWrite && !steppedUp) {
      return new Response(JSON.stringify({ error: 'step_up_required' }), { status: 401 })
    }
    if (isWrite) steppedUp = false

    if (url.pathname.endsWith('/login')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=t; Path=/; HttpOnly' } })
    }
    if (method === 'GET' && url.pathname.endsWith('/publish/status')) {
      return new Response(JSON.stringify({ draftMatchesPublished: false, draftSiteHash: hashOf(draftSite) }), { status: 200 })
    }
    if (method === 'GET' && url.pathname.endsWith('/export')) {
      // Re-derived per request, so a row that just changed status is reflected.
      return new Response(zipSync({ '.instatic/site-bundle.json': strToU8(JSON.stringify(exportedSite ?? cleanExport())) }) as unknown as BodyInit, { status: 200 })
    }
    if (method === 'POST' && url.pathname.endsWith('/cms/publish')) {
      return new Response(JSON.stringify({ publishedPages: 1, bakedRoutes: bakedRoutes() }), { status: 200 })
    }
    // The tables and their rows, so the push can see which collection rows the
    // import landed as drafts. The fake used to answer `{ ok: true }` to these,
    // which reads as "no tables" — and a push that cannot tell whether rows are
    // drafts must not publish the site, so it refused. That refusal is correct;
    // what was missing was the fake being able to answer at all.
    if (method === 'GET' && url.pathname.endsWith('/data/tables')) {
      return new Response(JSON.stringify({ tables: cmsTables }), { status: 200 })
    }
    const rowsList = /\/data\/tables\/([^/]+)\/rows/.exec(url.pathname)
    if (method === 'GET' && rowsList) {
      const slug = decodeURIComponent(rowsList[1]!)
      return new Response(JSON.stringify({ rows: cmsRows.filter((r) => r.tableSlug === slug) }), { status: 200 })
    }
    // Publishing a set of rows flips their status. The site publish then bakes
    // their pages, which is the ordering the whole two-gate row flow exists for.
    if (method === 'POST' && /\/data\/rows\/[^/]+\/publish/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/data/rows/')[1]!.split('/')[0]!)
      if (failRowPublish && id === failRowPublish) {
        return new Response(JSON.stringify({ error: 'row refused' }), { status: 409 })
      }
      const row = silentRowPublish ? undefined : cmsRows.find((r) => r.id === id)
      if (row) row.status = 'published'
      return new Response(JSON.stringify({ ok: true, id }), { status: 200 })
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
  // THREE gates, not two, and this one is the fix for the first acceptance run.
  // The import lands collection rows as DRAFTS, and a site publish bakes pages
  // but not rows — so publishing straight from here put a site live with every
  // entry URL serving the homepage. The rows get their own approval, bound to a
  // digest of exactly those rows, before the site is published.
  expect(afterImport.step).toBe('awaiting-rows-go')
  expect(afterImport.waitingOn).toBe('owner')
  expect(afterImport.rows).toMatchObject({ count: 2 })
  expect(afterImport.rowsTicket).not.toBe(started.importTicket)

  // 3. The owner signs the rows.
  ownerSigns(afterImport.rowsTicket)
  const afterRows = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(afterRows.step).toBe('awaiting-publish-go')
  expect(afterRows.waitingOn).toBe('owner')
  // Each approval is its own ticket (AC-B7.5).
  expect(afterRows.publishTicket).not.toBe(afterImport.rowsTicket)
  expect(afterRows.publishTicket).not.toBe(started.importTicket)

  // 4. The owner signs the publish.
  ownerSigns(afterRows.publishTicket)
  const done = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(done.step).toBe('done')
  expect(done.waitingOn).toBe('nobody')

  // The milestone, as arithmetic. Three signatures now rather than two — the
  // owner signing is part of the loop, not a developer round trip.
  expect(actions.filter((a) => a.by === 'developer')).toEqual([])
  expect(actions.filter((a) => a.by === 'owner').length).toBe(3)
  expect(done.developerActions).toBe(0)

  // The publish reported its own route check, and the site is COMPLETE: the two
  // collection rows have their pages. Before the fix this read
  // `predicted 1, baked 1, agrees: true` while both entry URLs were missing.
  expect(done.evidence.routeCheck).toMatchObject({ agrees: true, unpublishedRows: 0 })
  expect(done.evidence.routeCheck.baked).toBe(3)
  expect(done.evidence.routeCheck.missing).toEqual([])

  // And the relay's own record was closed rather than left at `go_granted`:
  // every ticket was spent and then handed to the validator to confirm.
  const moved = actions.filter((a) => a.what.startsWith('moved '))
  expect(moved.map((a) => a.what)).toEqual([
    `moved ${started.importTicket} to executing`,
    `moved ${started.importTicket} to verifying_live`,
    `moved ${afterImport.rowsTicket} to executing`,
    `moved ${afterImport.rowsTicket} to verifying_live`,
    `moved ${afterRows.publishTicket} to executing`,
    `moved ${afterRows.publishTicket} to verifying_live`,
  ])
})

test('a push that cannot publish the rows does NOT publish the site (the partial-site bug)', async () => {
  // The defect the first acceptance run found, as a test: a site publish that
  // goes ahead over unpublished rows bakes an incomplete site and reports
  // success. Here the row publish fails, and the run must stop — no publish
  // ticket, nothing live.
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId, title: 'Green Kitchen' }))
  ownerSigns(started.importTicket)
  const afterImport = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(afterImport.step).toBe('awaiting-rows-go')

  // The CMS refuses one of the two rows.
  failRowPublish = 'n2'
  ownerSigns(afterImport.rowsTicket)
  const stopped = parse(await call('connector_push_site', { pushId: started.pushId }))

  expect(stopped.step).toBe('refused')
  expect(stopped.refusal).toContain('did not publish')
  // The site was never published, and no publish approval was ever opened.
  expect(stopped.publishTicket ?? null).toBeNull()
  expect(actions.some((a) => a.what.includes('published the site'))).toBe(false)
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
  // The rows gate, which is where a resumed run now lands after the import.
  expect(resumed.step).toBe('awaiting-rows-go')

  // And it survives across the rows gate too, which is the property being tested
  // rather than which gate happens to be next.
  ownerSigns(resumed.rowsTicket)
  expect(parse(await call('connector_push_site', { pushId: started.pushId })).step).toBe('awaiting-publish-go')
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
  expect(parse(await call('connector_push_status', { pushId: started.pushId })).step).toBe('awaiting-rows-go')

  // The rows gate resumes on a sweep exactly like the others — the point of the
  // test is that no human nudges the run between gates, and adding a gate must
  // not add a nudge.
  const rowsTicket = parse(await call('connector_push_status', { pushId: started.pushId })).rowsTicket
  ownerSigns(rowsTicket)
  await sweepParkedPushes()
  expect(parse(await call('connector_push_status', { pushId: started.pushId })).step).toBe('awaiting-publish-go')

  // And again for the publish, which finishes the push with no call from us
  // other than the sweep itself.
  const publishTicket = parse(await call('connector_push_status', { pushId: started.pushId })).publishTicket
  ownerSigns(publishTicket)
  await sweepParkedPushes()

  const final = parse(await call('connector_push_status', { pushId: started.pushId }))
  expect(final.step).toBe('done')
  expect(actions.filter((a) => a.by === 'developer')).toEqual([])
  expect(actions.filter((a) => a.by === 'owner').length).toBe(3)
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

test('a publish whose rows never actually went live is NOT reported as done', async () => {
  // The safety net, pinned independently of the rows gate that feeds it.
  //
  // Here every step reports success — the row publish answers 200 — and the rows
  // are still drafts afterwards. That is the shape of the original defect: the
  // route check compares what the bake WOULD do against what it DID, and for a
  // draft row both answers are "nothing", so it agreed with itself while the
  // site was missing those pages. The run must not call that done.
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId, title: 'Green Kitchen' }))
  ownerSigns(started.importTicket)
  const afterImport = parse(await call('connector_push_site', { pushId: started.pushId }))

  silentRowPublish = true
  ownerSigns(afterImport.rowsTicket)
  const afterRows = parse(await call('connector_push_site', { pushId: started.pushId }))
  expect(afterRows.step).toBe('awaiting-publish-go')

  ownerSigns(afterRows.publishTicket)
  const result = parse(await call('connector_push_site', { pushId: started.pushId }))

  expect(result.step).toBe('refused')
  expect(result.refusal).toContain('still drafts')
  // The route check itself still "agrees" — which is exactly why the run cannot
  // be allowed to read `agrees` as "the site is complete".
  expect(result.evidence.routeCheck).toMatchObject({ agrees: true, unpublishedRows: 2 })
})

test('a finished push is not swept again', async () => {
  const uploadId = bundleUpload()
  const started = parse(await call('connector_push_site', { target: 'alpha', uploadId }))
  const status = async () => parse(await call('connector_push_status', { pushId: started.pushId }))

  ownerSigns(started.importTicket)
  await sweepParkedPushes()
  ownerSigns((await status()).rowsTicket)
  await sweepParkedPushes()
  ownerSigns((await status()).publishTicket)
  await sweepParkedPushes()
  expect((await status()).step).toBe('done')

  const after = await sweepParkedPushes()
  expect(after.swept).toBe(0)
})
