/**
 * Integration tests — Product Hub sign-in honours the person's role (MMS
 * Phase 1: R3, NEW-3) against a real SQLite test DB.
 *
 *   - AC-A3.1 / NEW-3a: a Publisher (CMS `admin`) may publish; an Author (CMS
 *     `client`) is refused, and an owner-only action is refused to the Author.
 *   - AC-A3.2: the refusal is the server's — these are direct calls.
 *   - NEW-3b: step-up is demanded of a hub person, and their HUB password
 *     (checked by the control plane) opens it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import type { DbClient } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'
import { verifySsoToken, verifyPeopleSync } from '../../../server/auth/tenantSso'
import { SESSION_COOKIE_NAME } from '../../../server/auth/tokens'
import { loginPerIpRateLimit, loginRateLimit } from '../../../server/auth/rateLimit'
import { createTestDb } from '../helpers/createTestDb'

const SECRET = 'project-key-for-tests'
const SLUG = 'acme'
const OWNER_EMAIL = 'owner@acme.test'
const VERIFY_URL = 'http://control-plane.test/internal/hub/verify-password'

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${b64}.${createHmac('sha256', secret).update(b64).digest('base64url')}`
}

const exp = () => Date.now() + 60_000

function personToken(id: string, email: string | null, role: string, extra: Record<string, unknown> = {}): string {
  return sign({ sub: SLUG, kind: 'sso', target: 'instatic', exp: exp(), person: { id, email, role }, ...extra })
}

async function sso(db: DbClient, token: string): Promise<Response> {
  return handleCmsRequest(
    new Request(`http://localhost/cms/api/cms/sso?token=${encodeURIComponent(token)}`),
    db,
  )
}

async function signIn(db: DbClient, token: string): Promise<string> {
  const res = await sso(db, token)
  expect(res.status).toBe(302)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true)
  return cookie
}

async function call(db: DbClient, cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const req = new Request(`http://localhost${path}`, init)
  req.headers.set('cookie', cookie)
  return handleCmsRequest(req, db)
}

const publish = (db: DbClient, cookie: string) => call(db, cookie, '/cms/api/cms/publish', { method: 'POST' })
const createRole = (db: DbClient, cookie: string) =>
  call(db, cookie, '/cms/api/cms/roles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Sneaky', capabilities: ['pages.publish'] }),
  })

type FetchCall = { url: string; body: Record<string, unknown> }

/** Neither the capability check (403) nor step-up (401) refused the call. */
const passedGates = (status: number) => status !== 401 && status !== 403

