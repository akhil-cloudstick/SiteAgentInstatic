// One-click install of the bridge plugin into a tenant.
//
// Packaging a zip by hand and uploading it through each tenant's admin UI does
// not scale past a handful of sites, so the control-plane does both: it builds
// the package from the plugin source on demand and posts it to the tenant's own
// install endpoint over the hub SSO session. Building on demand (rather than
// committing a prebuilt zip) means the installed bytes can never drift from the
// source in the repo.
//
// The zip is written with STORED entries (no compression). The CMS reads
// packages with fflate's `unzipSync`, which handles stored entries natively, so
// this needs no dependency — and the payload is two small text files.
import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tenantFetch } from './session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Operator/control-plane/mcp -> repo root -> plugins/mms-mcp-bridge
const PLUGIN_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'mms-mcp-bridge');

// Files that make up the runtime package. The test folder and scripts are
// deliberately excluded — they would be extracted onto every tenant.
const PACKAGE_FILES = ['plugin.json', 'server/index.js'];

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/**
 * Build a ZIP archive from `[{ name, data }]` using stored (uncompressed)
 * entries. DOS timestamps are fixed rather than "now" so the same source always
 * produces byte-identical output.
 */
function zipStored(entries) {
  const DOS_TIME = u16(0);
  const DOS_DATE = u16(0x2821); // 2000-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const sum = crc32(data);

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), DOS_TIME, DOS_DATE,
      u32(sum), u32(data.length), u32(data.length),
      u16(nameBuf.length), u16(0), nameBuf, data,
    ]);
    locals.push(local);

    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), DOS_TIME, DOS_DATE,
      u32(sum), u32(data.length), u32(data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBuf,
    ]));
    offset += local.length;
  }

  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}

/** Read the plugin source and return `{ zip, manifest }`. */
export async function buildBridgePackage() {
  const entries = [];
  for (const name of PACKAGE_FILES) {
    entries.push({ name, data: await readFile(join(PLUGIN_DIR, name)) });
  }
  const manifest = JSON.parse(entries[0].data.toString('utf8'));
  return { zip: zipStored(entries), manifest };
}

/**
 * Install (or upgrade) the bridge on one tenant.
 *
 * Permissions are granted from the manifest's own `permissions` array: this is
 * a first-party component whose exact permission set is fixed in this repo and
 * reviewed here, not a third-party package an operator is being asked to trust.
 * The CMS still validates the grant against the manifest and refuses anything
 * undeclared.
 */
export async function installBridge(slug) {
  const { zip, manifest } = await buildBridgePackage();

  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'mms-mcp-bridge.plugin.zip');
  form.append('grantedPermissions', JSON.stringify(manifest.permissions));

  const res = await tenantFetch(slug, '/cms/api/cms/plugins/package', { method: 'POST', body: form });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* fall through to the raw text */
  }
  if (!res.ok) {
    throw new Error((parsed && parsed.error) || text.slice(0, 300) || `install failed (HTTP ${res.status})`);
  }
  return { version: manifest.version, plugin: parsed && parsed.plugin ? parsed.plugin : null };
}
