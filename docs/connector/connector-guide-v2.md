# MMS Connector — reference

**Endpoint** `POST <gateway-origin>/connector-mcp` · **Auth** one bearer token · **Tools** 34, all prefixed `connector_`

Supersedes `connector-guide.html`, `connector-handover.html`, `connector-mcp.html` and `connector-plan.html`.

> **This is one of two MCP surfaces in this platform.** The Connector is a standalone service for
> migrating, importing, exporting and publishing whole sites. If you want a per-site key with
> granular permissions for day-to-day content work, you want **MMS MCP** instead — see
> `mms-mcp-v2.md`. The two have different endpoints, different token formats and different
> permission models.

---

## 1. What it is

The MMS Connector is a Model Context Protocol server. It exposes the CMS as a set of tools any
MCP-capable AI client or CLI can call. You describe what you want in plain language; the client
picks the tool and fills in the arguments.

It is built for the whole-site jobs: load a site bundle, replace a site's contents, export a
snapshot, provision a new site, publish everything. It can also do ordinary row-level CRUD, but
that is not the reason it exists.

The service runs separately from the CMS and connects outward to one or more CMS instances using
credentials held on the server. **A caller never sees or supplies CMS credentials** — only the
connector's own bearer token.

---

## 2. Connecting

You need two values: the **endpoint URL** and the **token**.

### Claude Code

```
claude mcp add --transport http mms-connector \
  <gateway-origin>/connector-mcp \
  --header "Authorization: Bearer <token>"
```

Then `claude mcp list` to confirm, `claude mcp remove mms-connector` to undo.

### Any client that takes JSON config

Cursor, Windsurf, Cline, VS Code Copilot and most others:

```json
{
  "mcpServers": {
    "mms-connector": {
      "type": "http",
      "url": "<gateway-origin>/connector-mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Client-specific notes:

| Client | Where the config goes | Note |
|---|---|---|
| Cursor | Settings → MCP → Add new MCP server | — |
| VS Code Copilot | `.vscode/mcp.json`, or `MCP: Add Server` | Switch Copilot Chat to **Agent** mode — MCP tools are not available in Ask mode |
| Windsurf | Settings → Cascade → MCP Servers | Uses the key `serverUrl`, not `url` |
| Cline | MCP Servers → Configure → Edit Configuration | Set `"type": "streamableHttp"` |
| n8n | **MCP Client** node | Server Transport `HTTP Streamable`, Authentication `Header Auth` |

### Clients that only speak stdio

Claude Desktop and Codex CLI cannot call an HTTP MCP server directly. Bridge with `mcp-remote`
(from npm, so Node must be installed):

```json
{
  "mcpServers": {
    "mms-connector": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<gateway-origin>/connector-mcp",
               "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer <token>" }
    }
  }
}
```

The `${AUTH}` indirection is deliberate: the header value contains a space, which breaks argument
parsing when written inline. Putting it in `env` is the standard workaround.

Codex CLI uses the same idea in `~/.codex/config.toml` under `[mcp_servers.mms-connector]`.

### Checking the connection without an AI

```
curl -X POST <gateway-origin>/connector-mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A healthy response lists 34 tools. `401` means the token is wrong, missing, or the service was
restarted with a different one.

There is also an unauthenticated liveness probe: `GET <connector-host>/health` returns
`{"ok":true,"service":"mms-connector-mcp"}`.

---

## 3. Naming a target

The connector can be configured with several CMS instances. Each has a short name — its **target**.

- Every tool takes an optional `target` argument.
- With exactly one configured, you can omit it.
- With more than one, a call that does not name a target **refuses rather than guessing**.
- A default can be set server-side, so `target` is only needed to override it.

In practice you say *"connect to `<target-name>`"* once at the start of a session, and the client
carries it through the rest of the conversation.

`connector_target` lists what is configured and which targets currently have an open session. Run
it first when you do not know the names.

A site created through `connector_create_site` enrols itself and becomes addressable without a
restart. Any other site has to be added to the server's allow-list, which fails closed on purpose.

---

## 4. Permissions — read this before handing the token out

**The Connector has no permission model.** There are no scopes, no roles, no per-token capability
lists. Anyone holding the token gets all 34 tools against every configured target — read, create,
edit, delete, publish, and clean-site replace.

