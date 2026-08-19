#!/usr/bin/env node
// Regenerate the manifest's `contentAccess[]` from a tenant's live tables.
//
// Why this exists: a plugin manifest must name every table it may touch — the
// host validates that at install time and fails closed at runtime for anything
// undeclared. That allowlist is what the operator approves, so it cannot be a
// wildcard. The shipped manifest covers the four system tables plus the
// collection names clients commonly create; when a client adds one outside that
// list, run this against their tenant and reinstall the plugin.
//
// Usage:
//   node scripts/regen-content-access.mjs --schema tenant_acme [--write]
//   node scripts/regen-content-access.mjs --url postgres://… --schema … [--write]
//
// Without --write it prints the proposed block and changes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TABLES = 50; // host manifest cap
const MODES = ['read', 'write', 'publish', 'delete'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const write = process.argv.includes('--write');
const schema = arg('schema');
const url = arg('url') || process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;

if (!schema) {
  console.error('error: --schema <tenant schema name> is required');
  process.exit(1);
}
if (!url) {
  console.error('error: pass --url or set ADMIN_DATABASE_URL / DATABASE_URL');
  process.exit(1);
}

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// `pg` lives in the Operator's node_modules; this script is an operator tool,
// so import it from there rather than adding a dependency to the plugin.
let pg;
try {
  pg = (await import('pg')).default;
} catch {
  console.error('error: `pg` not found. Run this from a checkout where Operator/node_modules exists,');
  console.error('       e.g. `cd Operator && node ../plugins/mms-mcp-bridge/scripts/regen-content-access.mjs …`');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let slugs;
try {
  const { rows } = await client.query(
    `select slug from ${'"'}${schema.replace(/"/g, '')}${'"'}.data_tables
      where deleted_at is null order by slug`,
  );
  slugs = rows.map((r) => r.slug);
} finally {
  await client.end();
}

const declared = new Set((manifest.contentAccess || []).map((e) => e.table));
const missing = slugs.filter((s) => !declared.has(s));
// Keep the existing declarations even when a tenant lacks those tables: one
// manifest is installed across many tenants, and dropping a name here would
// silently break a different site.
const merged = [...declared, ...missing];

if (merged.length > MAX_TABLES) {
  console.error(`error: ${merged.length} tables exceeds the host cap of ${MAX_TABLES}.`);
  console.error('       Trim unused seed entries from plugin.json before adding more.');
  process.exit(1);
}

manifest.contentAccess = merged.map((table) => ({ table, modes: [...MODES] }));

console.log(`live tables in ${schema}: ${slugs.length}`);
console.log(`already declared:        ${declared.size}`);
console.log(`newly added:             ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
console.log(`total after merge:       ${merged.length} / ${MAX_TABLES}`);

if (!write) {
  console.log('\n(dry run — pass --write to update plugin.json)');
  process.exit(0);
}
if (missing.length === 0) {
  console.log('\nnothing to write; manifest already covers every live table');
  process.exit(0);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nwrote ${manifestPath}`);
console.log('Bump the plugin version and reinstall so the operator re-approves the new table list.');
