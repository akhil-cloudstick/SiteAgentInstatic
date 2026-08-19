/**
 * MMS MCP Bridge — server entrypoint.
 *
 * This plugin is NOT an MCP server. It is the headless content backend the
 * Operator MCP gateway calls on behalf of an AI agent.
 *
 * Why it exists at all: the CMS admin HTTP API has no op-based page-tree
 * endpoint (only `PATCH /data/rows/:id`, a whole-cell patch), so editing a
 * page over HTTP would mean read-whole-tree -> mutate in JS -> write-whole-tree
 * back. That loses server-side op validation and silently clobbers a
 * concurrent human edit. `api.cms.content.tree(...).mutate(ops)` runs the
 * canonical `applyTreeOperation` engine server-side instead. Entry CRUD lives
 * here too so one backend owns every content write.
 *
 * Security posture:
 *   - No public routes. Every route is registered with a core capability, so
 *     the host requires a real admin session before a handler ever runs.
 *     Nothing on the internet can reach these endpoints.
 *   - No credentials stored. The plugin holds no keys and no tokens; agent
 *     keys live in the Operator registry and never reach the tenant.
 *   - Table access is gated twice: the manifest `contentAccess[]` allowlist
 *     (enforced host-side by `assertContentTableAccess`) and the per-key
 *     `tables` narrowing the gateway applies before it calls us.
 *
 * Runs inside the QuickJS sandbox: no Node, no Bun, no host globals.
 */

// ---------------------------------------------------------------------------
// Route capabilities — each mirrors the closest core capability for the work
// the route does, so the host's own gate is meaningful rather than nominal.
// ---------------------------------------------------------------------------

const CAP_CONTENT = 'content.manage'
const CAP_PUBLISH = 'pages.publish'
const CAP_TABLES = 'data.custom.tables.manage'

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(status, payload) {
  return {
    __response: true,
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }
}

function fail(status, message) {
  return jsonResponse(status, { error: message })
}

function errorMessage(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) {
    return err.message
  }
  if (typeof err === 'string' && err) return err
  return 'Unknown plugin error'
}

/**
 * Wrap a handler so a thrown error becomes a `{ error }` envelope with a 400
 * rather than a sandbox crash. The gateway forwards that message verbatim into
 * the agent's tool result, so the agent sees the real reason (a contentAccess
 * denial, a missing field) instead of a generic failure.
 */
function handler(api, name, fn) {
  return async function (ctx) {
    try {
      const body = ctx && ctx.body ? ctx.body : {}
      return await fn(body, ctx)
    } catch (err) {
      api.plugin.log('[' + name + '] ' + errorMessage(err))
      return fail(400, errorMessage(err))
    }
  }
}

// ---------------------------------------------------------------------------
// Input guards — the gateway validates too, but this backend is reachable by
// any admin session, so it does not trust its caller.
// ---------------------------------------------------------------------------

function requireString(body, key) {
  const value = body[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('"' + key + '" is required and must be a non-empty string')
  }
  return value
}

function optionalObject(body, key) {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('"' + key + '" must be an object')
  }
  return value
}

function requireObject(body, key) {
  const value = optionalObject(body, key)
  if (value === undefined) {
    throw new Error('"' + key + '" is required and must be an object')
  }
  return value
}

