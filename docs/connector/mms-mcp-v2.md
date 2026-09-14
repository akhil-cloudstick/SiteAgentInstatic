# MMS MCP — reference

**Endpoint** `POST <gateway-origin>/mcp/<site-slug>` · **Auth** a per-site key, `mmsmcp_…` · **Tools** 29

Supersedes `connect-an-ai-agent.md` and `mms-mcp.md`.

> **This is one of two MCP surfaces in this platform.** MMS MCP issues a scoped, revocable key for
> **one site**, with ten granular permissions. It is the credential to hand to a person or an agent
> doing day-to-day content work. For whole-site migration, bundle import/export and provisioning,
> see `connector-guide-v2.md` — that surface uses a different endpoint, a different token, and has
> no permission model at all.

---

## 1. What it is

MMS MCP turns a site into a set of tools an AI agent can call over the Model Context Protocol. The
agent reads and writes real content — entries, pages, media, design settings — through the same
paths the admin UI uses.

Each key is bound to exactly one site. A key issued for one site cannot address another, and says
so with a `401` rather than an empty result.

Transport is streamable HTTP answering with `application/json` — no SSE.

---

## 2. Turning it on for a site

Two prerequisites, in order:

1. **The site must be running.** A key against a stopped site produces `site not running`.
2. **The content tools need a bridge plugin installed on that site.** Media and design tools work
   without it; everything under `cms_*` does not. Install it from the console, or
   `POST /api/mcp/tenants/<slug>/install-bridge`.

---

## 3. Creating a key

### From the console

Open `<gateway-origin>/operator/mcp`. Choose the site, give the key a label, pick a preset or
individual permissions, and optionally narrow it to specific tables and set an expiry.

The console shows the key **once**, together with a ready-made `claude mcp add` line and copy
buttons for the key, the endpoint and the command.

### Over HTTP

```
curl -X POST <control-plane>/api/mcp/agents \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"<site-slug>","label":"<label>","preset":"full"}'
```

The plaintext key is returned once, in `agent.token`. An empty permission set is rejected — you
must pass either a `preset` or an explicit `permissions` array.

Related endpoints: `GET /api/mcp/presets`, `GET /api/mcp/agents?tenant=<slug>`,
`GET /api/mcp/agents/<keyId>/reveal`, `POST /api/mcp/agents/<keyId>/revoke`,
`GET /api/mcp/directory`, `GET /api/mcp/audit?tenant=<slug>`.

Unlike most secrets, a key here **can be re-revealed** from the console after issue. Revoking it
destroys that ability along with the key.

---

## 4. Permissions

Ten permissions, checked twice — once to filter what the agent can see in `tools/list`, and again
inside every `tools/call`, so a client that hard-codes a tool name it never saw listed is still
refused.

| Permission | Grants |
|---|---|
| `read` | List and read entries, tables, published snapshots, search |
| `create` | Create entries |
| `edit` | Update, move and mutate entries and their page trees |
| `delete` | Delete entries |
| `publish` | Publish an entry, republish the whole site |
| `tables.manage` | Create and change content tables |
| `media.read` | List media |
| `media.write` | Upload, replace, restore, re-folder, edit metadata |
| `media.delete` | Delete media |
| `design.edit` | Read and change site design settings |

### Presets

| Preset | Permissions |
|---|---|
| `read-only` | `read`, `media.read` |
| `author` | `read`, `create`, `edit`, `media.read`, `media.write` |
| `publisher` | `read`, `create`, `edit`, `publish`, `media.read`, `media.write` |
| `full` | all ten |

**There is no implicit default** — a key must be created with a preset or an explicit list.

### Narrowing to tables

A second axis. `tables` defaults to `["*"]`; give it a list of table slugs and the key can only
touch those. Useful for an agent that should write blog posts and never touch pages.

### Expiry and revocation

Set `expiresInDays` at creation. Revoke at any time from the console or over HTTP. An unknown,
revoked and expired key are all rejected identically and deliberately — the error does not reveal
which.

### The ceiling, stated plainly

The gateway signs into the site as its **owner, with step-up pre-granted**. The CMS therefore
imposes no ceiling of its own. **The key's permission set is the only limit that exists.** Choose
it accordingly — `full` really does mean everything, including delete and republish.

Every call is written to an audit table, queryable per site.

---

## 5. The 29 tools

### Content — `cms_*` (20)

**Read** — `cms_list_tables` · `cms_get_table` · `cms_list_entries` · `cms_get_entry` ·
`cms_get_entry_by_slug` · `cms_search` · `cms_read_tree` · `cms_get_published_snapshot`

**Create** — `cms_create_entry` · `cms_create_entries` · `cms_create_table`

**Edit** — `cms_update_entry` · `cms_update_entries` · `cms_move_entry` · `cms_mutate_tree` ·
`cms_replace_tree`

**Delete** — `cms_delete_entry` · `cms_delete_entries`

**Publish** — `cms_publish_entry` · `cms_republish_all`

