/**
 * Writes `docs/relay/go-test-vectors.json` — the signed bytes both GO verifiers
 * must agree on.
 *
 * The keys come from fixed seeds and are published in the file. They are test
 * keys: nothing configured anywhere trusts them. Ed25519 is deterministic, so
 * re-running this reproduces the file exactly.
 *
 * Run from S:\SiteAgentHub\Relay:   bun cli/gen-test-vectors.ts
 */

import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { goMessage, type Go } from '../src/go'

/** PKCS#8 DER header for an Ed25519 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function keyFromSeed(seedHex: string): { privateKey: KeyObject; publicKeyB64: string; fingerprint: string } {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12)
  return {
    privateKey,
    publicKeyB64: raw.toString('base64'),
    fingerprint: createHash('sha256').update(raw).digest('hex').slice(0, 16),
  }
}

const OWNER_SEED = '6f776e65722d746573742d6b65792d6e6f742d666f722d7265616c2d757365'.padEnd(64, '0')
const OTHER_SEED = '6f746865722d746573742d6b65792d6e6f742d666f722d7265616c2d757365'.padEnd(64, '0')

const owner = keyFromSeed(OWNER_SEED)
const other = keyFromSeed(OTHER_SEED)

function signed(fields: Omit<Go, 'signature'>, key: KeyObject): Go {
  return { ...fields, signature: sign(null, Buffer.from(goMessage(fields), 'utf8'), key).toString('base64') }
}

const importFields: Omit<Go, 'signature'> = {
  ticketId: 'DR-0001',
  action: 'import',
  target: 'sheeltron',
  sha256: '383334405e3e3e2b307b8ecf0745720cbf5fc11729c16d46e2f9d5c5a47148a1',
  contentDigest: '-',
  expiresAt: '2030-01-01T04:00:00.000Z',
  nonce: 'bm9uY2UtdmVjdG9yLWltcG9ydC0x',
}
const publishFields: Omit<Go, 'signature'> = {
  ...importFields,
  ticketId: 'DR-0002',
  action: 'publish',
  contentDigest: '7d3f0a9c4e1b6d8f2a5c9e0b3d7f1a4c6e8b2d5f9a0c3e7b1d4f6a8c2e5b9d0f',
  nonce: 'bm9uY2UtdmVjdG9yLXB1Ymxpc2gtMQ',
}
const rowFields: Omit<Go, 'signature'> = {
  ticketId: 'DR-0003',
  action: 'publish-row',
  target: 'sheeltron',
  sha256: '9c1b7e4a2f0d3c5e8a6b1d4f7e2c9a0b3d6e8f1a4c7b0d2e5f8a1c3b6d9e0f2a',
  contentDigest: '-',
  expiresAt: '2030-01-01T04:00:00.000Z',
  nonce: 'bm9uY2UtdmVjdG9yLXJvdy0xLXB1Ymxpc2g',
}

const validImport = signed(importFields, owner.privateKey)
const validPublish = signed(publishFields, owner.privateKey)
const validRow = signed(rowFields, owner.privateKey)

const vectors = {
  about:
    'GO signature test vectors. Read by Connector/tests/goGate.test.ts and Relay/tests/go.test.ts so ' +
    'the two verifiers cannot drift. Keys are derived from the published seeds below and are TEST-ONLY. ' +
    'Regenerate with: cd Relay && bun cli/gen-test-vectors.ts',
  format:
    'mms-go-v2|ticketId|action|target|sha256|contentDigest|expiresAt|nonce  (UTF-8, Ed25519, base64 ' +
    'signature; contentDigest is 64 hex for publish and "-" for every other action)',
  owner: { seedHex: OWNER_SEED, publicKey: owner.publicKeyB64, fingerprint: owner.fingerprint },
  other: { seedHex: OTHER_SEED, publicKey: other.publicKeyB64, fingerprint: other.fingerprint },
  cases: [
    { name: 'valid import GO', message: goMessage(importFields), go: validImport, valid: true },
    { name: 'valid publish GO', message: goMessage(publishFields), go: validPublish, valid: true },
    { name: 'valid publish-row GO', message: goMessage(rowFields), go: validRow, valid: true },
    {
      name: 'import GO with sha256 changed after signing',
      go: { ...validImport, sha256: 'b'.repeat(64) },
      valid: false,
    },
    {
      name: 'publish GO with the draft site digest changed after signing',
      go: { ...validPublish, contentDigest: 'e'.repeat(64) },
      valid: false,
    },
    { name: 'publish-row GO re-labelled as delete', go: { ...validRow, action: 'delete' }, valid: false },
    { name: 'import GO with target changed', go: { ...validImport, target: 'global-nettech' }, valid: false },
    { name: 'import GO with expiry extended', go: { ...validImport, expiresAt: '2031-01-01T04:00:00.000Z' }, valid: false },
    { name: 'import GO signed by another key', go: signed(importFields, other.privateKey), valid: false },
  ],
}

const out = resolve(import.meta.dir, '../../docs/relay/go-test-vectors.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(vectors, null, 2) + '\n')
console.log(`wrote ${out}`)
console.log(`owner fingerprint ${owner.fingerprint}`)
