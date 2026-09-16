/**
 * Snapshot the importer source the validator may read — siteImport, htmlImport
 * and the CMS import handlers — as one hash-addressed zip for the relay.
 *
 * The partner asked for read access to exactly this code (PLAN v2 §11 Q2). A
 * snapshot uploaded as a relay artefact gives that without a repository grant,
 * and binds every read to a version: "which importer did you check against"
 * becomes a sha256 the validator can quote in an evidence block.
 *
 * Deterministic: entries are in a fixed order with a fixed timestamp, so the
 * same source always produces the same zip and the same hash. MANIFEST.json
 * inside names the commit, whether the working tree differed from it for these
 * paths, and every file's own sha256.
 *
 * Run from S:\SiteAgentHub:
 *   node Operator/scripts/export-import-source.mjs [--out <file.zip>]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// fflate is already installed for Instatic; borrowing it keeps this script
// dependency-free rather than giving Operator its own copy.
const { zipSync, strToU8 } = createRequire(join(REPO, 'Instatic', 'package.json'))('fflate')

const SOURCES = [
  'Instatic/src/core/siteImport',
  'Instatic/src/core/htmlImport',
  'Instatic/server/handlers/cms/import.ts',
  'Instatic/server/handlers/cms/importArchive.ts',
  'Instatic/server/handlers/cms/importPreview.ts',
  'Instatic/server/handlers/cms/importSiteHtml.ts',
]

const FIXED_MTIME = new Date('2000-01-01T00:00:00Z')

function walk(absolute) {
  if (statSync(absolute).isFile()) return [absolute]
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => walk(join(absolute, name)))
}

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const files = SOURCES.flatMap((p) => walk(join(REPO, p)))
  .map((absolute) => relative(REPO, absolute).split(sep).join('/'))
  .sort()

const commit = git('rev-parse', 'HEAD')
// Path-scoped on purpose: a tree-wide status aborts on one unreadable directory.
const dirtyLines = git('status', '--porcelain', '--', ...SOURCES)

const manifest = {
  about:
    'Importer source snapshot for the validator, read-only. Hashes are of the file bytes exported. ' +
    'When dirty is true, the listed files differ from the named commit and the snapshot is of the working tree.',
  commit,
  dirty: dirtyLines !== '',
  dirtyFiles: dirtyLines ? dirtyLines.split('\n').map((line) => line.slice(3)) : [],
  files: files.map((path) => {
    const bytes = readFileSync(join(REPO, path))
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  }),
}

const entries = { 'MANIFEST.json': [strToU8(JSON.stringify(manifest, null, 2) + '\n'), { mtime: FIXED_MTIME }] }
for (const { path } of manifest.files) {
  entries[path] = [new Uint8Array(readFileSync(join(REPO, path))), { mtime: FIXED_MTIME }]
}
const zip = zipSync(entries, { level: 9, mtime: FIXED_MTIME })

const outIndex = process.argv.indexOf('--out')
const out =
  outIndex > -1 && process.argv[outIndex + 1]
    ? resolve(process.argv[outIndex + 1])
    : join(REPO, '.tmp', `import-source-${commit.slice(0, 12)}${manifest.dirty ? '-dirty' : ''}.zip`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, zip)

console.log(
  JSON.stringify(
    { out, sha256: sha256(zip), bytes: zip.length, commit, dirty: manifest.dirty, files: files.length },
    null,
    2,
  ),
)
