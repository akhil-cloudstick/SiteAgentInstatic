/**
 * Table arguments accept the slug as well as the id.
 *
 * A custom table's id is generated, so a caller asking for rows in "news" got a
 * 404 and had to list the tables to find `n1tozRulkDeu8H21nKdJz`. The id is
 * still tried first — these tests pin that a call naming the id makes exactly
 * one request, and that only a 404 triggers the slug lookup.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { CRUD_TOOLS } from '../src/mcp/crudTools'
import type { ToolResult } from '../src/mcp/tools'
import { connect, disconnect, requireSession } from '../src/http/store'
import { TARGETS_ENV } from '../src/http/config'
import { listRows, withTableSlug } from '../src/http/rows'

const NEWS_ID = 'n1tozRulkDeu8H21nKdJz'
const API = '/cms/api/cms/data/tables'

const realFetch = globalThis.fetch
let calls: string[] = []

const tool = (name: string) => CRUD_TOOLS.find((t) => t.name === name)!
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(async () => {
  calls = []
  process.env[TARGETS_ENV] = JSON.stringify({ staging: { url: 'http://staging.test', email: 's@example.test', secret: 'pw' } })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/login')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=test; Path=/; HttpOnly' } })
    }
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.pathname}`)
    if (url.pathname === API) {
      return json({ tables: [{ id: 'pages', slug: 'pages' }, { id: NEWS_ID, slug: 'news' }] })
    }
    if (url.pathname === `${API}/boom/rows`) return json({ error: 'Internal error' }, 500)
    if (url.pathname === `${API}/pages/rows` || url.pathname === `${API}/${NEWS_ID}/rows`) {
      return method === 'POST' ? json({ id: 'r1', tableId: url.pathname.split('/')[6] }) : json({ rows: [] })
    }
    return json({ error: 'Table not found' }, 404)
  }) as typeof fetch
  await connect('staging')
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  delete process.env[TARGETS_ENV]
})

test('list_rows by slug resolves the generated id and retries once', async () => {
  const r: ToolResult = await tool('connector_list_rows').handler({ target: 'staging', tableId: 'news' })
  expect(r.isError).toBeUndefined()
  expect(calls).toEqual([`GET ${API}/news/rows`, `GET ${API}`, `GET ${API}/${NEWS_ID}/rows`])
})

test('a call naming the id makes exactly one request', async () => {
  const r = await tool('connector_list_rows').handler({ target: 'staging', tableId: NEWS_ID })
  expect(r.isError).toBeUndefined()
  expect(calls).toEqual([`GET ${API}/${NEWS_ID}/rows`])
})

test('create_row by slug creates the row once, in the resolved table', async () => {
  const r = await tool('connector_create_row').handler({ target: 'staging', tableId: 'news', cells: { title: 'x' } })
  expect(r.isError).toBeUndefined()
  expect(JSON.parse(r.content[0]!.text)).toMatchObject({ tableId: NEWS_ID })
  expect(calls.filter((c) => c === `POST ${API}/${NEWS_ID}/rows`)).toHaveLength(1)
})

test('a name that is neither an id nor a slug reports the original 404', async () => {
  const r = await tool('connector_list_rows').handler({ target: 'staging', tableId: 'nope' })
  expect(r.isError).toBe(true)
  expect(r.content[0]!.text).toContain('list rows in nope failed: HTTP 404')
})

test('a failure other than 404 is not retried and triggers no lookup', async () => {
  const session = requireSession('staging')
  await expect(withTableSlug(session, 'boom', (id) => listRows(session, id))).rejects.toThrow(/HTTP 500/)
  expect(calls).toEqual([`GET ${API}/boom/rows`])
})
