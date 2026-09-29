// Clear a tenant's Instatic CMS to a blank slate — all pages + all design
// (colours, styles, fonts, scripts) + the media library — plus the PUBLISHED
// site behind the public funnel URL, with an automatic timestamped backup.
// Reload the editor afterwards (hard refresh) — a tab that was open through the
// clear rebinds to the fresh, empty document.
//
// Why the CMS is stubborn: the editor and the published site persist in FOUR places,
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
//   4. The collab CRDT blobs — `collab_documents` (one Yjs state blob per open
//      doc: `site:default` for the shell + page roster, `page:<rowId>` per page).
//      This blob, NOT the JSON, is the live-editing source of truth: the relay
//      (server/collab/relay.ts) hydrates from it on open and re-derives the JSON
//      back into `data_rows` / `site`. Clear the JSON but leave the blobs and
//      every page walks straight back into the editor on the next open — which
//      is exactly what happened before this step existed. The relay's reset seam
//      only sees writes made through the repositories, never our raw SQL.
// With all four cleared, the editor opens empty and the public URL 404s. The
// published state is derived — a re-publish rebuilds it.
//
// ORDER MATTERS: the tenant is STOPPED first, then the DB is cleared, then the
// disk, then it is restarted. A live tenant re-persists its in-memory collab
// docs on a debounce (so a connected editor tab would write the page back) and
// holds `published/` open (EBUSY on SMB), so clearing while it runs is racy.
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
  `select schema_name, port from siteagent_control.tenants where slug = $1`,
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

// 1) STOP the running tenant BEFORE touching the DB. The live tenant process
// holds every open collab doc in memory and re-persists it (CRDT blob + derived
// JSON into `data_rows` / `site`) on a debounce, so a DB clear while it runs is
// racy: any still-connected editor tab writes the old page straight back. It
// also holds the `published/` tree open, which makes the on-disk delete below
// fail EBUSY on Windows/SMB. Killing first removes both problems; the tenant is
// restarted at the end, once the DB and disk are actually empty.
const cpUrl = `http://127.0.0.1:${config.controlPlanePort}`
const TENANT_PORT = Number(tenant.port) || 0

/**
 * Is anything actually serving this tenant?
 *
 * ASKED OF THE PORT, not of the control plane, and that is the whole fix. This
 * used to read `running[]` from `GET /api/health` — a field the control plane
 * returns ONLY to a signed-in platform administrator (server.mjs: "which projects
 * are running is platform detail"). A CLI has no session, so the field was always
 * undefined, every run concluded "not running", the live process was never killed,
 * and its in-memory render cache went on serving the old site. The script then
 * printed "Public URL cleared" because `tenantRecycled` was computed from that
 * same wrong answer.
 *
 * That made the headline claim — all four places — false in exactly the case that
 * matters: a tenant that is up. The cache is place 3, and it is the one an
 * external wipe cannot reach.
 *
 * The port answers without credentials, and it answers the question actually being
 * asked. A refused connection means nothing is serving; anything else means
 * something is.
 */
async function portListening(port: number): Promise<boolean> {
  if (!port) return false
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
      redirect: 'manual',
    })
    return true
  } catch {
    return false
  }
}

