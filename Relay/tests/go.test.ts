import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { goMessage, keyFingerprint, parseGo, verifyGoSignature } from '../src/go'
import { VECTORS } from './helpers'

const CLI = resolve(import.meta.dir, '../cli/sign-go.ts')
const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'a different long password'
/** scrypt at N=2^17 takes about half a second per run; several runs per test. */
const SLOW = 60_000

/** Runs the CLI with the tests-only piped-password switch — a spawned process has no terminal to type into. */
const cli = (args: string[], stdin = '', pipedPassword = true) =>
  Bun.spawnSync(['bun', CLI, ...args], {
    stdin: Buffer.from(stdin),
    env: { ...process.env, SIGN_GO_TEST_ONLY_PIPED_PASSWORD: pipedPassword ? '1' : '' },
  })

function withTempDir(fn: (dir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-go-'))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const signArgs = (key: string, action: string, extra: string[] = []) => [
  'sign', '--key', key, '--ticket', 'DR-000007', '--action', action, '--target', 'sheeltron', '--sha256', 'a'.repeat(64), ...extra,
]

function generate(key: string): { publicKey: string; fingerprint: string } {
  const run = cli(['keygen', '--out', key], `${PASSWORD}\n${PASSWORD}\n`)
  expect(run.exitCode).toBe(0)
  return JSON.parse(run.stdout.toString()) as { publicKey: string; fingerprint: string }
}

test('the relay verifies the shared vectors exactly as the Connector does', async () => {
  for (const c of VECTORS.cases) {
    expect({ name: c.name, valid: await verifyGoSignature(c.go, VECTORS.owner.publicKey) }).toEqual({
      name: c.name,
      valid: c.valid,
    })
    if (c.message) expect(goMessage(c.go)).toBe(c.message)
    if (c.valid) expect(parseGo(c.go).ok).toBe(true)
  }
  expect(await keyFingerprint(VECTORS.owner.publicKey)).toBe(VECTORS.owner.fingerprint)
})

test('sign-go refuses to write a private key inside a git working tree', () => {
  const inside = resolve(import.meta.dir, 'must-not-exist.pem')
  const run = cli(['keygen', '--out', inside], `${PASSWORD}\n${PASSWORD}\n`)
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toMatch(/refusing to write a private key inside a git working tree/)
  expect(existsSync(inside)).toBe(false)
})

test('without a terminal, sign-go will not read the password at all', withTempDir((dir) => {
  const key = join(dir, 'owner.key')
  const run = cli(['keygen', '--out', key], `${PASSWORD}\n${PASSWORD}\n`, false)
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toMatch(/only from a prompt in an interactive terminal/)
  expect(existsSync(key)).toBe(false)
}))

test('keygen: scrypt + AES-GCM key file, password typed twice, private; pubkey needs no password', withTempDir(async (dir) => {
  const key = join(dir, 'keys', 'owner.key')

  const short = cli(['keygen', '--out', key], 'too short\ntoo short\n')
  expect(short.exitCode).toBe(1)
  expect(short.stderr.toString()).toMatch(/at least 12 characters\. Nothing was written/)
  const mismatch = cli(['keygen', '--out', key], `${PASSWORD}\n${PASSWORD}!\n`)
  expect(mismatch.exitCode).toBe(1)
  expect(mismatch.stderr.toString()).toMatch(/do not match\. Nothing was written/)
  expect(existsSync(key)).toBe(false)

  const { publicKey, fingerprint } = generate(key)
  expect(await keyFingerprint(publicKey)).toBe(fingerprint)
  const text = readFileSync(key, 'utf8')
  expect(text).not.toContain('PRIVATE KEY')
  expect(JSON.parse(text)).toMatchObject({
    format: 'mms-go-owner-key-v1',
    publicKey,
    fingerprint,
    kdf: { name: 'scrypt', N: 131072, r: 8, p: 1 },
    cipher: { name: 'aes-256-gcm' },
  })

  if (process.platform === 'win32') {
    const acl = Bun.spawnSync(['icacls', key]).stdout.toString()
    expect(acl).not.toMatch(/Authenticated Users|BUILTIN\\Users|Everyone/)
    expect(acl).toContain(process.env.USERNAME!)
  }

  const pub = cli(['pubkey', '--key', key])
  expect(pub.exitCode).toBe(0)
  expect(JSON.parse(pub.stdout.toString())).toEqual({ publicKey, fingerprint })
}), SLOW)

test('sign: password every time; a wrong password or an altered file prints no GO', withTempDir(async (dir) => {
  const key = join(dir, 'owner.key')
  const { publicKey } = generate(key)

  const signed = cli(signArgs(key, 'publish-row', ['--ttl', '30m']), `${PASSWORD}\n`)
  expect(signed.exitCode).toBe(0)
  const parsed = parseGo(JSON.parse(signed.stdout.toString()) as unknown)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.go.contentDigest).toBe('-')
  expect(await verifyGoSignature(parsed.go, publicKey)).toBe(true)
  expect(Date.parse(parsed.go.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000)

  const wrong = cli(signArgs(key, 'publish-row'), 'the wrong password\n')
  expect(wrong.exitCode).toBe(1)
  expect(wrong.stderr.toString()).toMatch(/Wrong password.*Nothing was signed/)
  expect(wrong.stdout.toString()).toBe('')

  const altered = join(dir, 'altered.key')
  writeFileSync(altered, JSON.stringify({ ...JSON.parse(readFileSync(key, 'utf8')), publicKey: VECTORS.other.publicKey }))
  const tampered = cli(signArgs(altered, 'publish-row'), `${PASSWORD}\n`)
  expect(tampered.exitCode).toBe(1)
  expect(tampered.stderr.toString()).toMatch(/altered/)
  expect(tampered.stdout.toString()).toBe('')

  expect(cli(signArgs(key, 'publish-row', ['--ttl', '5h']), `${PASSWORD}\n`).exitCode).toBe(1)
  expect(cli(signArgs(key, 'import+publish'), `${PASSWORD}\n`).exitCode).toBe(1)
}), SLOW)

test('a publish GO carries the draft site digest; no other action may', withTempDir(async (dir) => {
  const key = join(dir, 'owner.key')
  const { publicKey } = generate(key)
  const digest = '7d'.repeat(32)

  const missing = cli(signArgs(key, 'publish'), `${PASSWORD}\n`)
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr.toString()).toMatch(/--content-digest is required for publish/)
  expect(cli(signArgs(key, 'import', ['--content-digest', digest]), `${PASSWORD}\n`).exitCode).toBe(1)

  const signed = cli(signArgs(key, 'publish', ['--content-digest', digest]), `${PASSWORD}\n`)
  expect(signed.exitCode).toBe(0)
  const parsed = parseGo(JSON.parse(signed.stdout.toString()) as unknown)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.go.contentDigest).toBe(digest)
  expect(await verifyGoSignature(parsed.go, publicKey)).toBe(true)
  expect(await verifyGoSignature({ ...parsed.go, contentDigest: 'e'.repeat(64) }, publicKey)).toBe(false)
}), SLOW)