That is a deliberate design, not an oversight, but it has consequences worth stating plainly:

- The token also authenticates the connector's own call to the control plane for target
  enrolment, which returns **live CMS credentials**. Treat it as an infrastructure secret, not a
  content credential.
- **There is no revocation list.** Rotating means restarting the service with a new token. The old
  one stops working at that moment, and every client using it breaks until re-issued.
- **If you need a scoped, revocable, per-site credential, use MMS MCP instead** (`mms-mcp-v2.md`).
  That surface has ten granular permissions, four presets, table narrowing, expiry and one-click
  revoke.

### The four guards that do exist

1. **The bearer token.** Minimum 32 characters, enforced at startup — the service refuses to open
   the port without one. Compared in constant time. Callers appear in the activity log as a
   non-reversible fingerprint, never as the token itself.

2. **An Origin allow-list**, configured server-side. This is anti-DNS-rebinding, not authorization:
   requests with no Origin header at all are allowed, because that is what a server-to-server
   caller looks like. It is checked *before* the token, so the token is never compared on a
   rebinding attempt.

3. **Typed confirmation phrases** on the two bulk-destructive tools. These are the real brake:

   | Tool | Required `confirm` value |
   |---|---|
   | `connector_import_replace` | `REPLACE <target>` |
   | `connector_delete_rows` | `DELETE <count> FROM <target>` |

   The count is embedded in the delete phrase specifically so a confirmation cannot be reused for a
   larger batch than the one it was written for.

   Note what is *not* covered: `connector_delete_row` (singular), `connector_publish_row` and
   `connector_publish_site` carry warnings but require no confirmation phrase.

4. **CMS-side step-up.** The CMS — not the connector — demands a recent re-authentication before a
   full-site publish, a clean-site import, or any schema change. `connector_step_up` performs it.
   The connector does not pre-check this; the CMS refuses and the tool surfaces the error.

---

## 5. The 34 tools

Marked **R** read-only · **W** writes · **D** destructive and not reversible.

Every tool takes an optional `target`. Required arguments are marked `*`.

### Environment and verification — 4, all read-only

| | Tool | Arguments | What it does |
|---|---|---|---|
| R | `connector_doctor` | `fixtureDir` | Verifies the conversion environment end to end: DOM globals, the base module registry, and a fixture conversion through the CMS's own `importHtml`/`cssToStyleRules`. Run first — a silent conversion failure looks like a content problem. |
| R | `connector_environment` | — | Runtime report: engine version, registered module ids, DOM-global state, `ready`, and `toolSurface.revision`. |
| R | `connector_hash_rows` | `rows*` | Canonical per-row hashes plus an aggregate digest. Order-independent. The digest is what an approval binds; each row hash is what a release sends as `If-Match`. |
| R | `connector_verify_approval` | `approval*`, `observed*`, `releaseManifest*` | Checks an approval against observed state and a release manifest, returning **every** failing binding at once rather than the first. |

### Sessions and targets — 3

| | Tool | Arguments | What it does |
|---|---|---|---|
| R | `connector_target` | — | Lists configured targets and which have open sessions. |
| W | `connector_connect` | `mfaCode` | Opens a session using server-held credentials. Required before any import tool. |
| W | `connector_disconnect` | — | Drops one session, or all of them if no target is named. |

### Reading content — 5, all read-only

| | Tool | Arguments | What it does |
|---|---|---|---|
| R | `connector_list_tables` | — | All content tables with ids, kinds and field definitions. Start here when you do not know a table id. |
| R | `connector_get_table` | `tableId*` | One table with complete field definitions. Use before changing fields, so the change is made against what is actually there. |
| R | `connector_list_rows` | `tableId*`, `limit`, `offset`, `fields` | Paginated rows. Returns **summaries by default** — id, slug, status, title, timestamps — because a full page row carries its entire body. `fields: "full"` for everything. Default 25, cap 200. |
| R | `connector_get_row` | `rowId*` | One row in full. |
| R | `connector_publish_status` | — | Whether the draft differs from what is live, and how many pages are published. Worth checking before *and* after any publish. |

### Writing content — 5

