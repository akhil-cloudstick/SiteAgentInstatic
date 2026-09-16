/**
 * sign-go — the owner's GO signer.
 *
 * What protects the private key:
 *   - `keygen` refuses a path inside a git working tree, so it cannot be committed;
 *   - the key is encrypted with AES-256-GCM under a key stretched from the
 *     password with scrypt (N=2^17, r=8, p=1 — about half a second and 128 MB
 *     of memory per guess). The password is typed twice at a hidden prompt:
 *     never a flag, never read from a file or a pipe, so it cannot appear in a
 *     process list or in shell history;
 *   - the public key and the scrypt and cipher parameters are authenticated
 *     together with the ciphertext, so a file edited to show another public key
 *     or weaker parameters fails to decrypt instead of misleading anyone;
 *   - on Windows, the file's inherited permissions are removed so only the
 *     account that created it can read it (`mode: 0o600` means nothing there).
 *
 * Key files from the first version of this tool — PKCS#8 encrypted with PBKDF2
 * at 2,048 rounds — still work. `rewrap` moves one to the scrypt format without
 * changing the key or its fingerprint.
 *
 * None of that protects the key from software running AS the owner's account:
 * anything that can read the owner's files can also watch the password being
 * typed. Where the key lives — a separate machine, a hardware key — is the
 * owner's decision, not this tool's.
 *
 * Needs only bun, and `src/go.ts` beside `cli/`. From that folder, in an
 * interactive terminal:
 *
 *   bun cli/sign-go.ts keygen --out <key file outside any repo>
 *   bun cli/sign-go.ts pubkey --key <key file>
 *   bun cli/sign-go.ts rewrap --key <key file>
 *   bun cli/sign-go.ts sign   --key <key file> --ticket DR-000001 --action import \
 *                             --target sheeltron --sha256 <64 hex> [--ttl 4h]
 *   bun cli/sign-go.ts sign   --key <key file> --ticket DR-000002 --action publish \
 *                             --target sheeltron --sha256 <64 hex> --content-digest <64 hex>
 *
 * `sign` prints the GO as JSON — paste it into the deploy-request's GO box on
 * the relay. A wrong password fails with a clear error and prints nothing.
 */

import { spawnSync } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  type KeyObject,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  CONTENT_DIGEST_ACTIONS,
  GO_ACTIONS,
  NO_CONTENT_DIGEST,
  goMessage,
  isGoAction,
  parseGo,
  type Go,
} from '../src/go'

const MAX_TTL_MS = 4 * 3_600_000
const MIN_PASSWORD = 12

const KEY_FORMAT = 'mms-go-owner-key-v1'
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 } as const
/** scrypt needs 128·N·r bytes; the default cap is far below that. */
const SCRYPT_MAXMEM = 256 * 1024 * 1024

/**
 * Automated tests cannot type at a hidden prompt, so with this set to "1" the
 * password is read from stdin instead, with a warning on every read. It exists
 * for this tool's own test suite. Never set it when creating or using the real
 * owner key: a password piped in can end up in shell history.
 */
const TEST_ONLY_PIPED_PASSWORD = 'SIGN_GO_TEST_ONLY_PIPED_PASSWORD'

const USAGE = `usage (in an interactive terminal):
  bun cli/sign-go.ts keygen --out <key file outside any repo>
  bun cli/sign-go.ts pubkey --key <key file>
  bun cli/sign-go.ts rewrap --key <key file>
  bun cli/sign-go.ts sign --key <key file> --ticket <id> --action <action> --target <name> --sha256 <hex>
                          [--content-digest <hex>] [--ttl 4h]

actions: ${GO_ACTIONS.join(', ')}
--content-digest is required for ${CONTENT_DIGEST_ACTIONS.join(', ')} and refused for every other action.
The password is always typed at a prompt. There is no flag for it.`

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const [command = '', ...rest] = argv
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i]!
    if (!name.startsWith('--')) die(`unexpected argument "${name}"\n${USAGE}`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) die(`--${name.slice(2)} needs a value\n${USAGE}`)
    flags[name.slice(2)] = value
    i++
  }
  return { command, flags }
}