test('an older PBKDF2 key still signs, and rewrap moves it to scrypt without changing the key', withTempDir(async (dir) => {
  const key = join(dir, 'legacy.pem')
  const pair = generateKeyPairSync('ed25519')
  writeFileSync(key, pair.privateKey.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD }))
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')

  const pub = cli(['pubkey', '--key', key], `${PASSWORD}\n`)
  expect(pub.exitCode).toBe(0)
  expect(JSON.parse(pub.stdout.toString()).publicKey).toBe(publicKey)

  const signed = cli(signArgs(key, 'import'), `${PASSWORD}\n`)
  expect(signed.exitCode).toBe(0)
  expect(signed.stderr.toString()).toMatch(/older PBKDF2 protection.*rewrap/)
  const legacyGo = parseGo(JSON.parse(signed.stdout.toString()) as unknown)
  expect(legacyGo.ok && (await verifyGoSignature(legacyGo.go, publicKey))).toBe(true)

  const wrongOld = cli(['rewrap', '--key', key], `not the old password\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)
  expect(wrongOld.exitCode).toBe(1)
  expect(wrongOld.stderr.toString()).toMatch(/Wrong password\. Nothing was changed/)
  expect(readFileSync(key, 'utf8')).toContain('BEGIN ENCRYPTED PRIVATE KEY')

  const rewrapped = cli(['rewrap', '--key', key], `${PASSWORD}\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)
  expect(rewrapped.exitCode).toBe(0)
  expect(JSON.parse(rewrapped.stdout.toString()).publicKey).toBe(publicKey)
  expect(JSON.parse(readFileSync(key, 'utf8'))).toMatchObject({ format: 'mms-go-owner-key-v1', publicKey })

  expect(cli(signArgs(key, 'import'), `${PASSWORD}\n`).exitCode).toBe(1)
  const afterRewrap = cli(signArgs(key, 'import'), `${NEW_PASSWORD}\n`)
  expect(afterRewrap.exitCode).toBe(0)
  expect(afterRewrap.stderr.toString()).not.toMatch(/PBKDF2/)
}), SLOW)
