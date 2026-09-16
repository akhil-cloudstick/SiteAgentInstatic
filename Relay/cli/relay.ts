/**
 * relay — the builder's command line for the relay.
 *
 * Updates and questions for the validator go on the relay, as tickets and
 * messages, so they are recorded where the validator reads and mirrors them.
 * This tool is how the builder posts them without a browser.
 *
 * Credentials: the builder's Access service token, read from a file inside this
 * project — never an argument:
 *   default   <project>\.tmp\relay-builder-token.txt   (git ignores .tmp/, so it is never committed)
 *   override  RELAY_BUILDER_TOKEN_FILE
 * The file holds two lines:
 *   CF-Access-Client-Id: <id>
 *   CF-Access-Client-Secret: <secret>
 *
 * Relay address: RELAY_URL, or PUBLIC_URL from wrangler.toml.
 *
 * Every write carries an Idempotency-Key derived from its own content, so
 * running the same command twice replays the first result instead of posting
 * twice. Pass --again to post an identical message deliberately.
 *
 * From S:\SiteAgentHub\Relay:
 *   bun cli/relay.ts whoami
 *   bun cli/relay.ts show   --ticket T-000002
 *   bun cli/relay.ts upload --file <path>
 *   bun cli/relay.ts ticket --title "<title>" --body-file <path> [--artefact <path>]...
 *   bun cli/relay.ts message --ticket <id> --body-file <path> [--kind comment|info] [--reply-to M-000123]
 *   bun cli/relay.ts deploy-request --action <action> --target <name> --title "<title>" --body-file <path>
 *                                   (--file <bundle> | --sha256 <hex>) [--content-digest <hex>]
 *   bun cli/relay.ts move   --ticket <id> --to <state> [--deploy-id <id>]
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')
const DEFAULT_TOKEN_FILE = resolve(PROJECT_ROOT, '.tmp', 'relay-builder-token.txt')

const USAGE = `usage (from S:\\SiteAgentHub\\Relay):
  bun cli/relay.ts whoami
  bun cli/relay.ts show   --ticket <id>
  bun cli/relay.ts upload --file <path>
  bun cli/relay.ts ticket --title "<title>" --body-file <path> [--artefact <path>]...
  bun cli/relay.ts message --ticket <id> --body-file <path> [--kind comment|info] [--reply-to <message id>]
  bun cli/relay.ts deploy-request --action <action> --target <name> --title "<title>" --body-file <path>
                                  (--file <bundle> | --sha256 <hex>) [--content-digest <hex>]
  bun cli/relay.ts move   --ticket <id> --to <state> [--deploy-id <id>]
add --again to post an identical write a second time on purpose.`

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, string[]>; again: boolean } {
  const [command = '', ...rest] = argv
  const flags = new Map<string, string[]>()
  let again = false
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i]!
    if (name === '--again') {
      again = true
      continue
    }
    if (!name.startsWith('--')) die(`unexpected argument "${name}"\n${USAGE}`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) die(`${name} needs a value\n${USAGE}`)
    flags.set(name.slice(2), [...(flags.get(name.slice(2)) ?? []), value])
    i++
  }
  return { command, flags, again }
}

const { command, flags, again } = parseArgs(process.argv.slice(2))
const one = (name: string): string | undefined => flags.get(name)?.[0]
const need = (name: string): string => one(name) ?? die(`--${name} is required\n${USAGE}`)

function relayUrl(): string {
  const fromEnv = process.env.RELAY_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const wrangler = require(resolve(import.meta.dir, '..', 'wrangler.toml')) as { vars?: { PUBLIC_URL?: string } }
  const url = wrangler.vars?.PUBLIC_URL?.trim()
  if (!url) die('No relay address: set RELAY_URL, or PUBLIC_URL in wrangler.toml.')
  return url.replace(/\/$/, '')
}

function credentials(): Record<string, string> {
  const file = process.env.RELAY_BUILDER_TOKEN_FILE?.trim() || DEFAULT_TOKEN_FILE
  if (!existsSync(file)) {
    die(`No builder token file at ${file}. Create it with the two CF-Access-Client-Id / CF-Access-Client-Secret lines.`)
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const field = (name: string) => lines.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? ''
  const id = field('CF-Access-Client-Id')
  const secret = field('CF-Access-Client-Secret')
  if (!id || !secret || secret.startsWith('PASTE_')) {
    die(`${file} must contain the CF-Access-Client-Id line and the full CF-Access-Client-Secret.`)
  }
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

let connection: { url: string; auth: Record<string, string> } | null = null

/** Resolved on first use, so usage and argument errors never need the token file. */
function relay(): { url: string; auth: Record<string, string> } {
  connection ??= { url: relayUrl(), auth: credentials() }
  return connection
}

