#!/usr/bin/env node
// Verifies the MMS Connector end to end without involving an AI client.
//
//   cd s:\SiteAgentHub\Operator
//   node scripts/verify-connector.mjs
//
// Reads the token from MMS_CONNECTOR_MCP_TOKEN, or --token <value>.
// Every check is read-only: nothing is created, published, imported or deleted.
// Exits 0 only if every check passes, so it is safe to gate on.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const TOKEN = flag('token', process.env.MMS_CONNECTOR_MCP_TOKEN || '').trim()
const DIRECT = flag('url', 'http://127.0.0.1:8787').replace(/\/$/, '')
const GATEWAY = flag('gateway', 'http://127.0.0.1:4400').replace(/\/$/, '')
const VERBOSE = args.includes('--verbose')

const results = []
let rpcId = 0

const pass = (name, detail = '') => {
  results.push({ ok: true, name, detail })
  console.log(`  PASS  ${name}${detail ? '  —  ' + detail : ''}`)
}
const fail = (name, detail = '') => {
  results.push({ ok: false, name, detail })
  console.log(`  FAIL  ${name}${detail ? '  —  ' + detail : ''}`)
}

async function http(url, opts = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 30_000)
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal })
    const text = await res.text()
    return { status: res.status, text, headers: res.headers }
  } catch (err) {
    return { status: 0, text: String(err?.message || err), headers: new Headers() }
  } finally {
    clearTimeout(timer)
  }
}

// The endpoint answers streamable HTTP; a stateless reply may arrive either as
// plain JSON or as a single SSE frame. Accept both rather than assuming one.
function parseRpc(text) {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try {
        return JSON.parse(line.slice(5).trim())
      } catch {
        /* keep scanning */
      }
    }
  }
  return null
}

async function rpc(method, params, token = TOKEN, base = DIRECT) {
  const body = { jsonrpc: '2.0', id: ++rpcId, method }
  if (params) body.params = params
  const res = await http(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, rpc: parseRpc(res.text), raw: res.text }
}

// A tool result arrives as content blocks; the payload we care about is JSON in
// the first text block when the tool returns structured data.
function toolPayload(result) {
  const block = result?.content?.find?.((c) => c.type === 'text')
  if (!block) return null
  try {
    return JSON.parse(block.text)
  } catch {
    return block.text
  }
}

async function callTool(name, args = {}) {
  const { status, rpc: body } = await rpc('tools/call', { name, arguments: args })
  if (status !== 200) return { error: `HTTP ${status}` }
  if (body?.error) return { error: body.error.message || JSON.stringify(body.error) }
  if (body?.result?.isError) {
    const block = body.result.content?.find?.((c) => c.type === 'text')
    return { error: block?.text || 'tool reported an error' }
  }
  return { value: toolPayload(body?.result) }
}

const EXPECTED_TOOLS = 34

