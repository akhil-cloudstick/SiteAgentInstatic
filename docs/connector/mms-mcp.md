# MMS MCP — one MCP endpoint per site

Gives an external AI agent (Claude, n8n, Codex, a custom bot) scoped access to one MMS-CMS
tenant: create and edit pages, blogs and content, build page layouts, manage media, edit the
global design — with per-agent permissions.

**No Instatic code was changed.** The CMS's own built-in MCP server at `/_instatic/mcp` keeps
working exactly as before; this is a separate endpoint and the two coexist.

---

## The endpoint

```
POST https://<gatewayOrigin>/mcp/<tenant-slug>
Authorization: Bearer mmsmcp_…
```

One URL, one flat tool list, one key. Connect with Claude Code:

```sh
claude mcp add mms-cms --transport http https://<gatewayOrigin>/mcp/<tenant-slug> \
  --header "Authorization: Bearer mmsmcp_…"
```

Transport is Streamable HTTP answering with `application/json` (no SSE) — what Claude Code,
Codex and `mcp-remote` all accept.

---

## Why it is built this way

Instatic already ships an MCP server with OAuth, bearer tokens and capability scoping. It could
not be used for this, because **every write tool in it is browser-bridged**:
`server/ai/mcp/registry.ts` states *"There is deliberately no headless DB-mutating page-tree
tool"* and `server/ai/mcp/server.ts` returns *"cannot run headlessly"*. An external agent can
read and publish through it, but cannot create or edit anything unless a human has the editor
open in a browser.

Three constraints then shaped this design:

1. **The plugin sandbox has content but no media.** It exposes the full headless content API
   (`cms.content.entries.*`, `cms.content.tree.mutate/replace`, `cms.content.tables.create`,
   `cms.content.republishAll`) but only three media *registration* targets — never uploads. It
   also cannot call the CMS's own API to compensate: `server/plugins/host/network.ts`
   SSRF-blocks loopback and private addresses.
2. **The admin HTTP API has media and design**, but needs a real session — which only the
   unsandboxed Operator control-plane can obtain.
3. **The admin HTTP API has no op-based page-tree endpoint.** `PATCH /data/rows/:id` is a
   whole-cell patch, so page edits through it lose server-side operation validation and clobber
   concurrent human edits.

Hence: one gateway, two backends, and the agent sees neither.

```
   agent ──Bearer mmsmcp_──►  https://<gatewayOrigin>/mcp/<tenant-slug>
                                          │
                             Operator MCP gateway (Node, unsandboxed)
                               · MCP protocol lives here and only here
                               · agent keys + permission gate live here
                               · audit rows written here
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
        tenant plugin  mms.mcp-bridge               tenant admin HTTP API
        internal JSON routes — NOT an MCP           over hub SSO session
        gated on real CMS capabilities

        content CRUD · page tree ·                  media upload / replace /
        tables · publish                            delete / folders · design
```

**The plugin is not a second MCP.** It speaks plain JSON over capability-gated CMS routes, has no
protocol layer, no keys, no public endpoint and no storage. Agents never connect to it.

---

## Tenant authentication — the one hub login

There is a single login into the hub and no second login anywhere, so the gateway does not invent
one. It mints the same short-lived signed SSO token the hub already hands a browser
(`signValue({ sub, target: 'instatic', kind: 'sso' })`, verified by the CMS in
`server/auth/tenantSso.ts`), follows the 302 and keeps the session cookie.

**No CMS password is read or stored.** `owner_password_enc` is never touched. Requests go to the
tenant's loopback port rather than the public gateway, because the gateway proxy routes by hub
session cookie and there is no browser session here. The CMS's CSRF check trusts a request with
no `Origin` header (server-to-server), so these calls send none.

### Security consequence — read this

That SSO session is the **Owner**, with step-up pre-granted, so **the CMS imposes no ceiling on
the gateway.** The per-key permission profile is the only thing limiting an agent, and CMS audit
rows attribute agent actions to the owner.

What bounds the blast radius:

- **Identity is unreachable.** No user or role tool exists in the catalog, so a fully-permissioned
  key still cannot create an account, escalate a role, or lock anyone out. A test asserts this.
- **Damage is recoverable.** Entry deletes are soft (Trash), media deletes are soft
  (`media_restore`), and permanent purge is not exposed.
- **Two enforcement passes.** The gate filters `tools/list` and runs again inside `tools/call`,
  so a client that hard-codes a tool name it never saw listed is still refused.
- **Separable audit.** Every call writes a row to `siteagent_control.mcp_agent_audit` with the
  originating key — the only place agent activity is distinguishable from human activity.
- **Instant kill.** Revoking a key takes effect on the next request; keys can also carry an expiry.

If you later want a hard CMS-side ceiling, provisioning a dedicated agent user per tenant is the
upgrade path and does not change any of this design.

---

## Permissions