/** True when the path sits anywhere inside a git working tree. */
function insideGitTree(path: string): boolean {
  let dir = dirname(resolve(path))
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

// ---------------------------------------------------------------------------
// Password input

let pipedLines: string[] | null = null

async function nextPipedLine(): Promise<string> {
  if (pipedLines === null) {
    let text = ''
    for await (const chunk of process.stdin) text += String(chunk)
    pipedLines = text.split(/\r?\n/)
  }
  return pipedLines.shift() ?? ''
}

/** Read a line from the terminal without echoing it. */
function hiddenPrompt(label: string): Promise<string> {
  const stdin = process.stdin
  if (typeof stdin.setRawMode !== 'function') {
    die('This terminal cannot hide typed input, so sign-go will not ask for the password here.')
  }
  return new Promise((resolveLine) => {
    process.stderr.write(label)
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    let value = ''
    const stop = (): void => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
    }
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stop()
          resolveLine(value)
          return
        }
        if (ch === '\u0003') {
          stop()
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

/** The password, from a hidden terminal prompt — and from nowhere else outside this tool's tests. */
async function readPassword(label: string): Promise<string> {
  if (process.stdin.isTTY) return hiddenPrompt(label)
  if (process.env[TEST_ONLY_PIPED_PASSWORD] === '1') {
    process.stderr.write(`${label}[read from stdin because ${TEST_ONLY_PIPED_PASSWORD}=1 — tests only]\n`)
    return nextPipedLine()
  }
  return die(
    'sign-go reads the password only from a prompt in an interactive terminal — never from a flag, ' +
      'a pipe or a file. Run it directly in a terminal window.',
  )
}

async function readNewPassword(nothingDone: string): Promise<string> {
  const password = await readPassword('Password for the key: ')
  if (password.length < MIN_PASSWORD) die(`The password must be at least ${MIN_PASSWORD} characters. ${nothingDone}`)
  if ((await readPassword('Type the password again: ')) !== password) {
    die(`The two passwords do not match. ${nothingDone}`)
  }
  return password
}

// ---------------------------------------------------------------------------
// Key files

function fingerprintOf(publicKeyB64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('hex').slice(0, 16)
}

function publicKeyOf(privateKey: KeyObject): { publicKey: string; fingerprint: string } {
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12)
  const publicKey = raw.toString('base64')
  return { publicKey, fingerprint: fingerprintOf(publicKey) }
}

interface KeyHeader {
  format: typeof KEY_FORMAT
  publicKey: string
  fingerprint: string
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  cipher: { name: 'aes-256-gcm'; iv: string }
}

interface KeyFile extends Omit<KeyHeader, 'cipher'> {
  cipher: KeyHeader['cipher'] & { tag: string }
  encryptedKey: string
}

/** Everything but the ciphertext and tag, authenticated alongside the ciphertext. */
function aadOf(h: KeyHeader): Buffer {
  return Buffer.from(
    [h.format, h.publicKey, h.fingerprint, h.kdf.name, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt, h.cipher.name, h.cipher.iv].join('|'),
    'utf8',
  )
}

function sealKey(privateKey: KeyObject, password: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header: KeyHeader = {
    format: KEY_FORMAT,
    ...publicKeyOf(privateKey),
    kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64') },
  }
  const key = scryptSync(password, salt, 32, { ...SCRYPT, maxmem: SCRYPT_MAXMEM })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadOf(header))
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  const encrypted = Buffer.concat([cipher.update(der), cipher.final()])
  const file: KeyFile = {
    ...header,
    cipher: { ...header.cipher, tag: cipher.getAuthTag().toString('base64') },
    encryptedKey: encrypted.toString('base64'),
  }
  return JSON.stringify(file, null, 2) + '\n'
}

type LoadedKeyFile = { kind: 'scrypt'; file: KeyFile } | { kind: 'legacy-pkcs8'; pem: string }

function readKeyFile(path: string, nothingDone: string): LoadedKeyFile {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    return die(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}. ${nothingDone}`)
  }
  if (text.includes('BEGIN ENCRYPTED PRIVATE KEY')) return { kind: 'legacy-pkcs8', pem: text }
  if (text.includes('PRIVATE KEY')) die(`${path} is not a password-protected key. ${nothingDone}`)

  let f: Partial<KeyFile> | null = null
  try {
    f = JSON.parse(text) as Partial<KeyFile>
  } catch {
    // falls through to the refusal below
  }
  const valid =
    f !== null &&
    f.format === KEY_FORMAT &&
    typeof f.publicKey === 'string' &&
    typeof f.encryptedKey === 'string' &&
    f.kdf?.name === 'scrypt' &&
    [f.kdf.N, f.kdf.r, f.kdf.p].every((n) => Number.isInteger(n) && n > 0) &&
    typeof f.kdf.salt === 'string' &&
    f.cipher?.name === 'aes-256-gcm' &&
    typeof f.cipher.iv === 'string' &&
    typeof f.cipher.tag === 'string'
  if (!valid) die(`${path} is not a sign-go key file. ${nothingDone}`)
  return { kind: 'scrypt', file: f as KeyFile }
}

async function unlockKey(path: string, nothingDone: string): Promise<{ privateKey: KeyObject; legacy: boolean }> {
  const loaded = readKeyFile(path, nothingDone)
  const password = await readPassword('Key password: ')

  if (loaded.kind === 'legacy-pkcs8') {
    try {
      return { privateKey: createPrivateKey({ key: loaded.pem, passphrase: password }), legacy: true }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      if (/bad.?decrypt|passphrase|password/i.test(detail)) die(`Wrong password. ${nothingDone}`)
      return die(`The key file could not be decrypted (${detail}). ${nothingDone}`)
    }
  }

  const { file } = loaded
  let der: Buffer
  try {
    const key = scryptSync(password, Buffer.from(file.kdf.salt, 'base64'), 32, {
      N: file.kdf.N,
      r: file.kdf.r,
      p: file.kdf.p,
      maxmem: SCRYPT_MAXMEM,
    })
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'))
    decipher.setAAD(aadOf(file))
    decipher.setAuthTag(Buffer.from(file.cipher.tag, 'base64'))
    der = Buffer.concat([decipher.update(Buffer.from(file.encryptedKey, 'base64')), decipher.final()])
  } catch {
    return die(`Wrong password, or the key file was altered. ${nothingDone}`)
  }
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  if (publicKeyOf(privateKey).publicKey !== file.publicKey) {
    die(`The key file's recorded public key does not match its private key. ${nothingDone}`)
  }
  return { privateKey, legacy: false }
}

