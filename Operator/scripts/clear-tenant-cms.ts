// Clear a tenant's Instatic CMS to a blank slate — all pages + all design
// (colours, styles, fonts, scripts) + the media library — plus the PUBLISHED
// site behind the public funnel URL, with an automatic timestamped backup.
// The editor draft reads fresh from Postgres, so the CMS editor empties with no
// restart; the public URL needs the extra steps below.
//
// Why the public URL is stubborn: a publish persists the site in THREE places,
// none of which a plain Postgres clear touches:
//   1. DB published rows — `site_snapshots` + `data_row_versions` (the live-render
//      fallback source). Deleting `data_rows` cascades the versions but leaves
//      `site_snapshots` (its FK is `on delete set null`), so we drop those too.
//   2. On-disk baked artefacts — `<uploads>/published/current/<route>.html`
//      (Layer A; server/publish/staticArtefact.ts). The visitor router reads
//      these off disk BEFORE any DB query, so they outlive a DB clear until the
//      next publish's slot swap. We delete the whole `published/` folder.
//   3. The running tenant process's IN-MEMORY render cache + publish-version
//      counter (Layer B; renderCache.ts / publishState.ts). An external wipe
//      can't evict these — only a publish (version bump) or a process restart
//      does — so we recycle the tenant through the control-plane.
// With all three cleared, the public URL 404s (empty site). The published state
// is derived — a re-publish rebuilds it.
//
// Media: `media_assets` is hard-deleted (not soft-deleted like the UI's Trash),
// which cascades to `media_asset_folders` (asset<->folder membership) and
// `media_usage_refs` (FK `on delete cascade`, migrations-pg.ts). `media_folders`
// (folder definitions) is cleared separately since it has no FK to media_assets.
// `media_smart_folders` (saved smart-folder queries) is left alone — it's UI
// config, not asset data.
//
// Usage:   bun Operator/scripts/clear-tenant-cms.ts <tenant-slug>
// Example: bun Operator/scripts/clear-tenant-cms.ts akhil
import config from '../control-plane/lib/env.mjs'
import { tenantPaths } from '../control-plane/runtime/tenantRuntime.mjs'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const slug = (process.argv[2] ?? '').trim()
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: bun Operator/scripts/clear-tenant-cms.ts <tenant-slug>')
  console.error('  e.g. bun Operator/scripts/clear-tenant-cms.ts akhil')
  process.exit(1)
}

const sql = new Bun.SQL(config.adminDatabaseUrl)

// Resolve the tenant's real Postgres schema from the registry (the source of truth).
// The provisioner sanitises the slug (hyphens -> underscores), so `t_<slug>` is wrong
// for any hyphenated slug — e.g. "adithyan-manoj" lives in schema "t_adithyan_manoj".
const [tenant] = await sql.unsafe(
  `select schema_name from siteagent_control.tenants where slug = $1`,
  [slug],
) as any[]
if (!tenant?.schema_name) {
  console.error(`Unknown tenant "${slug}" (not in the control-plane registry).`)
  await sql.end()
  process.exit(1)
}
const SCHEMA = tenant.schema_name as string

// Confirm the tenant's CMS exists.
const found = await sql.unsafe(
  `select 1 from information_schema.tables where table_schema = $1 and table_name = 'site' limit 1`,
  [SCHEMA],
) as unknown[]
if (found.length === 0) {
  console.error(`No CMS found for tenant "${slug}" (schema "${SCHEMA}" has no site table).`)
  await sql.end()
  process.exit(1)
}

