/**
 * Spent GOs — append-only, on disk, so "single-use" survives a restart.
 *
 * A nonce is spent BEFORE the CMS call it authorizes, not after that call
 * succeeds. The partner plan's own acceptance line is "`executing → failed →
 * executing` refuses": a GO that authorized an import which then failed has
 * still been used, and running it again would be a second deploy on one
 * signature.
 *
 * The outcome follows as a second line. Publish reads it: a publish GO is
 * honoured only for the artefact the most recent import under GO actually
 * landed.
 *
 * An unreadable line makes the whole ledger refuse rather than being skipped.
 * A skipped spend line is a nonce that can be used again.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { IMPORT_ACTIONS, type Go, type GoAction } from './message'

export const GO_LEDGER_ENV = 'MMS_CONNECTOR_GO_LEDGER'

export interface SpendEntry {
  type: 'spend'
  nonce: string
  ticketId: string
  action: GoAction
  target: string
  sha256: string
  contentDigest: string
  at: string
}

interface OutcomeEntry {
  type: 'outcome'
  nonce: string
  outcome: 'ok' | 'failed'
  at: string
}

type Entry = SpendEntry | OutcomeEntry

export function goLedgerPath(): string {
  const configured = process.env[GO_LEDGER_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../go-ledger.jsonl')
}

function readEntries(): Entry[] {
  const file = goLedgerPath()
  if (!existsSync(file)) return []
  const entries: Entry[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        entries.push(JSON.parse(line) as Entry)
      } catch {
        throw new Error(
          `GO ledger ${file} line ${i + 1} is unreadable. Every gated action refuses until it is ` +
            'repaired — skipping the line could let a spent GO run again.',
        )
      }
    })
  return entries
}

function append(entry: Entry): void {
  const file = goLedgerPath()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n')
}

export function isSpent(nonce: string): boolean {
  return readEntries().some((e) => e.type === 'spend' && e.nonce === nonce)
}

/**
 * Check and spend in one synchronous step. There is no `await` between the
 * read and the append, so two concurrent calls carrying one GO cannot both
 * spend it — the second sees the first's line.
 */
export function trySpend(go: Go, now = new Date()): boolean {
  if (isSpent(go.nonce)) return false
  append({
    type: 'spend',
    nonce: go.nonce,
    ticketId: go.ticketId,
    action: go.action,
    target: go.target,
    sha256: go.sha256,
    contentDigest: go.contentDigest,
    at: now.toISOString(),
  })
  return true
}

export function recordOutcome(nonce: string, outcome: 'ok' | 'failed', now = new Date()): void {
  append({ type: 'outcome', nonce, outcome, at: now.toISOString() })
}

/**
 * The most recent import under GO on this target — replace or merge — only if
 * it succeeded.
 *
 * Most recent, not most recent successful: after a failed import the site is
 * in an unknown state, and publishing an earlier import would put content live
 * under a signature that never described it.
 */
export function lastSuccessfulImport(target: string): SpendEntry | undefined {
  const entries = readEntries()
  const succeeded = new Set(
    entries.filter((e) => e.type === 'outcome' && e.outcome === 'ok').map((e) => e.nonce),
  )
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (e.type === 'spend' && IMPORT_ACTIONS.includes(e.action) && e.target === target) {
      return succeeded.has(e.nonce) ? e : undefined
    }
  }
  return undefined
}
