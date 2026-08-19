// Plugin route tests.
//
// The entrypoint is plain ESM (the host flattens it for QuickJS with
// `wrapEsmAsGlobal`), so it imports directly here. We drive `activate` with a
// fake `api`, capture the routes it registers, and invoke the handlers — which
// exercises the real capability wiring, input validation and error envelopes
// without needing a running CMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../server/index.js';

function fakeApi(overrides = {}) {
  const routes = [];
  const logs = [];
  const calls = [];

  const record = (name) => (...args) => {
    calls.push({ name, args });
    const stub = overrides[name];
    if (typeof stub === 'function') return stub(...args);
    if (stub !== undefined) return Promise.resolve(stub);
    return Promise.resolve({ ok: true });
  };

  const api = {
    plugin: { id: 'mms.mcp-bridge', version: '1.0.0', log: (m) => logs.push(m) },
    cms: {
      routes: {
        get: (path, capability, handler) => routes.push({ method: 'GET', path, capability, handler }),
        post: (path, capability, handler) => routes.push({ method: 'POST', path, capability, handler }),
      },
      content: {
        tables: {
          list: record('tables.list'),
          get: record('tables.get'),
          create: record('tables.create'),
        },
        table: (slug) => {
          calls.push({ name: 'table', args: [slug] });
          return {
            list: record('entries.list'),
            get: record('entries.get'),
            getBySlug: record('entries.getBySlug'),
            create: record('entries.create'),
            update: record('entries.update'),
            delete: record('entries.delete'),
            publish: record('entries.publish'),
            moveToTable: record('entries.moveToTable'),
            createMany: record('entries.createMany'),
            updateMany: record('entries.updateMany'),
            deleteMany: record('entries.deleteMany'),
          };
        },
        tree: (entryId, fieldId) => {
          calls.push({ name: 'tree', args: [entryId, fieldId] });
          return {
            read: record('tree.read'),
            mutate: record('tree.mutate'),
            replace: record('tree.replace'),
          };
        },
        search: record('search'),
        getPublishedSnapshot: record('snapshot'),
        republishAll: record('republishAll'),
      },
    },
  };
  return { api, routes, logs, calls };
}

function mount(overrides) {
  const ctx = fakeApi(overrides);
  activate(ctx.api);
  ctx.route = (method, path) => {
    const found = ctx.routes.find((r) => r.method === method && r.path === path);
    assert.ok(found, `route ${method} ${path} was not registered`);
    return found;
  };
  ctx.call = (method, path, body) => ctx.route(method, path).handler({ body, req: {}, user: null });
  return ctx;
}

test('registers every route with a capability and no public surface', () => {
  const { routes } = mount();
  assert.ok(routes.length >= 20, `expected the full route set, got ${routes.length}`);
  for (const route of routes) {
    assert.equal(typeof route.capability, 'string');
    assert.ok(route.capability.length > 0, `${route.path} has an empty capability`);
  }
});

test('publish routes are gated on pages.publish, table creation on data.custom.tables.manage', () => {
  const { route } = mount();
  assert.equal(route('POST', '/entries/publish').capability, 'pages.publish');
  assert.equal(route('POST', '/republish-all').capability, 'pages.publish');
  assert.equal(route('POST', '/tables/create').capability, 'data.custom.tables.manage');
  assert.equal(route('POST', '/entries/create').capability, 'content.manage');
});

test('creates an entry through the host content API', async () => {
  const entry = { id: 'e1', tableSlug: 'posts', slug: 'hello' };
  const ctx = mount({ 'entries.create': () => Promise.resolve(entry) });
  const out = await ctx.call('POST', '/entries/create', { table: 'posts', input: { cells: { title: 'Hi' } } });
  assert.deepEqual(out, { entry });
  assert.ok(ctx.calls.some((c) => c.name === 'table' && c.args[0] === 'posts'));
});

test('mutates a page tree through the canonical engine', async () => {
  const result = { tree: { rootNodeId: 'r', nodes: {} }, affectedNodeIds: ['n1'] };
  const ctx = mount({ 'tree.mutate': () => Promise.resolve(result) });
  const ops = [{ kind: 'deleteNode', nodeId: 'n1' }];
  const out = await ctx.call('POST', '/tree/mutate', { entryId: 'e1', fieldId: 'body', operations: ops });
  assert.deepEqual(out, result);
  const call = ctx.calls.find((c) => c.name === 'tree.mutate');
  assert.deepEqual(call.args[0], ops);
});

test('rejects missing and malformed input with a 400 envelope', async () => {
  const ctx = mount();

  const noTable = await ctx.call('POST', '/entries/list', {});
  assert.equal(noTable.status, 400);
  assert.match(JSON.parse(noTable.body).error, /"table" is required/);

  const noOps = await ctx.call('POST', '/tree/mutate', { entryId: 'e', fieldId: 'f', operations: [] });
  assert.equal(noOps.status, 400);
  assert.match(JSON.parse(noOps.body).error, /at least one operation/);

  const badOps = await ctx.call('POST', '/tree/mutate', { entryId: 'e', fieldId: 'f', operations: 'nope' });
  assert.equal(badOps.status, 400);
  assert.match(JSON.parse(badOps.body).error, /must be an array/);
});

test('surfaces a host error (e.g. contentAccess denial) verbatim, not as a crash', async () => {
  const ctx = mount({
    'entries.create': () => Promise.reject(new Error('Plugin "mms.mcp-bridge" may not write table "secrets"')),
  });
  const out = await ctx.call('POST', '/entries/create', { table: 'secrets', input: { cells: {} } });
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).error, 'Plugin "mms.mcp-bridge" may not write table "secrets"');
});

test('returns 404 rather than null for a missing entry', async () => {
  const ctx = mount({ 'entries.get': () => Promise.resolve(null) });
  const out = await ctx.call('POST', '/entries/get', { table: 'pages', entryId: 'nope' });
  assert.equal(out.status, 404);
  assert.match(JSON.parse(out.body).error, /not found/);
});

test('passes scheduledFor through only when it is a string', async () => {
  const ctx = mount({ 'entries.publish': () => Promise.resolve({ id: 'e1' }) });
  await ctx.call('POST', '/entries/publish', { table: 'posts', entryId: 'e1' });
  assert.equal(ctx.calls.find((c) => c.name === 'entries.publish').args[1], undefined);

  const ctx2 = mount({ 'entries.publish': () => Promise.resolve({ id: 'e1' }) });
  await ctx2.call('POST', '/entries/publish', { table: 'posts', entryId: 'e1', scheduledFor: '2026-01-01T00:00:00Z' });
  assert.deepEqual(ctx2.calls.find((c) => c.name === 'entries.publish').args[1], {
    scheduledFor: '2026-01-01T00:00:00Z',
  });
});