async function call(
  method: string,
  path: string,
  options: { body?: Uint8Array | string; headers?: Record<string, string> } = {},
): Promise<any> {
  const { url, auth } = relay()
  const headers: Record<string, string> = { ...auth, ...(options.headers ?? {}) }
  if (method !== 'GET') {
    const basis = `${method}\n${path}\n${sha256(options.body ?? '')}${again ? `\n${Date.now()}` : ''}`
    headers['idempotency-key'] = `cli-${sha256(basis).slice(0, 48)}`
  }
  const res = await fetch(url + path, { method, headers, body: options.body, redirect: 'manual' })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON — reported below
  }
  if (res.status >= 300) {
    const reason =
      json?.error ?? (res.status === 302 ? 'Access redirected to its login page — the token was not accepted.' : text.slice(0, 300))
    die(`${method} ${path} → HTTP ${res.status}: ${reason}`)
  }
  if (res.headers.get('idempotent-replay') === 'true') {
    console.error('note: replayed an identical earlier write (nothing new was posted); use --again to post it again')
  }
  return json
}

async function upload(path: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(path))
  const hash = sha256(bytes)
  const res = await call('PUT', '/api/artefacts', {
    body: bytes,
    headers: { 'x-content-sha256': hash, 'content-type': 'application/octet-stream' },
  })
  console.error(`artefact ${path}: sha256 ${hash}, ${bytes.length} bytes${res.existing ? ' (already held)' : ''}`)
  return hash
}

const bodyFrom = (): string => readFileSync(need('body-file'), 'utf8')
const json = (value: unknown) => ({ body: JSON.stringify(value), headers: { 'content-type': 'application/json' } })

switch (command) {
  case 'whoami':
    console.log(JSON.stringify(await call('GET', '/api/whoami'), null, 2))
    break

  case 'show': {
    const { ticket, messages, transitions } = await call('GET', `/api/tickets/${encodeURIComponent(need('ticket'))}`)
    console.log(`${ticket.id} · ${ticket.type} · ${ticket.state} · ${ticket.title}`)
    for (const m of messages) {
      console.log(`\n${m.id} · ${m.author} · ${m.kind} · ${m.createdAt}${m.replyTo ? ` · reply to ${m.replyTo}` : ''}`)
      if (m.body) console.log(m.body)
      if (m.evidence) console.log(`[evidence] verdict ${m.evidence.verdict}: ${m.evidence.claim}`)
    }
    for (const tr of transitions) console.log(`\n${tr.at} ${tr.from} → ${tr.to} by ${tr.by}`)
    break
  }

  case 'upload':
    console.log(await upload(need('file')))
    break

  case 'ticket': {
    const artefacts: string[] = []
    for (const path of flags.get('artefact') ?? []) artefacts.push(await upload(path))
    const res = await call('POST', '/api/tickets', json({ type: 'ticket', title: need('title'), body: bodyFrom(), artefacts }))
    console.log(res.ticket.id)
    break
  }

  case 'message': {
    const kind = one('kind') ?? 'comment'
    if (kind !== 'comment' && kind !== 'info') die('--kind must be comment or info')
    const res = await call(
      'POST',
      `/api/tickets/${encodeURIComponent(need('ticket'))}/messages`,
      json({ kind, body: bodyFrom(), ...(one('reply-to') ? { replyTo: one('reply-to') } : {}) }),
    )
    console.log(res.message.id)
    break
  }

  case 'deploy-request': {
    const file = one('file')
    const hash = file ? await upload(file) : need('sha256')
    const res = await call(
      'POST',
      '/api/tickets',
      json({
        type: 'deploy-request',
        title: need('title'),
        body: bodyFrom(),
        action: need('action'),
        target: need('target'),
        sha256: hash,
        ...(one('content-digest') ? { contentDigest: one('content-digest') } : {}),
      }),
    )
    console.log(res.ticket.id)
    break
  }

  case 'move': {
    const res = await call(
      'POST',
      `/api/tickets/${encodeURIComponent(need('ticket'))}/transition`,
      json({ to: need('to'), ...(one('deploy-id') ? { deployId: one('deploy-id') } : {}) }),
    )
    console.log(`${res.ticket.id} → ${res.ticket.state}`)
    break
  }

  default:
    die(USAGE)
}
