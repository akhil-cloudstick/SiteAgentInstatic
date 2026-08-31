/**
 * Activity log — one line per action, readable without tooling.
 *
 * The point of this file is that someone can open it months later, during an
 * incident or a review, and understand what happened without a parser. So the
 * format is fixed-width columns rather than JSON: timestamp, who, what, outcome,
 * duration, and a short detail. Grep and eyeballs both work on it.
 *
 * Denials are logged as loudly as successes. An audit trail that only records
 * what succeeded cannot answer the question people actually ask afterwards,
 * which is who tried.
 *
 * Never logged: the bearer token, any Authorization header, or tool arguments.
 * Arguments can carry content; the log records shape (how many rows) rather than
 * substance (which rows), so the log itself never becomes a data leak.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const LOG_PATH_ENV = 'MMS_CONNECTOR_LOG'

export type Outcome = 'ok' | 'FAILED' | 'DENIED'

function logPath(): string {
  return process.env[LOG_PATH_ENV]?.trim()
    ? resolve(process.env[LOG_PATH_ENV]!.trim())
    : resolve(import.meta.dir, '../../logs/activity.log')
}

/** `2026-08-27 10:23:45` — local time, seconds precision. No timezone noise. */
function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

/** Strip newlines so one action can never forge extra log lines. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim()
}

export interface ActivityEntry {
  /** Which part of the connector — doctor, hashing, approval, auth. */
  section: string
  /** The specific action, usually the tool name without its prefix. */
  action: string
  outcome: Outcome
  /** Milliseconds; omitted for instantaneous events like a denial. */
  ms?: number
  /** Short, non-sensitive summary — counts and identifiers, never content. */
  detail?: string
  /** Caller fingerprint, never the token itself. */
  caller?: string
}

export function logActivity(entry: ActivityEntry): void {
  const line =
    [
      stamp(),
      (entry.caller ?? 'client').padEnd(10).slice(0, 10),
      entry.section.padEnd(10).slice(0, 10),
      entry.action.padEnd(18).slice(0, 18),
      entry.outcome.padEnd(6),
      entry.ms === undefined ? '     -' : `${(entry.ms / 1000).toFixed(1)}s`.padStart(6),
      oneLine(entry.detail ?? ''),
    ]
      .join('  ')
      .trimEnd() + '\n'

  try {
    const path = logPath()
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, line, 'utf8')
  } catch (err) {
    // A failed write must never take down a request — losing a log line is bad,
    // refusing service because of it is worse.
    console.error('[connector:audit] could not write activity log:', err)
  }
  // Mirror to stdout so a live operator sees activity without tailing a file.
  process.stdout.write(line)
}

/**
 * A stable, non-reversible caller fingerprint: first 6 hex of the token hash.
 * Enough to tell two callers apart in the log and to confirm which credential
 * was used, without the log becoming a place credentials live.
 */
export function callerFingerprint(token: string | null): string {
  if (!token) return 'anon'
  let h = 0
  for (let i = 0; i < token.length; i++) h = (Math.imul(31, h) + token.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

export function activityLogPath(): string {
  return logPath()
}