| Permission | Grants |
|---|---|
| `read` | List and read tables, entries, page trees, published snapshots, search |
| `create` | Create entries (single and batch) |
| `edit` | Update entries, move between tables, mutate/replace page trees |
| `delete` | Soft-delete entries |
| `publish` | Publish or schedule an entry; republish all published pages |
| `tables.manage` | Create new content tables |
| `media.read` | Browse the media library |
| `media.write` | Upload, replace, retag, re-folder, restore media |
| `media.delete` | Soft-delete media |
| `design.edit` | Read and update the site shell: design tokens, style rules, breakpoints, settings |

Presets in the console: **read-only**, **author** (read/create/edit + media), **publisher**
(author + publish), **full**.

A key is also narrowed by `tables` — either `*` or an explicit list. That narrowing is checked
before the call reaches a backend, on top of the plugin manifest's own `contentAccess[]`
allowlist.

---

## Tools

Content and page structure (routed to the plugin):

`cms_list_tables` · `cms_get_table` · `cms_list_entries` · `cms_get_entry` ·
`cms_get_entry_by_slug` · `cms_search` · `cms_get_published_snapshot` · `cms_create_entry` ·
`cms_create_entries` · `cms_update_entry` · `cms_update_entries` · `cms_move_entry` ·
`cms_delete_entry` · `cms_delete_entries` · `cms_read_tree` · `cms_mutate_tree` ·
`cms_replace_tree` · `cms_create_table` · `cms_publish_entry` · `cms_republish_all`

Media and design (routed to the admin API):

`media_list` · `media_upload` · `media_update_metadata` · `media_set_folders` · `media_replace` ·
`media_delete` · `media_restore` · `design_read_site` · `design_update_site`

Two things worth knowing when writing agent prompts:

- **Pages and blog posts are rows.** Pages live in the `pages` table, posts in `posts`. Custom
  collections vary per client — call `cms_list_tables` first.
- **Page layout is built with `cms_mutate_tree`,** not by writing HTML into a field. It applies
  the 11 canonical operations (`insertNode`, `moveNode`, `updateNodeProps`,
  `setBreakpointOverride`, `wrapNode`, …) through the CMS's own engine.
- **Everything stays a draft** until `cms_publish_entry`.

`media_upload` takes `base64` bytes, or a `sourceUrl` restricted to https with private and
loopback addresses refused — otherwise the gateway would be a fetch-anything proxy inside the
operator's network.

---

## Setup

1. **Migrate the registry.** The control-plane applies `registry/schema.sql` on boot; it is
   idempotent, and the new `mcp_agents` / `mcp_agent_audit` tables are additive.
2. **Install the bridge plugin on each tenant** — press **Install bridge** on that site's row in
   the console's endpoint directory. The control-plane builds the package from the plugin source
   and posts it to the tenant's own install endpoint over the SSO session; there is no zip to
   make and nothing to upload. Press it again after the plugin changes to upgrade in place.
   Media and design tools work without the bridge; content tools need it.
3. **Mint a key** in the Operator console → **MCP Agents**. Pick the site, the permissions and
   optionally a table narrowing and an expiry. The plaintext key is shown **once**.
4. **Point the agent at the endpoint** with the snippet the console prints.

The console's **Endpoint directory** lists every tenant, its endpoint, whether the bridge plugin
is installed, active key count and last use.

---

## Layout

| Path | Role |
|---|---|
| `Operator/control-plane/mcp/gateway.mjs` | HTTP entry, bearer auth, tenant binding |
| `Operator/control-plane/mcp/protocol.mjs` | JSON-RPC 2.0 + MCP methods |
| `Operator/control-plane/mcp/permissions.mjs` | The single permission gate + presets |
| `Operator/control-plane/mcp/session.mjs` | Hub SSO sign-in, session cache, tenant fetch |
| `Operator/control-plane/mcp/tools/` | The unified catalog (`content`, `media`, `design`) |
| `Operator/control-plane/registry/mcpAgents.mjs` | Key mint / verify / revoke + audit |
| `Operator/ui/src/pages/mcp.astro` | Console page |
| `plugins/mms-mcp-bridge/` | The in-tenant content backend |

Existing files touched: one mount line in `control-plane/server.mjs`, the console API block in
the same file, an idempotent append to `registry/schema.sql`, and one nav entry in
`ui/src/layouts/Layout.astro`.

---

## Tests

Offline — no services, no database:

```sh
node --test Operator/control-plane/mcp/gateway.test.mjs
node --test plugins/mms-mcp-bridge/tests/routes.test.mjs
```

Live — drives the real wire protocol against a running control-plane, exactly as an agent would:

```sh
cd Operator
node control-plane/mcp/smoke.mjs --tenant <slug> --key mmsmcp_…
node control-plane/mcp/smoke.mjs --tenant <slug> --key mmsmcp_… --write --cleanup
```

It checks `initialize`, `tools/list`, a real read through each backend, that an ungranted tool is
refused when called directly by name, that a bad key gets 401, and that a key cannot address
another tenant. `--write` additionally creates a draft (never publishes); `--cleanup` removes it.

The gateway suite covers protocol framing, `tools/list` filtering, the second-pass refusal on
`tools/call`, table narrowing, profile normalisation, and that a tool failure surfaces as
`isError` rather than tearing down the session. The plugin suite drives `activate` with a fake
`api` to check capability wiring, input validation and error envelopes.