/**
 * Remove inherited permissions and grant only the current account.
 *
 * Done on an EMPTY file before the key is written into it, so the key bytes
 * never sit on disk under the inherited permissions — a new file under `C:\`
 * inherits read for Authenticated Users and BUILTIN\Users.
 */
function restrictToCurrentAccount(file: string): void {
  if (process.platform !== 'win32') return
  const user = process.env.USERNAME
  if (!user) {
    rmSync(file, { force: true })
    die('Cannot tell which Windows account is running this, so the key file could not be restricted. Nothing was kept.')
  }
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user
  // By full path, never by name: a bare "icacls" is resolved through the search
  // path, where another program with that name could be found first.
  const icacls = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe')
  if (!existsSync(icacls)) {
    rmSync(file, { force: true })
    die(`Cannot find ${icacls}, so the key file could not be restricted. Nothing was kept.`)
  }
  const run = spawnSync(icacls, [file, '/inheritance:r', '/grant:r', `${account}:F`], { encoding: 'utf8' })
  if (run.status !== 0) {
    rmSync(file, { force: true })
    die(`Could not restrict the key file to ${account}: ${(run.stderr || run.stdout).trim()}. Nothing was kept.`)
  }
}

function writePrivateFile(path: string, content: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  writeFileSync(path, '', { mode: 0o600 })
  restrictToCurrentAccount(path)
  writeFileSync(path, content)
}

function parseTtl(value = '4h'): number {
  const m = /^(\d+)(m|h)$/.exec(value)
  if (!m) die('--ttl must look like 30m or 4h')
  const ms = Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 60_000)
  if (ms <= 0 || ms > MAX_TTL_MS) die('--ttl must be between 1m and 4h')
  return ms
}

// ---------------------------------------------------------------------------
// Commands

const { command, flags } = parseArgs(process.argv.slice(2))