| | Tool | Arguments | What it does |
|---|---|---|---|
| W | `connector_create_row` | `tableId*`, `slug`, `cells` | Creates a row as **draft** — not publicly visible until published. `cells` holds field values keyed by field id. |
| W | `connector_update_row` | `rowId*`, `slug`, `cells` | Changes field values or the slug. If the row is already published, **the live version does not change** until it is published again — the edit lands on the draft. |
| W | `connector_set_row_status` | `rowId*`, `status*` (`draft`\|`unpublished`) | The reversible way to take something off the site: unpublishing retracts the public route but keeps the content. |
| **D** | `connector_delete_row` | `rowId*` | Deletes a row. **No undo, no trash.** If the goal is to take a page off the site, use `connector_set_row_status` instead. |
| **D** | `connector_delete_rows` | `rowIds*`, `confirm*` | Bulk delete. `confirm` must be exactly `DELETE <count> FROM <target>`. Reports each row individually so a partial failure is visible. |

### Publishing — 2

| | Tool | Arguments | What it does |
|---|---|---|---|
| W | `connector_publish_row` | `rowId*` | Publishes one row — **live immediately**. There is no previous-version rollback; unpublishing later retracts the route but does not restore earlier content. |
| W | `connector_publish_site` | — | Builds the site snapshot and every page version and takes the result live. The largest single action available here. Requires a recent step-up. |

### Import and export — 6

| | Tool | Arguments | What it does |
|---|---|---|---|
| R | `connector_preview_import` | `bundle` \| `uploadId` \| `path`, `strategy` | **Dry run — writes nothing.** Per-table counts of rows added and replaced, plus media and redirect totals. Always run this before importing. Pass exactly one source. |
| W | `connector_import_draft` | `bundle*`, `strategy` | Imports a bundle as **draft**. Imported rows have no active version, so nothing becomes publicly visible until a separate publish. |
| W | `connector_import_archive` | `uploadId` \| `path`, `strategy` | Imports a bundle **ZIP**. A ZIP carries media files as well as content, which the JSON path does not. |
| **D** | `connector_import_replace` | `bundle` \| `uploadId` \| `path`, `confirm*`, `previewOnly` | **Clean-site import.** Deletes every row, every non-system table, all media folders and all redirects, then inserts. Not reversible. **It also clears the published version** — public URLs keep serving the last deployment, with nothing in the admin saying so, until a new publish runs. `confirm` must be exactly `REPLACE <target>`. |
| R | `connector_export_bundle` | `includeMedia`, `deliver`, `part`, `exportId` | Downloads the site as a bundle archive. **A bundle export is not a rollback artefact** — it captures content, not the published state. |
| R | `connector_export_manifest` | `rows`, `tableId`, `limit`, `offset` | The manifest itself as JSON — tables, rows, redirects. This is the part worth diffing. Media bytes omitted. |

Two supporting HTTP routes exist on the same host and the same token:

- `GET /exports/<exportId>` — download a whole archive in one request. Gzipped when accepted;
  `HEAD` supported for size checks.
- `POST /imports` — upload a bundle and get back an `uploadId` to pass to the import tools. Accepts
  gzip/deflate, and will verify a `sha256` if you supply one.

### Structure and SEO — 5

| | Tool | Arguments | What it does |
|---|---|---|---|
| W | `connector_create_table` | `name*`, `slug*`, `kind*` (`data`\|`postType`), `routeBase`, `singularLabel`, `pluralLabel` | Creates a content table. Changes the public URL surface, so it needs a recent step-up. `postType` gives a routed collection whose entries get their own URLs. |
| W | `connector_add_table_fields` | `tableId*`, `fields*` | Adds or updates custom fields. Existing fields are preserved — the current list is read and merged. Needs step-up. |
| W | `connector_add_seo_fields` | `tableId*` | Adds the standard SEO set in one call: `canonicalUrl`, `ogTitle`, `ogDescription`, `ogImage`, `jsonLd`. Needs step-up. |
| R | `connector_list_templates` | — | Template pages and what each targets. |
| W | `connector_create_entry_template` | `tableSlugs*`, `title`, `slug`, `priority` | Creates the entry template a routed collection needs. **Without one, every entry returns 404** regardless of how the rows are published. Refuses a duplicate target+priority. |

### Media — 2

| | Tool | Arguments | What it does |
|---|---|---|---|
| R | `connector_list_media` | — | Lists media assets. |
| W | `connector_upload_media` | `path*`, `fileName` | Uploads a file from a server-local path. Returns the media id, which is what image and featured-image fields store. |

