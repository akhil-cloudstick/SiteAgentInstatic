// MCP gateway tests — protocol shape, the permission gate, and bearer handling.
//
// These run without a database or a tenant. Audit and last-used writes are
// fire-and-forget with their own `.catch`, so a missing DB is silent; the pool
// is closed in `after` so the process exits.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { handleRpcMessage, handleRpcPayload, LATEST_PROTOCOL_VERSION } from './protocol.mjs';
import {
  toolAllowedForProfile,
  refuseToolCall,
  normalizePermissions,
  normalizeTables,
  PERMISSION_PRESETS,
  AGENT_PERMISSIONS,
} from './permissions.mjs';
import { ALL_TOOLS, findTool } from './tools/index.mjs';
import { pool } from '../registry/db.mjs';

after(() => pool.end().catch(() => {}));

const profile = (permissions, tables = ['*']) => ({
  keyId: 'mk_test',
  tenantSlug: 'acme',
  label: 'test',
  permissions,
  tables,
});

const FULL = profile(PERMISSION_PRESETS.full);
const ctx = (p = FULL) => ({ slug: 'acme', profile: p });

// ---------------------------------------------------------------------------
// Catalog integrity
// ---------------------------------------------------------------------------

test('every tool is well-formed and uses a known permission', () => {
  assert.ok(ALL_TOOLS.length > 20);
  const names = new Set();
  for (const tool of ALL_TOOLS) {
    assert.ok(tool.name, 'tool without a name');
    assert.ok(!names.has(tool.name), `duplicate tool name ${tool.name}`);
    names.add(tool.name);
    assert.ok(AGENT_PERMISSIONS.includes(tool.permission), `${tool.name} has unknown permission`);
    assert.equal(typeof tool.run, 'function');
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 40, `${tool.name} needs a fuller description`);
  }
});

test('no user or role tool exists in the catalog', () => {
  const identity = ALL_TOOLS.filter((t) => /user|role/i.test(t.name));
  assert.deepEqual(identity, [], 'identity management is out of scope and must not be reachable');
});

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

test('initialize advertises tools and echoes a supported protocol version', async () => {
  const res = await handleRpcMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, ctx());
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.ok(res.result.capabilities.tools);
  assert.match(res.result.serverInfo.name, /acme/);

  const pinned = await handleRpcMessage(
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    ctx(),
  );
  assert.equal(pinned.result.protocolVersion, '2024-11-05');
});

test('ping answers empty', async () => {
  const res = await handleRpcMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, ctx());
  assert.deepEqual(res.result, {});
});

test('notifications get no response', async () => {
  const res = await handleRpcMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx());
  assert.equal(res, null);
});

test('an unknown method is a protocol error, not a crash', async () => {
  const res = await handleRpcMessage({ jsonrpc: '2.0', id: 4, method: 'nope/nope' }, ctx());
  assert.equal(res.error.code, -32601);
});

test('a batch returns one response per request and drops notifications', async () => {
  const res = await handleRpcPayload(
    [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ],
    ctx(),
  );
  assert.equal(res.length, 2);
  assert.deepEqual(res.map((r) => r.id), [1, 2]);
});

// ---------------------------------------------------------------------------
// The permission gate — the only ceiling on an agent
// ---------------------------------------------------------------------------

test('tools/list is filtered to the granted permissions', async () => {
  const readOnly = await handleRpcMessage(
    { jsonrpc: '2.0', id: 5, method: 'tools/list' },
    ctx(profile(PERMISSION_PRESETS['read-only'])),
  );
  const names = readOnly.result.tools.map((t) => t.name);
  assert.ok(names.includes('cms_list_entries'));

  // Assert on the PERMISSION each listed tool needs, not on its name — a read
  // tool may legitimately mention a write word (cms_get_published_snapshot).
  const granted = new Set(PERMISSION_PRESETS['read-only']);
  const leaked = readOnly.result.tools
    .map((t) => findTool(t.name))
    .filter((t) => !granted.has(t.permission));
  assert.deepEqual(leaked.map((t) => t.name), [], 'a read-only key was offered a tool it cannot use');

  // And nothing that mutates is reachable at all.
  const mutating = new Set(['create', 'edit', 'delete', 'publish', 'tables.manage', 'media.write', 'media.delete', 'design.edit']);
  assert.ok(
    !readOnly.result.tools.some((t) => mutating.has(findTool(t.name).permission)),
    'a read-only key saw a mutating tool',
  );

  const full = await handleRpcMessage({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, ctx());
  assert.equal(full.result.tools.length, ALL_TOOLS.length);
});

test('a tool never listed is still refused when called directly', async () => {
  const readOnly = ctx(profile(PERMISSION_PRESETS['read-only']));
  const res = await handleRpcMessage(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'cms_delete_entry', arguments: { table: 'posts', entryId: 'e1' } },
    },
    readOnly,
  );
  // A refusal is a tool-level error so the agent can recover, not a transport error.
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /does not hold the "delete" permission/);
});

test('table narrowing is enforced on the call, not just advertised', () => {
  const scoped = profile(['read', 'edit'], ['posts']);
  assert.equal(refuseToolCall(findTool('cms_update_entry'), scoped, { table: 'posts', patch: {} }), null);
  assert.match(
    refuseToolCall(findTool('cms_update_entry'), scoped, { table: 'pages', patch: {} }),
    /scoped to posts/,
  );
});

test('a wildcard key reaches every table', () => {
  const wide = profile(['edit'], ['*']);
  assert.equal(refuseToolCall(findTool('cms_update_entry'), wide, { table: 'anything' }), null);
});

test('publish is independently grantable', () => {
  const author = profile(PERMISSION_PRESETS.author);
  assert.equal(toolAllowedForProfile(findTool('cms_publish_entry'), author), false);
  assert.equal(toolAllowedForProfile(findTool('cms_publish_entry'), profile(PERMISSION_PRESETS.publisher)), true);
});

test('an unknown tool name is a method-not-found error', async () => {
  const res = await handleRpcMessage(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'rm_rf_site' } },
    ctx(),
  );
  assert.equal(res.error.code, -32601);
});

test('tools/call without a name is an invalid-params error', async () => {
  const res = await handleRpcMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }, ctx());
  assert.equal(res.error.code, -32602);
});

// ---------------------------------------------------------------------------
// Profile normalisation
// ---------------------------------------------------------------------------

test('normalisation drops unknown permissions and de-duplicates', () => {
  assert.deepEqual(normalizePermissions(['read', 'read', 'sudo', 'publish']), ['read', 'publish']);
  assert.deepEqual(normalizePermissions('nonsense'), []);
});

test('empty or wildcard table lists collapse to *', () => {
  assert.deepEqual(normalizeTables([]), ['*']);
  assert.deepEqual(normalizeTables(undefined), ['*']);
  assert.deepEqual(normalizeTables(['posts', '*']), ['*']);
  assert.deepEqual(normalizeTables(['posts', 'posts', 'pages']), ['posts', 'pages']);
});

test('a tool run failure surfaces as an isError result carrying the real message', async () => {
  const tool = findTool('cms_list_tables');
  const original = tool.run;
  tool.run = () => Promise.reject(new Error('Tenant "acme" has no running port — start it first'));
  try {
    const res = await handleRpcMessage(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'cms_list_tables', arguments: {} } },
      ctx(),
    );
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /no running port/);
    assert.equal(res.error, undefined, 'a tool failure must not become a transport error');
  } finally {
    tool.run = original;
  }
});