switch (command) {
  case 'keygen': {
    const out = flags.out ?? die(`--out is required\n${USAGE}`)
    if (insideGitTree(out)) die(`refusing to write a private key inside a git working tree: ${resolve(out)}`)
    if (existsSync(out)) die(`refusing to overwrite an existing file: ${resolve(out)}`)

    const password = await readNewPassword('Nothing was written.')
    const { privateKey } = generateKeyPairSync('ed25519')
    writePrivateFile(out, sealKey(privateKey, password))

    console.error(`password-protected private key written to ${resolve(out)} — keep it with the owner only`)
    console.log(JSON.stringify(publicKeyOf(privateKey), null, 2))
    break
  }

  case 'pubkey': {
    const path = flags.key ?? die(`--key is required\n${USAGE}`)
    const loaded = readKeyFile(path, 'Nothing was printed.')
    if (loaded.kind === 'scrypt') {
      // Readable without the password. It is authenticated with the private key,
      // so `sign` refuses a file whose public key was edited.
      const { publicKey } = loaded.file
      console.log(JSON.stringify({ publicKey, fingerprint: fingerprintOf(publicKey) }, null, 2))
    } else {
      const { privateKey } = await unlockKey(path, 'Nothing was printed.')
      console.log(JSON.stringify(publicKeyOf(privateKey), null, 2))
    }
    break
  }

  case 'rewrap': {
    const path = flags.key ?? die(`--key is required\n${USAGE}`)
    const { privateKey, legacy } = await unlockKey(path, 'Nothing was changed.')
    const password = await readNewPassword('Nothing was changed.')
    // Written beside the original and renamed over it, so a failure part-way
    // leaves the old file intact rather than no file at all.
    const temp = `${path}.rewrap-${randomBytes(4).toString('hex')}`
    writePrivateFile(temp, sealKey(privateKey, password))
    renameSync(temp, path)
    console.error(
      `${legacy ? 'moved from PBKDF2 to scrypt' : 're-encrypted'}: ${resolve(path)} — same key, same fingerprint`,
    )
    console.log(JSON.stringify(publicKeyOf(privateKey), null, 2))
    break
  }

  case 'sign': {
    const action = flags.action ?? die(`--action is required\n${USAGE}`)
    if (!isGoAction(action)) die(`--action must be one of: ${GO_ACTIONS.join(', ')}`)
    const needsDigest = CONTENT_DIGEST_ACTIONS.includes(action)
    const digest = flags['content-digest']
    if (needsDigest && !digest) {
      die(`--content-digest is required for ${action}: the draft site hash from connector_site_digest.`)
    }
    if (!needsDigest && digest !== undefined) {
      die(`--content-digest applies only to ${CONTENT_DIGEST_ACTIONS.join(', ')}.`)
    }
    const fields: Omit<Go, 'signature'> = {
      ticketId: flags.ticket ?? die(`--ticket is required\n${USAGE}`),
      action,
      target: flags.target ?? die(`--target is required\n${USAGE}`),
      sha256: (flags.sha256 ?? die(`--sha256 is required\n${USAGE}`)).toLowerCase(),
      contentDigest: needsDigest ? digest!.toLowerCase() : NO_CONTENT_DIGEST,
      expiresAt: new Date(Date.now() + parseTtl(flags.ttl)).toISOString(),
      nonce: randomBytes(18).toString('base64url'),
    }
    // Validate before asking for the password, so a typo costs nothing.
    const draft = parseGo({ ...fields, signature: `${'A'.repeat(86)}==` })
    if (!draft.ok) die(draft.reason)

    const { privateKey, legacy } = await unlockKey(
      flags.key ?? die(`--key is required\n${USAGE}`),
      'Nothing was signed.',
    )
    const go: Go = {
      ...fields,
      signature: sign(null, Buffer.from(goMessage(fields), 'utf8'), privateKey).toString('base64'),
    }
    console.error(`signed with owner key ${publicKeyOf(privateKey).fingerprint}; expires ${go.expiresAt}; single use`)
    if (legacy) {
      console.error(
        'note: this key file uses the older PBKDF2 protection (2,048 rounds). Run ' +
          '`bun cli/sign-go.ts rewrap --key <key file>` to move it to scrypt; the key does not change.',
      )
    }
    console.log(JSON.stringify(go, null, 2))
    break
  }

  default:
    die(USAGE)
}
