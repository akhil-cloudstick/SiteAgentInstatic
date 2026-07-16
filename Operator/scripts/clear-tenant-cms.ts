// Clear a tenant's Instatic CMS to a blank slate — all pages + all design
// (colours, styles, fonts, scripts) + the media library — with an automatic
// timestamped backup. The running Instatic reads the site fresh from Postgres,
// so the change takes effect immediately with NO restart.
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
import { writeFileSync, mkdirSync } from 'node:fs'
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

// Verify.
const [{ n: pagesAfter }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".data_rows`) as any[]
const [{ n: mediaAfter }] = await sql.unsafe(`select count(*)::int as n from "${SCHEMA}".media_assets`) as any[]
console.log(`\n✅ Cleared "${slug}" CMS — pages ${pagesBefore} -> ${pagesAfter}, media ${mediaBefore} -> ${mediaAfter}, design reset to blank.`)
console.log('   No restart needed. Reload the CMS editor to see the empty site.')
await sql.end()
