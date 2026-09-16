/**
 * Which build of the Connector answered.
 *
 * Two failures on the record were both "the other side moved and we found out
 * through a mystery failure": a normaliser change, and a cached tool list one
 * tool out of date. `toolSurface` already makes a stale *schema* cache
 * detectable; this makes the *build* nameable, so a caller can pin what it
 * tested against and see drift on purpose rather than by symptom.
 *
 * Read from the repository HEAD once per process — the Connector runs from a
 * checkout, and a restart is exactly when the answer may change. `startedAt`
 * distinguishes two runs of the same commit, which is what a restart looks
 * like from the outside.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toolSurface } from './toolSurface'

const PROJECT_ROOT = resolve(import.meta.dir, '../../..')
const SHA = /^[0-9a-f]{40}$/
const STARTED_AT = new Date().toISOString()

export interface ConnectorRevision {
  /** Short commit of the checkout this process runs from, or a package version. */
  revision: string
  source: 'git' | 'package' | 'unknown'
  /** Content hash of the tool names + input schemas this process serves. */
  toolSurface: string
  /** When this process started, so two runs of one commit are still distinguishable. */
  startedAt: string
}

function gitRevision(): string | null {
  try {
    const head = readFileSync(resolve(PROJECT_ROOT, '.git', 'HEAD'), 'utf8').trim()
    if (SHA.test(head)) return head.slice(0, 12)
    if (!head.startsWith('ref:')) return null

    const ref = head.slice(4).trim()
    const refFile = resolve(PROJECT_ROOT, '.git', ref)
    if (existsSync(refFile)) {
      const sha = readFileSync(refFile, 'utf8').trim()
      if (SHA.test(sha)) return sha.slice(0, 12)
    }
    // A packed ref has no file of its own.
    const packed = resolve(PROJECT_ROOT, '.git', 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        const [sha, name] = line.trim().split(/\s+/)
        if (name === ref && sha && SHA.test(sha)) return sha.slice(0, 12)
      }
    }
    return null
  } catch {
    return null
  }
}

function packageVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null
  } catch {
    return null
  }
}

let build: { revision: string; source: ConnectorRevision['source'] } | null = null

export function connectorRevision(): ConnectorRevision {
  if (!build) {
    const git = gitRevision()
    const version = git ? null : packageVersion()
    build = git
      ? { revision: git, source: 'git' }
      : version
        ? { revision: version, source: 'package' }
        : { revision: 'unknown', source: 'unknown' }
  }
  return { ...build, toolSurface: toolSurface().revision, startedAt: STARTED_AT }
}
