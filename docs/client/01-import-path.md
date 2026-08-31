# SiteBundle import

The headless import path is available, including the clean-site strategy. This is the contract to build against.

## Schema

Pinned to `src/core/data/bundleSchema.ts`, package `0.0.16`, commit `693139e`.

```
SiteBundle = {
  schemaVersion: 1
  exportedAt:    string          // ISO 8601
  sourceSiteName?: string
  site?:         SiteShell       // breakpoints, settings, classes, files, runtime
  tables:        DataTable[]
  rows:          DataRow[]
  media?:        MediaAsset[]    // metadata + bytesBase64
  mediaFolders?: MediaFolder[]
  redirects?:    Redirect[]
}
```

**There are no top-level `pages`, `posts`, `components` or `layouts` arrays.** All four are rows in `rows[]`, discriminated by `tableId`. That is the single most common wrong assumption about this format, and it fails at schema validation rather than at runtime.

```
rows[] where tableId = 'posts'      → collection entries
                       'pages'      → pages and templates
                       'components' → shared chrome
                       'layouts'    → saved layouts
```

`DataTable` and `DataRow` need considerably more than an id and a cell bag — labels, kind, route base, field definitions, system flag, actor fields, timestamps, publish fields, delete fields. Rather than build those by hand from the schema, **export a bundle from the target and fill its shape**. `connector_export_manifest` returns exactly that JSON.

## Endpoints

| Purpose | Route | Body |
|---|---|---|
| Dry run | `POST {prefix}/import/preview` | JSON bundle |
| Import JSON | `POST {prefix}/import?strategy=…` | JSON bundle |
| Import ZIP | `POST {prefix}/import/archive?strategy=…` | `application/zip` |
| Export | `GET {prefix}/export?includeMedia=1` | — |

A ZIP posted to the JSON endpoint is rejected with a message naming the right one — but only after the whole upload. Check the endpoint before sending 30 MB.

**Preview is a separate endpoint, not a flag.** Adding `?dryRun=1` to `/import` does not preview; the parameter is ignored and the import proceeds.

## Strategies

| Strategy | Rows | Redirects | Media folders |
|---|---|---|---|
| `merge-add` | Insert missing only | **No** | **No** |
| `merge-overwrite` | Insert + update | **No** | **No** |
| `replace` | Delete all, then insert | **Yes** | **Yes** |

**Redirects and media folders travel only with `replace`.** The merge strategies skip both silently — no error, no warning, they simply do not arrive. A redirect map cannot ride along with a merge import.

`replace` deletes every row, every non-system table, all media folders and all redirects before inserting. It is the correct strategy for a clean-site load and the wrong one for updating a site with content worth keeping.

## Authentication

Session cookie, plus capabilities:

- all strategies: `data.import`
- `replace`: additionally `content.manage` **and a step-up challenge**
- bundles carrying `site`: additionally `site.structure.edit`
- preview: `data.export`

Two details that cost time if missed:

**Send no `Origin` header.** State-changing calls run through a CSRF origin gate. A request with no Origin is treated as server-to-server and allowed; a request with the *wrong* Origin is a flat 403.

**Step-up rotates the session cookie.** Keep using the pre-step-up cookie and every following call fails in a way that reads like the challenge did not work.

## Route prefix

This deployment serves the CMS API at `/cms/api/cms` with a session cookie scoped `Path=/cms`. Public upstream uses `/admin/api/cms` and `Path=/admin`.

**Pin the prefix and the cookie path together — they are one unit.** Getting the prefix right and the cookie path wrong produces a login that appears to succeed and then behaves as unauthenticated.

Do not hardcode either. Read the prefix constant at build time, or probe it at startup and fail loudly on mismatch.

## Schema stability

The package is pre-1.0 and the schema can shift. Validate every emitted bundle against the in-repo TypeBox schemas at build time, so a drift fails in CI rather than silently on a live site.

## Through the connector

- `connector_preview_import` — dry run, writes nothing
- `connector_import_draft` — merge strategies
- `connector_import_archive` — ZIP, merge strategies
- `connector_import_replace` — clean-site load; requires `confirm: "REPLACE <target>"` naming the target, and runs a preview first
- `connector_export_bundle` — writes a ZIP to disk, media included
- `connector_export_manifest` — returns the manifest JSON directly