### Provisioning — 1

| | Tool | Arguments | What it does |
|---|---|---|---|
| W | `connector_create_site` | `name*`, `ownerEmail`, `customDomain` | Provisions a **new, empty CMS site** and returns its details. Each site is an isolated instance with its own database schema and login. The only tool that talks to the control plane rather than a CMS. The new site enrols itself as a target automatically. |

---

## 6. Setting up a routed collection

The order matters. Doing it out of order produces a collection whose entries all 404.

1. `connector_connect`, then `connector_step_up` — schema changes need both.
2. `connector_create_table` with `kind: "postType"` and a `routeBase`.
3. `connector_add_seo_fields` — the SEO fields are not in the stock schema.
4. `connector_add_table_fields` for anything else the collection needs.
5. **`connector_create_entry_template`** targeting the new table. Skipping this is the single most
   common mistake: rows publish successfully and every entry URL still returns 404.
6. `connector_create_row` per entry, then `connector_publish_row`.

---

## 7. What publishing actually does

- **Publishing is immediate and public.** There is no staging step between the tool call and the
  live site.
- **There is no version rollback.** Unpublishing retracts a route; it does not restore earlier
  content.
- **Publishing triggers a deployment to public hosting.** A clean publish response confirms the CMS
  side succeeded — it does not confirm the deployment reached the host. Check the live URL.
- **A clean-site replace clears the published version silently.** Public URLs continue serving the
  last deployment, and nothing in the admin indicates the mismatch, until a new publish runs.

---

## 8. Reading large sites without blowing up the context

- `connector_list_rows` returns summaries by default. Ask for `fields: "full"` only when you need
  bodies.
- Page with `limit` and `offset` — *"show me the next 25"*.
- `connector_export_manifest` accepts `rows: "none" | "summary" | "full"`, a `tableId` filter, and
  its own `limit`/`offset`. It also enforces a serialised-size budget and returns a `nextOffset`,
  so a very wide table pages automatically rather than truncating silently.
- `connector_export_bundle` splits large archives into parts. Take `exportId` from the first
  response and request `part: 2`, `part: 3` and so on — a part request without an `exportId` is
  refused rather than silently minting a fresh, unreassemblable archive.

---

## 9. Limits worth knowing

- **Deletion has no trash.** No undo on any delete tool.
- **Redirects cannot be managed individually.** They arrive and leave with a bundle.
- **A bundle export is not a backup.** A real backup is the database plus the uploads directory.
- **`connector_upload_media` reads from a server-local path**, not from your machine.
- **`connector_preview_import` reports `unknownFields` only if the CMS emits it** — the response is
  passed through verbatim rather than synthesised, so treat its absence as "not reported", not as
  "none found".
- **Tool-surface drift.** If a client caches `tools/list`, compare `toolSurface.revision` from
  `connector_environment` against what it cached. A changed revision means the cache is stale.

---

## 10. When something does not work

| Symptom | Cause |
|---|---|
| `401 Unauthorized` | Token missing, wrong, or the service restarted with a new one. Request a current one. |
| `403 Forbidden` | The Origin header was rejected by the allow-list. |
| `502` | The connector is not reachable behind the gateway — usually not running. |
| *"no target was named"* | More than one target is configured and the request did not say which. Name one. |
| *"Not connected to …"* | Call `connector_connect` first. |
| *"needs a recent step up"* | Call `connector_step_up`, then retry. |
| Entry URLs 404 after publishing | The routed collection has no entry template. `connector_list_templates`, then `connector_create_entry_template`. |
| Conversion output looks wrong | Run `connector_doctor` — a broken conversion environment presents as a content problem. |

---

## 11. Handling the token

- Anyone holding it has full read, write, publish and delete on **every** configured target, plus
  the ability to provision new sites.
- It is an infrastructure secret. Do not paste it into shared documents, tickets or chat logs.
- It grants no access to anything outside the configured targets, and it is never exchanged for
  CMS credentials on the client side.
- To rotate: set a new value and restart the service. There is no revocation list, so the old
  token remains valid until that restart happens.
- Every tool call is written to the activity log with a non-reversible fingerprint of the calling
  token.

---

*MMS Connector · Model Context Protocol over HTTPS · 34 tools · one bearer token, no scopes · every action logged*
