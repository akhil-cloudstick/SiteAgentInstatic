/**
 * Seed the Site fidelity baselines from the approved MMSBUILD screen library.
 *
 *   bun scripts/seed-site-fidelity-baselines.mjs
 *
 * Copies `screens/site/captures/*.png` from the design handoff into
 * `tests/e2e/site-fidelity.e2e.ts-snapshots/`, which is where Playwright looks
 * for the baselines that `tests/e2e/site-fidelity.e2e.ts` diffs against.
 *
 * Why a seeding step rather than committing the captures: the screen library
 * is a design handoff, not a repo dependency. Copying on demand keeps the
 * approved artwork out of the repo while letting anyone who has the handoff
 * run the pixel gate. Re-run this whenever a new handoff lands.
 *
 * Point `SITE_REFERENCE_DIR` at the bundle's `screens/site` directory if it is
 * not at the default 2026-08-01 handoff path.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REFERENCE_DIR = process.env.SITE_REFERENCE_DIR ?? resolve(
  'c:/Users/itsinfra/Downloads/mmsbuild-instatic-screen-library-site-20260801',
  'mmsbuild-instatic-screen-library/screens/site',
)
const CAPTURES = join(REFERENCE_DIR, 'captures')
const SNAPSHOT_DIR = resolve('tests/e2e/site-fidelity.e2e.ts-snapshots')

if (!existsSync(CAPTURES)) {
  console.error(`[fidelity] approved captures not found at ${CAPTURES}`)
  console.error('[fidelity] set SITE_REFERENCE_DIR to the bundle\'s screens/site directory.')
  process.exit(2)
}

mkdirSync(SNAPSHOT_DIR, { recursive: true })

let copied = 0
for (const file of readdirSync(CAPTURES)) {
  if (!file.endsWith('.png')) continue
  copyFileSync(join(CAPTURES, file), join(SNAPSHOT_DIR, file))
  copied += 1
}

console.log(`[fidelity] seeded ${copied} baseline(s) into ${SNAPSHOT_DIR}`)
console.log('[fidelity] run: bun run test:e2e -- site-fidelity')