/** The pid holding a port, so the tree can be killed. Null when not found. */
function pidOnPort(port: number): number | null {
  if (!port) return null
  try {
    if (process.platform === 'win32') {
      const out = Bun.spawnSync([
        'powershell', '-NoProfile', '-Command',
        `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ])
      const pid = Number(new TextDecoder().decode(out.stdout).trim())
      return Number.isInteger(pid) && pid > 0 ? pid : null
    }
    const out = Bun.spawnSync(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    const pid = Number(new TextDecoder().decode(out.stdout).trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

let tenantWasRunning = false
let tenantStopped = false
try {
  tenantWasRunning = await portListening(TENANT_PORT)
  const pid = tenantWasRunning ? pidOnPort(TENANT_PORT) : null
  if (!tenantWasRunning) {
    // Not running — nothing holds in-memory state; the next start reads the
    // now-empty DB.
    tenantStopped = true
  } else if (pid === null) {
    // Something is serving the port and we cannot tell what. Do NOT proceed as
    // though the cache were clear: the whole point of this step is that place 3
    // cannot be wiped from outside the process. (P2 — a check that cannot run
    // reports failure.)
    throw new Error(
      `port ${TENANT_PORT} is being served but its pid could not be determined, so the ` +
        'in-memory render cache cannot be flushed. Stop the tenant and re-run.',
    )
  } else {
    const rec = { pid, port: TENANT_PORT }
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
    // Waited on the PORT for the same reason it is now used to detect: the
    // control plane's running-set is not readable from here.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400))
      if (!(await portListening(TENANT_PORT))) { tenantStopped = true; break }
    }
    if (!tenantStopped) throw new Error(`tenant is still serving port ${TENANT_PORT} 15s after kill`)
  }
} catch (err) {
  console.error(
    `\n⚠️  Could not stop the running tenant via the control-plane at ${cpUrl}:`,
    err instanceof Error ? err.message : err,
  )
  console.error('   Clearing the DB anyway, but a live editor tab can write its cached page back —')
  console.error('   stop the tenant from the Operator console and re-run this script.')
}

// 2) delete every content row (pages, posts, components, layouts).
await sql.unsafe(`delete from "${SCHEMA}".data_rows`)

// 2b) delete every media asset (hard delete — cascades to media_asset_folders +
// media_usage_refs) and every folder, so a re-share starts from a truly empty
// library instead of accumulating on top of old test pushes.
await sql.unsafe(`delete from "${SCHEMA}".media_assets`)
await sql.unsafe(`delete from "${SCHEMA}".media_folders`)

// 2c) delete the published site snapshots. Deleting data_rows cascades away
// data_row_versions + published_runtime_assets (FK on delete cascade), but the
// data_row_versions -> site_snapshots FK is `on delete set null`, so the
// published SiteDocument rows are orphaned rather than removed. Drop them too so
// the live-render fallback finds nothing and the library is truly empty.
await sql.unsafe(`delete from "${SCHEMA}".site_snapshots`)

// 2d) delete the collab CRDT blobs. THIS is what made the first version of this
// script look like it did nothing: `collab_documents` holds one Yjs state blob
// per open doc (`site:default` = the whole site shell + page roster,
// `page:<rowId>` = one page's content) and that blob — not the JSON — is the
// live-editing SOURCE OF TRUTH (server/collab/relay.ts). On the next open the
// relay hydrates the doc from the blob and re-derives the JSON back into
// `data_rows` / `site`, so every page and style deleted above reappears in the
// editor (and back in the DB). The relay's own reset seam (`attachResetSources`)
// only fires for writes made THROUGH the repositories; raw SQL like ours is
// invisible to it, so the blobs must be deleted here. With the row gone the next
// open seeds an empty doc and mints a fresh CRDT generation — which is also what
// makes a still-open editor tab rebind instead of pushing its stale state back.
await sql.unsafe(`delete from "${SCHEMA}".collab_documents`)

// 3) reset the site shell to a blank design.
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

// 4) delete the on-disk published artefacts (Layer A). On a Linux/Docker install
// the visitor router reads these baked pages through the `current` symlink
// before ever touching the DB, so leaving them keeps the last publish live until
// the next one. (On this SMB box no symlink exists, so Layer A is inert and the
// tenant stop above already dropped the live render — this still removes the stale
// slot so a re-publish starts clean.) The path is keyed by tenant SLUG, not the PG schema;
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

// 5) restart the tenant so it comes up against the now-empty DB with an empty
// in-memory published-render cache (server/publish/renderCache.ts) and publish
// version counter (publishState.ts). Only started if it was running before —
// clearing a stopped tenant leaves it stopped.
// Inferring this was the second half of the bug: "stopped and was not running"
// computed to TRUE on every run, so the script reported the public URL cleared
// without anything having been cleared. It is now only ever set by observing the
// tenant come back, or by observing that it was never up.
let tenantRecycled = tenantStopped && !tenantWasRunning
if (tenantStopped && tenantWasRunning) {
  try {
    const res = await fetch(`${cpUrl}/api/tenants/${slug}/start`, { method: 'POST' })
    const started = (await res.json().catch(() => ({}))) as { healthy?: boolean; port?: number }
    tenantRecycled = Boolean(started?.healthy)
    if (res.status === 401) {
      // The control plane's admin routes need a signed-in administrator (R14),
      // which a CLI does not have.
      console.error(`\n⚠️  The control plane requires admin sign-in, so "${slug}" was not restarted.`)
      console.error('   Start it from the Operator console (Tenants → Start).')
    } else if (!tenantRecycled) {
      console.error(`\n⚠️  Tenant "${slug}" was bounced but did not report healthy on restart.`)
      console.error(`   Check ${tenantPaths(slug).log} and start it from the Operator console.`)
    }
  } catch (err) {
    console.error(
      `\n⚠️  Could not restart tenant "${slug}" via the control-plane:`,
      err instanceof Error ? err.message : err,
    )
    console.error(`   Check ${tenantPaths(slug).log} and start it from the Operator console.`)
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
