#!/usr/bin/env node
// End-to-end smoke test for the MCP gateway. Exercises the real wire protocol
// against a running control-plane, exactly as an agent would.
//
//   node control-plane/mcp/smoke.mjs --tenant <slug> --key mmsmcp_…
//   node control-plane/mcp/smoke.mjs --tenant <slug> --key … --url http://127.0.0.1:4400
//
// Read-only by default: it lists tools and reads tables. Add --write to also
// create a draft entry (never publishes), and --cleanup to delete it afterwards.
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);

const tenant = arg('tenant');
const key = arg('key');
const base = arg('url') || 'http://127.0.0.1:4400';

if (!tenant || !key) {
  console.error('usage: node control-plane/mcp/smoke.mjs --tenant <slug> --key mmsmcp_… [--url …] [--write] [--cleanup]');
  process.exit(1);
}

const endpoint = `${base.replace(/\/$/, '')}/mcp/${tenant}`;
let id = 0;
let failures = 0;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function ok(label, detail) {
  console.log(`${green('PASS')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
}
function bad(label, detail) {
  failures++;
  console.log(`${red('FAIL')} ${label}${detail ? `  ${detail}` : ''}`);
}

async function rpc(method, params, { token = key } = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* leave null; the caller reports the raw status */
  }
  return { status: res.status, body, text };
}

// A tool result carries its payload as text — parse it back for assertions.
function toolPayload(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

console.log(`\n  endpoint  ${endpoint}`);
console.log(`  key       ${key.slice(0, 14)}…\n`);

// ---------------------------------------------------------------------------

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} }).catch((e) => ({ error: e }));
if (init.error) {
  console.log(red(`\nCould not reach ${endpoint}`));
  console.log(`  ${init.error.message}`);
  console.log(dim('  Is the control-plane running?  cd Operator && npm run dev\n'));
  process.exit(1);
}
if (init.status === 401) {
  bad('initialize', `401 — ${init.body?.error?.message || 'key rejected'}`);
  console.log(dim('\n  Check the key is for THIS tenant and has not been revoked or expired.\n'));
  process.exit(1);
}
if (init.body?.result?.protocolVersion) {
  ok('initialize', `protocol ${init.body.result.protocolVersion} · ${init.body.result.serverInfo.name}`);
} else {
  bad('initialize', JSON.stringify(init.body || init.text).slice(0, 200));
}

// ---------------------------------------------------------------------------

const list = await rpc('tools/list');
const tools = list.body?.result?.tools || [];
if (tools.length) {
  ok('tools/list', `${tools.length} tools visible to this key`);
  const content = tools.filter((t) => t.name.startsWith('cms_')).length;
  const media = tools.filter((t) => t.name.startsWith('media_')).length;
  const design = tools.filter((t) => t.name.startsWith('design_')).length;
  console.log(dim(`       content ${content} · media ${media} · design ${design}`));
  console.log(dim(`       ${tools.map((t) => t.name).join(', ')}`));
} else {
  bad('tools/list', 'no tools returned — does the key have any permissions?');
}

// ---------------------------------------------------------------------------

const has = (name) => tools.some((t) => t.name === name);

if (has('cms_list_tables')) {
  const res = await rpc('tools/call', { name: 'cms_list_tables', arguments: {} });
  const payload = toolPayload(res.body?.result);
  if (res.body?.result?.isError) {
    bad('cms_list_tables', String(payload).slice(0, 300));
    console.log(dim('       If this says "not found", the bridge plugin is not installed on this tenant.'));
  } else if (payload?.tables) {
    ok('cms_list_tables', `${payload.tables.length} tables: ${payload.tables.map((t) => t.slug).join(', ')}`);
  } else {
    bad('cms_list_tables', JSON.stringify(payload).slice(0, 200));
  }
} else {
  console.log(dim('SKIP cms_list_tables — key lacks `read`'));
}

if (has('media_list')) {
  const res = await rpc('tools/call', { name: 'media_list', arguments: { limit: 5 } });
  const payload = toolPayload(res.body?.result);
  if (res.body?.result?.isError) bad('media_list', String(payload).slice(0, 300));
  else ok('media_list', `reached the media library (${(payload?.assets || []).length} shown)`);
} else {
  console.log(dim('SKIP media_list — key lacks `media.read`'));
}

// ---------------------------------------------------------------------------
// The permission gate: a tool the key cannot use must be refused even when
// called directly by name, not merely hidden from tools/list.
// ---------------------------------------------------------------------------

const ungranted = ['cms_create_table', 'cms_republish_all', 'cms_delete_entry', 'design_update_site']
  .find((name) => !has(name));

if (ungranted) {
  const res = await rpc('tools/call', { name: ungranted, arguments: { table: 'posts', entryId: 'x', input: {}, patch: {} } });
  const text = res.body?.result?.content?.[0]?.text || '';
  if (res.body?.result?.isError && /does not hold/.test(text)) {
    ok('permission gate', `${ungranted} refused: "${text.slice(0, 70)}…"`);
  } else {
    bad('permission gate', `${ungranted} was NOT refused — ${JSON.stringify(res.body).slice(0, 200)}`);
  }
} else {
  console.log(dim('SKIP permission gate — this key holds everything; try a read-only key too'));
}

// ---------------------------------------------------------------------------

const badKey = await rpc('tools/list', {}, { token: 'mmsmcp_definitely_not_a_real_key' });
if (badKey.status === 401) ok('bad key rejected', '401');
else bad('bad key rejected', `expected 401, got ${badKey.status}`);

const wrongTenant = await fetch(`${base.replace(/\/$/, '')}/mcp/${tenant}-nope`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/list' }),
}).catch(() => null);
if (wrongTenant && wrongTenant.status === 401) ok('cross-tenant use rejected', '401');
else bad('cross-tenant use rejected', `expected 401, got ${wrongTenant ? wrongTenant.status : 'no response'}`);

// ---------------------------------------------------------------------------
// Optional write path — creates a DRAFT only, never publishes.
// ---------------------------------------------------------------------------

if (flag('write')) {
  if (!has('cms_create_entry')) {
    console.log(dim('SKIP write test — key lacks `create`'));
  } else {
    const slug = `mcp-smoke-${Date.now()}`;
    const res = await rpc('tools/call', {
      name: 'cms_create_entry',
      arguments: { table: 'posts', input: { slug, cells: { title: 'MCP smoke test' } } },
    });
    const payload = toolPayload(res.body?.result);
    if (res.body?.result?.isError) {
      bad('cms_create_entry', String(payload).slice(0, 300));
    } else if (payload?.entry?.id) {
      ok('cms_create_entry', `draft ${payload.entry.id} (slug ${slug}) — not published`);

      if (flag('cleanup') && has('cms_delete_entry')) {
        const del = await rpc('tools/call', {
          name: 'cms_delete_entry',
          arguments: { table: 'posts', entryId: payload.entry.id },
        });
        if (del.body?.result?.isError) bad('cleanup', String(toolPayload(del.body.result)).slice(0, 200));
        else ok('cleanup', 'draft soft-deleted (restorable from Trash)');
      } else if (flag('cleanup')) {
        console.log(dim('SKIP cleanup — key lacks `delete`; remove the draft in the CMS'));
      } else {
        console.log(dim(`       leave it or delete it in the CMS; pass --cleanup to remove it automatically`));
      }
    } else {
      bad('cms_create_entry', JSON.stringify(payload).slice(0, 200));
    }
  }
}

console.log(failures === 0 ? green(`\nAll checks passed.\n`) : red(`\n${failures} check(s) failed.\n`));
process.exit(failures === 0 ? 0 : 1);