function expectedTargets() {
  try {
    const raw = readFileSync(new URL('../connector-targets.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.allow) ? parsed.allow : []
  } catch {
    return []
  }
}

async function main() {
  console.log('\nMMS Connector verification')
  console.log(`  direct   ${DIRECT}`)
  console.log(`  gateway  ${GATEWAY}`)
  console.log('')

  if (!TOKEN) {
    console.log('  FAIL  token available')
    console.log('        MMS_CONNECTOR_MCP_TOKEN is not set and --token was not passed.')
    console.log('\n  1 check failed.\n')
    process.exit(1)
  }
  if (TOKEN.length < 32) {
    fail('token length', `${TOKEN.length} chars — the service requires at least 32`)
  } else {
    pass('token length', `${TOKEN.length} chars`)
  }

  // 1 — liveness
  const health = await http(`${DIRECT}/health`)
  if (health.status === 200 && health.text.includes('mms-connector-mcp')) {
    pass('service is listening', `${DIRECT}/health`)
  } else {
    fail('service is listening', health.status ? `HTTP ${health.status}` : health.text)
    console.log('\n  The connector is not running. Start the stack from s:\\SiteAgentHub\\Operator')
    console.log('  with the token set BEFORE launch, then re-run this script.\n')
    process.exit(1)
  }

  // 2 — auth actually enforced, direct
  const noAuth = await rpc('tools/list', undefined, '')
  if (noAuth.status === 401) pass('auth enforced on /mcp', 'unauthenticated request rejected')
  else fail('auth enforced on /mcp', `expected 401, got ${noAuth.status}`)

  // 3 — gateway route alive and passing auth through
  const gwNoAuth = await http(`${GATEWAY}/connector-mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }),
  })
  if (gwNoAuth.status === 401) pass('gateway route reachable', '/connector-mcp returns 401 unauthenticated')
  else if (gwNoAuth.status === 502) fail('gateway route reachable', '502 — gateway is up but the connector is not')
  else fail('gateway route reachable', `expected 401, got ${gwNoAuth.status}`)

  // 4 — negative control
  const badToken = await rpc('tools/list', undefined, 'x'.repeat(64))
  if (badToken.status === 401) pass('wrong token rejected', 'negative control')
  else fail('wrong token rejected', `expected 401, got ${badToken.status}`)

  // 5 — the real token works, and the surface is the expected size
  const list = await rpc('tools/list')
  if (list.status !== 200 || !list.rpc?.result?.tools) {
    fail('token accepted', list.status === 401 ? 'HTTP 401 — this token is not the one the service started with' : `HTTP ${list.status}`)
    summarise()
    return
  }
  const tools = list.rpc.result.tools
  pass('token accepted', 'tools/list answered')
  if (tools.length === EXPECTED_TOOLS) {
    pass('tool surface', `${tools.length} tools`)
  } else {
    fail('tool surface', `expected ${EXPECTED_TOOLS} tools, found ${tools.length}`)
  }
  if (VERBOSE) console.log('        ' + tools.map((t) => t.name).join(', '))

  // 6 — runtime health
  const env = await callTool('connector_environment')
  if (env.error) {
    fail('connector_environment', env.error)
  } else {
    const v = env.value || {}
    const ready = v.ready === true
    const detail = `bun ${v.bunVersion ?? '?'} · modules ${v.moduleIds?.length ?? '?'} · revision ${v.toolSurface?.revision?.slice?.(0, 8) ?? '?'}`
    if (ready) pass('connector_environment', detail)
    else fail('connector_environment', `ready=false — ${detail}`)
  }

  // 7 — conversion environment
  const doctor = await callTool('connector_doctor')
  if (doctor.error) {
    fail('connector_doctor', doctor.error)
  } else {
    const v = doctor.value || {}
    const ok = v.ok === true || v.passed === true
    if (ok) pass('connector_doctor', 'fixture conversion passed')
    else fail('connector_doctor', typeof v === 'string' ? v : JSON.stringify(v).slice(0, 160))
  }

  // 8 — targets configured, and every allow-listed tenant present
  const targets = await callTool('connector_target')
  let names = []
  if (targets.error) {
    fail('connector_target', targets.error)
  } else {
    const v = targets.value || {}
    const listed = Array.isArray(v) ? v : v.targets || []
    names = listed.map((t) => (typeof t === 'string' ? t : t.name || t.target || t.slug)).filter(Boolean)
    pass('connector_target', `${names.length} configured: ${names.join(', ') || '(none)'}`)

    const want = expectedTargets()
    const missing = want.filter((w) => !names.includes(w))
    if (!want.length) {
      fail('allow-list honoured', 'connector-targets.json unreadable or empty')
    } else if (missing.length) {
      fail('allow-list honoured', `missing from the connector: ${missing.join(', ')} — restart needed, or the tenant has no connector credential`)
    } else {
      pass('allow-list honoured', `all ${want.length} allow-listed tenants reachable`)
    }
  }

  // 9 — a real read through to each CMS
  for (const name of names) {
    const conn = await callTool('connector_connect', { target: name })
    if (conn.error) {
      fail(`connect: ${name}`, conn.error)
      continue
    }
    const tables = await callTool('connector_list_tables', { target: name })
    if (tables.error) {
      fail(`read: ${name}`, tables.error)
    } else {
      const v = tables.value || {}
      const rows = Array.isArray(v) ? v : v.tables || []
      pass(`read: ${name}`, `${rows.length} tables`)
    }
  }

  summarise()
}

function summarise() {
  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (!failed.length) {
    console.log(`  All ${results.length} checks passed. The connector is working and the token is good to share.`)
    console.log('')
    process.exit(0)
  }
  console.log(`  ${failed.length} of ${results.length} checks FAILED:`)
  for (const f of failed) console.log(`    · ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
  console.log('')
  console.log('  Do not share the token until these are resolved.')
  console.log('')
  process.exit(1)
}

main().catch((err) => {
  console.error('\n  verification crashed:', err?.stack || err)
  process.exit(1)
})
