/**
 * connector_install_google_fonts: the CMS installer downloads the files, and
 * the Connector puts the entries into the site settings the way the editor's
 * font picker does — one incremental shell save, conflict-checked.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { ADMIN_TOOLS } from '../src/mcp/adminTools'
import { connect, disconnect } from '../src/http/store'
import { TARGETS_ENV } from '../src/http/config'

const API = '/cms/api/cms'
const realFetch = globalThis.fetch

type Shell = { name?: string; settings: Record<string, any> }
let shell: Shell
let seq = 7
let calls: string[] = []
let installs: { family: string; variants: string[]; subsets: string[] }[] = []
let saves: any[] = []
let conflictOnce = false
let refusedFamily = ''
let nextId = 0

const tool = ADMIN_TOOLS.find((t) => t.name === 'connector_install_google_fonts')!
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function run(args: Record<string, unknown>) {
  const r = await tool.handler({ target: 'staging', ...args })
  return { r, body: JSON.parse(r.content[0]!.text) }
}

const googleEntry = (id: string, family: string, variants: string[]) => ({
  id,
  source: 'google',
  family,
  variants,
  subsets: ['latin'],
  files: variants.map((v) => ({ variant: v, subset: 'latin', path: `/uploads/fonts/x/${v}-latin-0.woff2`, format: 'woff2' })),
  createdAt: 1,
  updatedAt: 1,
})

beforeEach(async () => {
  shell = { name: 'Sheeltron', settings: { shortcuts: {} } }
  seq = 7
  calls = []
  installs = []
  saves = []
  conflictOnce = false
  refusedFamily = ''
  nextId = 0
  process.env[TARGETS_ENV] = JSON.stringify({ staging: { url: 'http://staging.test', email: 's@example.test', secret: 'pw' } })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/login')) {
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'instatic_admin_session=test; Path=/; HttpOnly' } })
    }
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.pathname}`)
    if (method === 'GET' && url.pathname === `${API}/site`) return json({ site: structuredClone(shell), seq })
    if (method === 'POST' && url.pathname === `${API}/fonts/install`) {
      const selection = JSON.parse(String(init!.body))
      installs.push(selection)
      if (selection.family === refusedFamily) return json({ error: `Unknown Google font: ${selection.family}` }, 400)
      return json({ font: { ...googleEntry(`font-${++nextId}`, selection.family, selection.variants), subsets: selection.subsets } }, 201)
    }
    if (method === 'PUT' && url.pathname === `${API}/site-document`) {
      if (conflictOnce) {
        conflictOnce = false
        seq = 9
        shell = { ...shell, name: 'Renamed in the editor' }
        return json({ error: 'conflict', conflicts: [{ table: 'site', rowId: 'default', seq: 9 }] }, 409)
      }
      const body = JSON.parse(String(init!.body))
      saves.push(body)
      shell = body.site
      seq += 1
      return json({ ok: true, seq })
    }
    return json({ error: 'unexpected call' }, 404)
  }) as typeof fetch
  await connect('staging')
})

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  delete process.env[TARGETS_ENV]
})

test('installs each family and saves both entries in one incremental shell save', async () => {
  const { r, body } = await run({
    fonts: [
      { family: 'Space Grotesk', variants: ['300', '400', '500', '600', '700'], subsets: ['latin'] },
      { family: 'Plus Jakarta Sans', variants: ['300', '400', '500', '600', '700', '800'] },
    ],
  })
  expect(r.isError).toBeUndefined()
  expect(body.fonts.map((f: { status: string }) => f.status)).toEqual(['installed', 'installed'])
  expect(installs[1]!.subsets).toEqual(['latin'])
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({ mode: 'incremental', shellBaseSeq: 7, changedPages: [], deletedPageIds: [] })
  expect(saves[0].site.settings.fonts.items.map((f: { family: string }) => f.family)).toEqual(['Space Grotesk', 'Plus Jakarta Sans'])
  expect(saves[0].site.settings.shortcuts).toEqual({})
  expect(body).toMatchObject({ saved: true, seq: 8 })
})

test('re-running with a selection already installed downloads nothing and saves nothing', async () => {
  shell.settings.fonts = { items: [googleEntry('font-a', 'Space Grotesk', ['300', '400'])] }
  const { r, body } = await run({ fonts: [{ family: 'space grotesk', variants: ['400'], subsets: ['latin'] }] })
  expect(r.isError).toBeUndefined()
  expect(body).toMatchObject({ saved: false, fonts: [{ status: 'already-installed', id: 'font-a' }] })
  expect(calls).toEqual([`GET ${API}/site`])
})

test('adding a variant re-installs the union, replaces the entry and repoints its tokens', async () => {
  shell.settings.fonts = {
    items: [googleEntry('font-a', 'Space Grotesk', ['400'])],
    tokens: [{ id: 't1', variable: '--font-display', familyId: 'font-a' }],
  }
  await run({ fonts: [{ family: 'Space Grotesk', variants: ['700'] }] })
  expect(installs[0]!.variants).toEqual(['400', '700'])
  const fonts = saves[0].site.settings.fonts
  expect(fonts.items).toHaveLength(1)
  expect(fonts.items[0]).toMatchObject({ id: 'font-1', variants: ['400', '700'] })
  expect(fonts.tokens[0].familyId).toBe('font-1')
})

test('a family the CMS refuses is reported, and the others are still saved', async () => {
  refusedFamily = 'Nope Sans'
  const { r, body } = await run({
    fonts: [
      { family: 'Nope Sans', variants: ['400'] },
      { family: 'Space Grotesk', variants: ['400'] },
    ],
  })
  expect(r.isError).toBeUndefined()
  expect(body.fonts[0]).toMatchObject({ family: 'Nope Sans', status: 'failed' })
  expect(body.fonts[0].error).toContain('Unknown Google font')
  expect(saves[0].site.settings.fonts.items.map((f: { family: string }) => f.family)).toEqual(['Space Grotesk'])
})

test('a shell changed by another session is re-read and the fonts merged onto it, without re-downloading', async () => {
  conflictOnce = true
  const { body } = await run({ fonts: [{ family: 'Space Grotesk', variants: ['400'] }] })
  expect(body.saved).toBe(true)
  expect(installs).toHaveLength(1)
  expect(saves).toHaveLength(1)
  expect(saves[0].shellBaseSeq).toBe(9)
  expect(saves[0].site.name).toBe('Renamed in the editor')
  expect(saves[0].site.settings.fonts.items).toHaveLength(1)
})

test('malformed input is refused before any call reaches the CMS', async () => {
  expect((await run({ fonts: [] })).r.isError).toBe(true)
  expect((await run({ fonts: [{ family: 'Space Grotesk', variants: [] }] })).r.isError).toBe(true)
  expect((await run({ fonts: [{ variants: ['400'] }] })).r.isError).toBe(true)
  expect(calls).toEqual([])
})