Pages live in the `pages` table and posts in `posts`. Page-tree edits go through `cms_mutate_tree`,
which applies a set of canonical operations — `insertNode`, `moveNode`, `updateNodeProps`,
`setBreakpointOverride`, `wrapNode` and others — rather than accepting an arbitrary tree.
`cms_replace_tree` swaps a whole tree at once.

### Media — `media_*` (7)

`media_list` · `media_upload` · `media_replace` · `media_update_metadata` · `media_set_folders` ·
`media_restore` · `media_delete`

`media_upload` takes either `base64` content or a `sourceUrl`, which must be `https`. Loopback and
private addresses are blocked at the network layer.

### Design — `design_*` (2)

`design_read_site` · `design_update_site`

---

## 6. Connecting a client

### Claude Code

```
claude mcp add mms-cms --transport http \
  <gateway-origin>/mcp/<site-slug> \
  --header "Authorization: Bearer mmsmcp_…"
```

`claude mcp list` to confirm · `claude mcp remove mms-cms` to undo.

### JSON config — Cursor, VS Code Copilot, Windsurf, Cline, n8n

```json
{
  "mcpServers": {
    "mms-cms": {
      "type": "http",
      "url": "<gateway-origin>/mcp/<site-slug>",
      "headers": { "Authorization": "Bearer mmsmcp_…" }
    }
  }
}
```

| Client | Where | Note |
|---|---|---|
| Cursor | Settings → MCP → Add new MCP server | — |
| VS Code Copilot | `.vscode/mcp.json` or `MCP: Add Server` | Agent mode only — MCP tools are unavailable in Ask mode |
| Windsurf | Settings → Cascade → MCP Servers | Key is `serverUrl` |
| Cline | MCP Servers → Configure → Edit Configuration | `"type": "streamableHttp"` |
| n8n | **MCP Client** node | Transport `HTTP Streamable`, Authentication `Header Auth` |

### Claude Desktop and Codex CLI — stdio bridge

Neither speaks HTTP MCP directly. Bridge with `mcp-remote` (npm, needs Node):

```json
{
  "mcpServers": {
    "mms-cms": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<gateway-origin>/mcp/<site-slug>",
               "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer mmsmcp_…" }
    }
  }
}
```

`${AUTH}` is not optional styling — the header value contains a space, which breaks inline
argument parsing.

Codex CLI: the same, in `~/.codex/config.toml` under `[mcp_servers.mms-cms]`.

### Browser assistants

Web assistants that accept a remote MCP connector but provide no field for a custom header cannot
authenticate to this endpoint. Use a desktop client or the stdio bridge.

### Checking without an AI

```
curl -X POST <gateway-origin>/mcp/<site-slug> \
  -H "Authorization: Bearer mmsmcp_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The number of tools returned **is** the permission readout — a narrow key sees a short list.

---

## 7. What an agent can and cannot do

**Can** — read any content it has `read` for · create and edit entries · restructure pages through
the canonical tree operations · manage media · change design settings · publish · create tables.

**Cannot** — see or change the key's own permissions · address a different site · reach a table
outside its `tables` list · retrieve credentials · act after the key expires or is revoked.

---

## 8. When something does not work

| Message | Cause |
|---|---|
| `Invalid, revoked, or expired agent key` | Exactly what it says — the three are deliberately indistinguishable. |
| `This agent key is not valid for that site` | The key belongs to another site. |
| `site not running` | Start the site first. |
| `Table not found` | Wrong slug, or the key's `tables` list excludes it. |
| Tool missing from `tools/list` | The key lacks the permission. Check the grant, not the client. |
| `cms_*` tools all missing | The bridge plugin is not installed on that site. Media and design tools working while content tools do not is the signature of this. |

---

## 9. Verifying a key end to end

A smoke script exercises everything without an AI client. Run with **node**, from the `Operator`
directory:

```
cd s:\SiteAgentHub\Operator
node control-plane/mcp/smoke.mjs --tenant <site-slug> --key mmsmcp_… --url http://127.0.0.1:4400
```

It asserts `initialize`, prints *"N tools visible to this key"* with the full list, performs a real
read through each backend, and checks the negative cases: an ungranted tool is refused by name, a
bad key gets `401`, and the key cannot address a different site.

Add `--write --cleanup` to exercise the write path and clean up after itself.

Offline unit gate: `node --test Operator/control-plane/mcp/gateway.test.mjs`

---

## 10. Good habits

- **Start read-only.** Issue `read-only` first, confirm the agent does what you expect, then widen.
- **One key per agent**, not one shared key — revoking then affects only that agent, and the audit
  trail stays meaningful.
- **Set an expiry** on anything issued for a fixed piece of work.
- **`full` includes delete and republish.** If the agent only writes drafts, `author` is the honest
  grant.
- **Narrow `tables`** when the job is confined to one collection.
- **Revoke on completion** rather than leaving keys live indefinitely.

---

*MMS MCP · Model Context Protocol over HTTPS · one key per site · ten permissions, four presets · every call audited*