function requireArray(body, key) {
  const value = body[key]
  if (!Array.isArray(value)) {
    throw new Error('"' + key + '" is required and must be an array')
  }
  return value
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function install(api) {
  api.plugin.log('MMS MCP Bridge installed')
}

export function activate(api) {
  const content = api.cms.content
  const routes = api.cms.routes

  // -------------------------------------------------------------------------
  // Health — lets the Operator directory show per-tenant install status.
  // -------------------------------------------------------------------------

  routes.get('/health', CAP_CONTENT, function () {
    return { ok: true, plugin: api.plugin.id, version: api.plugin.version }
  })

  // -------------------------------------------------------------------------
  // Tables
  // -------------------------------------------------------------------------

  routes.post('/tables/list', CAP_CONTENT, handler(api, 'tables/list', async function () {
    return { tables: await content.tables.list() }
  }))

  routes.post('/tables/get', CAP_CONTENT, handler(api, 'tables/get', async function (body) {
    const slug = requireString(body, 'table')
    const table = await content.tables.get(slug)
    if (!table) return fail(404, 'Table "' + slug + '" not found')
    return { table: table }
  }))

  routes.post('/tables/create', CAP_TABLES, handler(api, 'tables/create', async function (body) {
    return { table: await content.tables.create(requireObject(body, 'input')) }
  }))

  // -------------------------------------------------------------------------
  // Entries
  // -------------------------------------------------------------------------

  routes.post('/entries/list', CAP_CONTENT, handler(api, 'entries/list', async function (body) {
    const table = content.table(requireString(body, 'table'))
    return await table.list(optionalObject(body, 'options'))
  }))

  routes.post('/entries/get', CAP_CONTENT, handler(api, 'entries/get', async function (body) {
    const table = content.table(requireString(body, 'table'))
    const entryId = requireString(body, 'entryId')
    const entry = await table.get(entryId)
    if (!entry) return fail(404, 'Entry "' + entryId + '" not found')
    return { entry: entry }
  }))

  routes.post('/entries/get-by-slug', CAP_CONTENT, handler(api, 'entries/get-by-slug', async function (body) {
    const tableSlug = requireString(body, 'table')
    const table = content.table(tableSlug)
    const slug = requireString(body, 'slug')
    const entry = await table.getBySlug(slug)
    if (!entry) return fail(404, 'No entry with slug "' + slug + '" in "' + tableSlug + '"')
    return { entry: entry }
  }))

  routes.post('/entries/create', CAP_CONTENT, handler(api, 'entries/create', async function (body) {
    const table = content.table(requireString(body, 'table'))
    return { entry: await table.create(requireObject(body, 'input')) }
  }))

  routes.post('/entries/update', CAP_CONTENT, handler(api, 'entries/update', async function (body) {
    const table = content.table(requireString(body, 'table'))
    const entryId = requireString(body, 'entryId')
    return { entry: await table.update(entryId, requireObject(body, 'patch')) }
  }))

  routes.post('/entries/delete', CAP_CONTENT, handler(api, 'entries/delete', async function (body) {
    const table = content.table(requireString(body, 'table'))
    await table.delete(requireString(body, 'entryId'))
    return { deleted: true }
  }))

  routes.post('/entries/move', CAP_CONTENT, handler(api, 'entries/move', async function (body) {
    const table = content.table(requireString(body, 'table'))
    const entryId = requireString(body, 'entryId')
    const targetTable = requireString(body, 'targetTable')
    return { entry: await table.moveToTable(entryId, targetTable) }
  }))

  routes.post('/entries/create-many', CAP_CONTENT, handler(api, 'entries/create-many', async function (body) {
    const table = content.table(requireString(body, 'table'))
    return { entries: await table.createMany(requireArray(body, 'inputs')) }
  }))

  routes.post('/entries/update-many', CAP_CONTENT, handler(api, 'entries/update-many', async function (body) {
    const table = content.table(requireString(body, 'table'))
    return { entries: await table.updateMany(requireArray(body, 'updates')) }
  }))

  routes.post('/entries/delete-many', CAP_CONTENT, handler(api, 'entries/delete-many', async function (body) {
    const table = content.table(requireString(body, 'table'))
    return await table.deleteMany(requireArray(body, 'entryIds'))
  }))

  // -------------------------------------------------------------------------
  // Page trees — the reason this plugin exists. Every operation runs through
  // the host's canonical `applyTreeOperation` engine, the same one the visual
  // editor drives, so a malformed op is rejected instead of persisted.
  // -------------------------------------------------------------------------

  routes.post('/tree/read', CAP_CONTENT, handler(api, 'tree/read', async function (body) {
    const entryId = requireString(body, 'entryId')
    const fieldId = requireString(body, 'fieldId')
    return { tree: await content.tree(entryId, fieldId).read() }
  }))

  routes.post('/tree/mutate', CAP_CONTENT, handler(api, 'tree/mutate', async function (body) {
    const entryId = requireString(body, 'entryId')
    const fieldId = requireString(body, 'fieldId')
    const operations = requireArray(body, 'operations')
    if (operations.length === 0) {
      throw new Error('"operations" must contain at least one operation')
    }
    return await content.tree(entryId, fieldId).mutate(operations)
  }))

  routes.post('/tree/replace', CAP_CONTENT, handler(api, 'tree/replace', async function (body) {
    const entryId = requireString(body, 'entryId')
    const fieldId = requireString(body, 'fieldId')
    if (body.tree === undefined || body.tree === null) {
      throw new Error('"tree" is required')
    }
    await content.tree(entryId, fieldId).replace(body.tree)
    return { replaced: true }
  }))

  // -------------------------------------------------------------------------
  // Cross-table helpers
  // -------------------------------------------------------------------------

  routes.post('/search', CAP_CONTENT, handler(api, 'search', async function (body) {
    const query = requireString(body, 'query')
    const limit = typeof body.limit === 'number' ? body.limit : undefined
    return { results: await content.search(query, limit) }
  }))

  routes.post('/snapshot', CAP_CONTENT, handler(api, 'snapshot', async function (body) {
    const entryId = requireString(body, 'entryId')
    const snapshot = await content.getPublishedSnapshot(entryId)
    if (!snapshot) return fail(404, 'Entry "' + entryId + '" has no published snapshot')
    return { snapshot: snapshot }
  }))

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  routes.post('/entries/publish', CAP_PUBLISH, handler(api, 'entries/publish', async function (body) {
    const table = content.table(requireString(body, 'table'))
    const entryId = requireString(body, 'entryId')
    const options = typeof body.scheduledFor === 'string'
      ? { scheduledFor: body.scheduledFor }
      : undefined
    return { entry: await table.publish(entryId, options) }
  }))

  routes.post('/republish-all', CAP_PUBLISH, handler(api, 'republish-all', async function () {
    return await content.republishAll()
  }))

  api.plugin.log('MMS MCP Bridge activated')
}

export function deactivate(api) {
  api.plugin.log('MMS MCP Bridge deactivated')
}

export function uninstall(api) {
  api.plugin.log('MMS MCP Bridge uninstalled')
}