describe('Product Hub sign-in (MMS Phase 1)', () => {
  let testDb: { db: DbClient; cleanup: () => Promise<void> }
  const savedEnv: Record<string, string | undefined> = {}
  const realFetch = globalThis.fetch
  let hubAnswers: boolean | 'down' = true
  let calls: FetchCall[] = []

  beforeEach(async () => {
    for (const k of ['INSTATIC_SSO_SECRET', 'INSTATIC_TENANT_SLUG', 'INSTATIC_HUB_VERIFY_URL']) savedEnv[k] = process.env[k]
    process.env.INSTATIC_SSO_SECRET = SECRET
    process.env.INSTATIC_TENANT_SLUG = SLUG
    process.env.INSTATIC_HUB_VERIFY_URL = VERIFY_URL
    hubAnswers = true
    calls = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== VERIFY_URL) return realFetch(input, init)
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (hubAnswers === 'down') throw new Error('connection refused')
      return new Response(JSON.stringify({ ok: hubAnswers }), { status: 200 })
    }) as typeof fetch

    testDb = await createTestDb()
    const res = await handleCmsRequest(
      new Request('http://localhost/cms/api/cms/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteName: 'Hub SSO', email: OWNER_EMAIL, password: 'owner-local-password' }),
      }),
      testDb.db,
    )
    expect(res.status).toBe(201)
    loginRateLimit.reset('unknown|publisher@acme.test')
    loginPerIpRateLimit.reset('unknown')
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await testDb.cleanup()
  })

  // --- the token -------------------------------------------------------------------
  it('refuses a pre-Phase-1 token that names no person', () => {
    expect(verifySsoToken(sign({ sub: SLUG, kind: 'sso', target: 'instatic', exp: exp() }))).toBeNull()
  })

  it('refuses a token that names both a person and the machine', () => {
    expect(verifySsoToken(personToken('1', 'a@acme.test', 'client', { actor: 'machine' }))).toBeNull()
  })

  it('refuses an unknown role, another project, or another key', () => {
    expect(verifySsoToken(personToken('1', 'a@acme.test', 'superuser'))).toBeNull()
    expect(verifySsoToken(sign({ sub: 'globex', kind: 'sso', target: 'instatic', exp: exp(), actor: 'machine' }))).toBeNull()
    expect(verifySsoToken(sign({ sub: SLUG, kind: 'sso', target: 'instatic', exp: exp(), actor: 'machine' }, 'master-key'))).toBeNull()
  })

  it('accepts a person token and a machine token', () => {
    expect(verifySsoToken(personToken('1', 'a@acme.test', 'client'))?.person?.role).toBe('client')
    expect(verifySsoToken(sign({ sub: SLUG, kind: 'sso', target: 'instatic', exp: exp(), actor: 'machine' }))?.actor).toBe('machine')
  })

  // --- roles are the CMS's, enforced by the server -------------------------------------
  it('an Author cannot publish or manage roles; a Publisher can reach publish (AC-A3.1, AC-A3.2, NEW-3a)', async () => {
    const { db } = testDb
    const author = await signIn(db, personToken('21', 'author@acme.test', 'client'))
    const publisher = await signIn(db, personToken('22', 'publisher@acme.test', 'admin'))

    expect((await publish(db, author)).status).toBe(403)
    expect((await createRole(db, author)).status).toBe(403)

    // The Publisher passes the capability check and meets the step-up gate.
    const res = await publish(db, publisher)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'step_up_required' })

    const { rows } = await db.unsafe<{ email: string; role_id: string; auth_source: string }>(
      `select email, role_id, auth_source from users where email in ('author@acme.test', 'publisher@acme.test') order by email`,
      [],
    )
    expect(rows).toEqual([
      { email: 'author@acme.test', role_id: 'client', auth_source: 'hub' },
      { email: 'publisher@acme.test', role_id: 'admin', auth_source: 'hub' },
    ])
  })

  it('the hub owner signs in as the CMS owner, still without step-up', async () => {
    const { db } = testDb
    const owner = await signIn(db, personToken('1', null, 'owner'))
    const res = await createRole(db, owner)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'step_up_required' })
  })

  it('a hub hand-off never takes over a local CMS account', async () => {
    const { db } = testDb
    const res = await sso(db, personToken('30', OWNER_EMAIL, 'client'))
    expect(res.status).toBe(409)
  })

  // --- step-up asks for the HUB password (NEW-3b) ---------------------------------------
  it('step-up checks the hub password and then opens the gate', async () => {
    const { db } = testDb
    const publisher = await signIn(db, personToken('22', 'publisher@acme.test', 'admin'))

    hubAnswers = false
    const wrong = await call(db, publisher, '/cms/api/cms/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'not-it' }),
    })
    expect(wrong.status).toBe(401)
    expect(calls[0]?.body.password).toBe('not-it')
    expect(calls[0]?.body.project).toBe(SLUG)
    // The request is signed with the project's key and names the person.
    const claim = JSON.parse(Buffer.from(String(calls[0]?.body.token).split('.')[0]!, 'base64url').toString('utf8'))
    expect(claim).toMatchObject({ kind: 'hub-verify', personId: '22', sub: SLUG })

    hubAnswers = true
    const ok = await call(db, publisher, '/cms/api/cms/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'the-hub-password' }),
    })
    expect(ok.status).toBe(200)
    const stepped = (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    // Past both gates: the publish handler itself answers.
    expect(passedGates((await publish(db, stepped)).status)).toBe(true)
  })

  it('an unreachable hub is a failed step-up, never a pass', async () => {
    const { db } = testDb
    const publisher = await signIn(db, personToken('22', 'publisher@acme.test', 'admin'))
    hubAnswers = 'down'
    const res = await call(db, publisher, '/cms/api/cms/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'anything' }),
    })
    expect(res.status).toBe(503)
    expect((await publish(db, publisher)).status).toBe(401)
  })

  it('a hub person cannot set a local password', async () => {
    const { db } = testDb
    const owner = await signIn(db, personToken('1', null, 'owner'))
    const res = await call(db, owner, '/cms/api/cms/me/password', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'a-brand-new-password' }),
    })
    expect(res.status).toBe(403)
  })

  // --- the machine path keeps working ---------------------------------------------------
  it('a machine hand-off is the owner with step-up open', async () => {
    const { db } = testDb
    const machine = await signIn(db, sign({ sub: SLUG, kind: 'sso', target: 'instatic', exp: exp(), actor: 'machine' }))
    expect(passedGates((await publish(db, machine)).status)).toBe(true)
  })

  // --- people sync ------------------------------------------------------------------------
  it('the people list narrows roles and signs removed people out', async () => {
    const { db } = testDb
    const publisher = await signIn(db, personToken('22', 'publisher@acme.test', 'admin'))
    const author = await signIn(db, personToken('21', 'author@acme.test', 'client'))

    const token = sign({
      sub: SLUG,
      kind: 'people-sync',
      exp: exp(),
      people: [
        { email: 'publisher@acme.test', role: 'client', status: 'active' },
        { email: 'author@acme.test', role: 'client', status: 'removed' },
      ],
    })
    expect(verifyPeopleSync(token)?.people).toHaveLength(2)
    const res = await handleCmsRequest(
      new Request('http://localhost/cms/api/cms/sso/people', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      db,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 1, suspended: 1 })

    // The narrowed Publisher is refused at once; the removed Author is signed out.
    expect((await publish(db, publisher)).status).toBe(403)
    expect((await publish(db, author)).status).toBe(401)
  })

  it('a people list signed with another key is refused', async () => {
    const { db } = testDb
    const res = await handleCmsRequest(
      new Request('http://localhost/cms/api/cms/sso/people', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: sign({ sub: SLUG, kind: 'people-sync', exp: exp(), people: [] }, 'wrong') }),
      }),
      db,
    )
    expect(res.status).toBe(401)
  })
})