// Read current state for the backup.
const [{ n: pagesBefore }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".data_rows`) as any[]
const [{ n: mediaBefore }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".media_assets`) as any[]
const [siteRow] = await sql.unsafe(`select settings_json from "${SCHEMA}".site where id = 'default'`) as any[]
const allRows = await sql.unsafe(`select * from "${SCHEMA}".data_rows`) as any[]
const allMedia = await sql.unsafe(`select * from "${SCHEMA}".media_assets`) as any[]
const allMediaFolders = await sql.unsafe(`select * from "${SCHEMA}".media_folders`) as any[]

// Write a timestamped backup.
const backupDir = resolve(config.root, 'Operator/control-plane/.state/cms-backups')
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = resolve(backupDir, `${slug}-${stamp}.json`)
writeFileSync(backupPath, JSON.stringify({
  slug,
  site: siteRow?.settings_json ?? null,
  data_rows: allRows,
  media_assets: allMedia,
  media_folders: allMediaFolders,
}))
console.log(`Backup: ${pagesBefore} content row(s) + ${mediaBefore} media asset(s) + site design -> ${backupPath}`)

// 1) delete every content row (pages, posts, components, layouts).
await sql.unsafe(`delete from "${SCHEMA}".data_rows`)

// 1b) delete every media asset (hard delete — cascades to media_asset_folders +
// media_usage_refs) and every folder, so a re-share starts from a truly empty
// library instead of accumulating on top of old test pushes.
await sql.unsafe(`delete from "${SCHEMA}".media_assets`)
await sql.unsafe(`delete from "${SCHEMA}".media_folders`)

// 1c) delete the published site snapshots. Deleting data_rows cascades away
// data_row_versions + published_runtime_assets (FK on delete cascade), but the
// data_row_versions -> site_snapshots FK is `on delete set null`, so the
// published SiteDocument rows are orphaned rather than removed. Drop them too so
// the live-render fallback finds nothing and the library is truly empty.
await sql.unsafe(`delete from "${SCHEMA}".site_snapshots`)

// 2) reset the site shell to a blank design.
const raw = siteRow?.settings_json
  ? (typeof siteRow.settings_json === 'string' ? JSON.parse(siteRow.settings_json) : siteRow.settings_json)
  : { site: {} }
raw.site = raw.site ?? {}
raw.site.styleRules = {}
raw.site.settings = raw.site.settings ?? {}
raw.site.settings.framework = { colors: { tokens: [] } }
raw.site.settings.fonts = { items: [], tokens: [] }
raw.site.files = []
raw.site.runtime = { dependencyLock: { version: 1, packages: {}, updatedAt: 0 }, scripts: {}, styles: {} }
await sql.unsafe(
  `update "${SCHEMA}".site set settings_json = $1::jsonb, updated_at = current_timestamp where id = 'default'`,
  [JSON.stringify(raw)],
)

// 3) recycle the running tenant so its in-memory published-render cache is
// dropped. The public URL is served by the long-running tenant process; its
// render cache (server/publish/renderCache.ts) and publish-version counter
// (publishState.ts) live in that process's MEMORY. An external DB/disk wipe
// cannot evict them — only a publish (which bumps the version) or a process
// restart does. On this deployment the on-disk `current` symlink can't be
// created (SMB share), so Layer A never serves and the live URL is 100% the
// in-memory cache: without this bounce the funnel keeps serving the last render
// even though the DB is now empty. Bounce it via the control-plane: read the
// running pid from /api/health, kill it, wait for the control-plane to drop it,
// then POST .../start so it respawns fresh (empty cache, reads the empty DB).
//
// This runs BEFORE the on-disk delete below: the live tenant holds the
// `published/` tree open (its per-request artefact reads), so deleting it first
// fails EBUSY on Windows/SMB. Killing the process releases the handle.
const cpUrl = `http://127.0.0.1:${config.controlPlanePort}`
type HealthBody = { running?: Array<{ slug: string; pid: number; port: number }> }
let tenantRecycled = false
let tenantWasRunning = false
try {
  const health = (await fetch(`${cpUrl}/api/health`).then((r) => r.json())) as HealthBody
  const rec = health.running?.find((r) => r.slug === slug)
  if (!rec) {
    // Not running — the next start reads the now-empty DB, so there is no live
    // in-memory cache to flush.
    tenantRecycled = true
  } else {
    tenantWasRunning = true
    // Kill the whole process tree. The control-plane spawns tenants through a
    // shell on Windows, so taskkill /T reaps the shell + the bun child.
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(rec.pid), '/T', '/F'])
    } else {
      try { process.kill(rec.pid, 'SIGTERM') } catch { /* already gone */ }
    }
    // Wait for the control-plane's child-exit handler to remove it from the
    // running set BEFORE asking it to start again — otherwise `startTenant` sees
    // it as still-running and no-ops, leaving the tenant down.
    const deadline = Date.now() + 15_000
    let gone = false
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400))
      const h = (await fetch(`${cpUrl}/api/health`).then((r) => r.json()).catch(() => null)) as HealthBody | null
      if (h && !h.running?.some((r) => r.slug === slug)) { gone = true; break }
    }
    if (!gone) throw new Error('tenant process still listed as running 15s after kill')
    // Respawn fresh — the control-plane blocks until it answers HTTP again.
    const started = (await fetch(`${cpUrl}/api/tenants/${slug}/start`, { method: 'POST' })
      .then((r) => r.json())) as { healthy?: boolean; port?: number }
    tenantRecycled = Boolean(started?.healthy)
    if (!tenantRecycled) {
      console.error(`\n⚠️  Tenant "${slug}" was bounced but did not report healthy on restart.`)
      console.error(`   Check ${tenantPaths(slug).log} and start it from the Operator console.`)
    }
  }
} catch (err) {
  console.error(
    `\n⚠️  Could not recycle the running tenant via the control-plane at ${cpUrl}:`,
    err instanceof Error ? err.message : err,
  )
  console.error('   The public URL will keep serving the cached site until the tenant restarts.')
  console.error('   Restart it (Operator console, or `npm run dev` from Operator) to finish clearing the live URL.')
}

