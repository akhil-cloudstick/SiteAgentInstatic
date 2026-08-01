// rebuild-live — rebuild the admin frontend into the SINGLE `dist` folder,
// safely, while tenants are running.
//
//   Usage:  bun run rebuild        (from s:\SiteAgentHub\Instatic)
//   Then:   hard-refresh the browser (Ctrl+Shift+R). No dev-server restart.
//
// Why not just `bun run build`? That writes to `dist` with emptyOutDir=true,
// which CLEARS `dist` mid-serve (the tenant serves it per-request) and can
// re-trip the network-share lock. Instead we build to a scratch dir, then
// robocopy /MIR it into `dist` in place — no clear-gap, one folder.
import { spawnSync } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const scratch = resolve(root, 'dist_scratch')
const dist = resolve(root, 'dist')

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
}

console.log('[rebuild] building frontend -> dist_scratch ...')
let r = run('bun', ['run', 'scripts/vite.ts', 'build', '--outDir', 'dist_scratch'], { cwd: root })
if (r.status !== 0) {
  console.error('[rebuild] vite build failed')
  process.exit(r.status ?? 1)
}

if (!existsSync(resolve(scratch, 'index.html'))) {
  console.error('[rebuild] build incomplete (no index.html in dist_scratch)')
  process.exit(1)
}

console.log('[rebuild] mirroring dist_scratch -> dist (in place) ...')
r = run('robocopy', [scratch, dist, '/MIR', '/NJH', '/NJS', '/NFL', '/NDL', '/R:1', '/W:1'])
// robocopy: exit codes 0-7 = success (>=8 = real failure).
if ((r.status ?? 8) >= 8) {
  console.error(`[rebuild] mirror failed (robocopy exit ${r.status})`)
  process.exit(1)
}

try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ }
console.log('[rebuild] done -> hard-refresh the browser (Ctrl+Shift+R). No restart needed.')
