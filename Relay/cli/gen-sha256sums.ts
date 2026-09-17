/**
 * Regenerate `SHA256SUMS.txt` — the manifest the owner verifies the relay
 * against before deploying it.
 *
 * The relay is the approval spine, so the folder is handed over with a hash per
 * file and checked file-by-file at the far end. A manifest that is not
 * regenerated when the code changes is worse than none: the check fails on
 * honest edits, and the reflex becomes to skip it.
 *
 * Format, byte-identical to the go-live manifest so the same checker parses it:
 * `<sha256> <path>` with one space, LF endings, paths relative to this folder,
 * ASCII-sorted. The manifest itself is excluded — it cannot contain its own
 * hash — as are build outputs and anything not part of the handover.
 *
 * Run from `S:\SiteAgentHub\Relay`:
 *   bun cli/gen-sha256sums.ts            # write SHA256SUMS.txt
 *   bun cli/gen-sha256sums.ts --check    # verify the folder against it, change nothing
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const MANIFEST = join(ROOT, 'SHA256SUMS.txt')

/** Never part of the handover: build output, dependencies, local state. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', '.vscode'])
const SKIP_FILES = new Set(['SHA256SUMS.txt', '.DS_Store'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
      continue
    }
    if (SKIP_FILES.has(entry.name)) continue
    out.push(relative(ROOT, join(dir, entry.name)).split(sep).join('/'))
  }
  return out
}

const hashOf = (path: string): string =>
  createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')

// Byte order, not locale order: a locale-aware sort puts the same files in a
// different order on a different machine, and the manifest would churn.
const files = walk(ROOT).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const lines = files.map((path) => `${hashOf(path)} ${path}`)

if (process.argv.includes('--check')) {
  const expected = new Map(
    readFileSync(MANIFEST, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.split(' ')
        return [rest.join(' '), hash] as const
      }),
  )
  let bad = 0
  for (const path of files) {
    const want = expected.get(path)
    const got = hashOf(path)
    if (!want) {
      console.log(`MISSING FROM MANIFEST  ${path}`)
      bad++
    } else if (want !== got) {
      console.log(`CHANGED                ${path}`)
      bad++
    }
    expected.delete(path)
  }
  for (const path of expected.keys()) {
    console.log(`GONE FROM FOLDER       ${path}`)
    bad++
  }
  console.log(bad === 0 ? `ok: ${files.length}/${files.length} files match` : `${bad} problem(s) across ${files.length} files`)
  process.exit(bad === 0 ? 0 : 1)
}

writeFileSync(MANIFEST, `${lines.join('\n')}\n`, 'utf8')
console.log(`SHA256SUMS.txt written: ${files.length} files`)
