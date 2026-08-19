# MMS MCP Bridge (plugin)

The headless content backend for the MMS MCP gateway. **This is not an MCP server** — agents
never connect to it. The Operator control-plane calls it over capability-gated internal routes.

Full design and setup: [`docs/mms-mcp.md`](../../docs/mms-mcp.md).

## Why it exists

The CMS admin HTTP API has no op-based page-tree endpoint — only `PATCH /data/rows/:id`, a
whole-cell patch. Editing a page through that means read-whole-tree → mutate in JS →
write-whole-tree back, which loses server-side operation validation and silently overwrites a
concurrent human edit.

`api.cms.content.tree(entryId, fieldId).mutate(ops)` instead runs each operation through
`applyTreeOperation`, the same engine the visual editor drives. That is the whole reason this
plugin exists. Entry CRUD lives here too so one backend owns every content write.

## What it exposes

All routes are `POST` under `/cms/api/cms/plugins/mms.mcp-bridge/runtime` unless noted.

| Route | Capability | Host API |
|---|---|---|
| `GET /health` | `content.manage` | — |
| `/tables/list`, `/tables/get` | `content.manage` | `cms.content.tables.*` |
| `/tables/create` | `data.custom.tables.manage` | `cms.content.tables.create` |
| `/entries/list`, `/get`, `/get-by-slug` | `content.manage` | `cms.content.entries.*` |
| `/entries/create`, `/update`, `/move`, `/create-many`, `/update-many` | `content.manage` | `cms.content.entries.*` |
| `/entries/delete`, `/delete-many` | `content.manage` | `cms.content.entries.delete*` |
| `/tree/read`, `/tree/mutate`, `/tree/replace` | `content.manage` | `cms.content.tree.*` |
| `/search`, `/snapshot` | `content.manage` | `cms.content.search`, `.getPublishedSnapshot` |
| `/entries/publish`, `/republish-all` | `pages.publish` | `cms.content.entries.publish`, `.republishAll` |

## Security

- **No public routes.** Every route is registered with a core capability, so the host requires a
  real admin session before a handler runs. `cms.routes.public` is deliberately not requested.
- **No credentials.** The plugin stores no keys and no tokens. Agent keys live in the Operator
  registry and never reach a tenant.
- **Two independent table gates.** The manifest's `contentAccess[]` allowlist (enforced host-side
  by `assertContentTableAccess`) and the per-key `tables` narrowing the gateway applies first.

## Installing

**Normal path — the Operator console.** Open **MCP Agents**, find the site in the endpoint
directory, press **Install bridge**. The control-plane zips `plugin.json` + `server/index.js`
from this folder in memory and posts it to that tenant's install endpoint over the SSO session.
Nothing to build, nothing to upload, and the installed bytes can never drift from this source.
Press it again after changing the plugin to upgrade in place (bump `version` first — the CMS
refuses downgrades).

The entrypoint is a single hand-authored ESM file; the host flattens it for QuickJS via
`wrapEsmAsGlobal`, so there is no bundler and no build step.

**Manual fallback**, if you ever need to install through the CMS admin UI instead:

```powershell
Compress-Archive -Path plugin.json,server -DestinationPath mms-mcp-bridge.plugin.zip -Force
```

Then **Admin → Plugins → upload** and approve. The consent screen lists the exact tables from
`contentAccess[]`.

## Adding a client's custom collection

`contentAccess[]` must name every table, capped at 50 by the host. The shipped manifest covers
the four system tables plus common client collections. When a client creates one outside that
list:

```sh
cd Operator
node ../plugins/mms-mcp-bridge/scripts/regen-content-access.mjs --schema tenant_<slug>
# review the diff, then:
node ../plugins/mms-mcp-bridge/scripts/regen-content-access.mjs --schema tenant_<slug> --write
```

Bump the version and reinstall so the operator re-approves the new list.

## Tests

```sh
node --test tests/routes.test.mjs
```

The tests drive `activate` with a fake `api`, so they exercise the real capability wiring, input
validation and error envelopes without a running CMS.