// 4) delete the on-disk published artefacts (Layer A). On a Linux/Docker install
// the visitor router reads these baked pages through the `current` symlink
// before ever touching the DB, so leaving them keeps the last publish live until
// the next one. (On this SMB box no symlink exists, so Layer A is inert and the
// bounce above already cleared the URL — this still removes the stale slot so a
// re-publish starts clean.) The path is keyed by tenant SLUG, not the PG schema;
// `tenantPaths` is the single source of truth for tenant on-disk layout.
// Deleting the whole `published/` dir removes both slots (a, b) and `current`;
// the next publish recreates it via `prepareInactiveSlot`. `rm` unlinks the
// `current` entry itself, never following it. Retry briefly: the SMB share can
// hold the handle open for a moment after the old process dies.
const publishedDir = tenantPaths(slug).published
let publishedState: 'removed' | 'absent' | 'failed' = 'absent'
if (existsSync(publishedDir)) {
  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(publishedDir, { recursive: true, force: true })
      publishedState = 'removed'
      break
    } catch (err) {
      lastErr = err
      publishedState = 'failed'
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  if (publishedState === 'failed') {
    console.error(
      `\n⚠️  Could not delete published artefacts at ${publishedDir}:`,
      lastErr instanceof Error ? lastErr.message : lastErr,
    )
    console.error('   Harmless for the live URL (the tenant was already recycled), but the stale')
    console.error('   slot lingers — delete the folder by hand, or re-run once the file lock clears.')
  }
}

// Verify.
const [{ n: pagesAfter }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".data_rows`) as any[]
const [{ n: mediaAfter }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".media_assets`) as any[]
console.log(`\n✅ Cleared "${slug}" CMS — pages ${pagesBefore} -> ${pagesAfter}, media ${mediaBefore} -> ${mediaAfter}, design reset to blank.`)
console.log(
  publishedState === 'removed'
    ? '   On-disk published artefacts removed.'
    : publishedState === 'failed'
      ? '   On-disk published artefacts could NOT be removed (see warning above).'
      : '   (No published artefacts on disk to remove.)',
)
console.log(
  tenantRecycled
    ? `   Public URL cleared — tenant ${tenantWasRunning ? 'recycled' : 'was not running'}; it now serves the empty site.`
    : '   ⚠️  Public URL NOT cleared yet — restart the tenant to flush its in-memory cache (see above).',
)
console.log('   Reload the CMS editor to see the empty site.')
await sql.end()
