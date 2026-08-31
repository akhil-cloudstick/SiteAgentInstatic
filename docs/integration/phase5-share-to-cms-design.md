# Phase 5 — "Share to CMS" (OpenDesign → Instatic), no-duplicate push

_Design locked after reading Instatic's import internals. This is the turnkey build spec for the
full no-duplicate version the client chose. Phases 0–4 (+ Phase 5 plumbing) are already done and committed._

## The key finding (why no-duplicate is achievable)

Instatic's `merge-overwrite` import **upserts data rows by `id`** (`bundleSchema.ts`: `willReplace` =
"row id already exists locally"). And its Super Import already resolves conflicts: `buildImportPlan`
matches an imported page to an **existing page by slug**, and `commitImportPlan` then calls
`tx.overwritePage(existingId, …)` (reusing the id) instead of `tx.addPage(…)`. So **no-duplicate
re-push comes for free** as long as `currentSite` passed to `buildImportPlan` carries the existing
pages. First push → `addPage` (fresh id); re-push of the same slug → `overwritePage` (same id) → upsert.

## Architecture (reuse Instatic's real conversion; add a server-side adapter)

```
OpenDesign "Share to CMS"
  → OD daemon POST /api/projects/:id/push/instatic
      1. build the project's static files (templateRule-compliant HTML/CSS/images) into a FileMap
      2. mint an SSO session on the tenant's Instatic (OD already has OD_SSO_SECRET + OD_INSTATIC_URL):
           GET  {OD_INSTATIC_URL}/admin/api/cms/sso?token=<signed target:'instatic'>  (redirect:manual)
           → capture the `instatic_session` cookie
      3. POST the FileMap to the new Instatic ingest endpoint with that cookie
      4. redirect the tenant into {OD_INSTATIC_URL}/admin
  → Instatic  POST /admin/api/cms/import/site-html?strategy=merge-overwrite   (NEW)
      requireCapability('data.import')  (the SSO'd Owner session satisfies it)
      1. parse body → FileMap { path: { text | bytesBase64, mimeType } }
      2. currentSite: SiteDocument = { ...getDraftSite(db), pages, visualComponents, layouts }
           pages           = listDataRows(db,'pages')     .map(pageFromRow)
           visualComponents= listDataRows(db,'components') .map(componentFromRow)
           layouts         = listDataRows(db,'layouts')    .map(layoutFromRow)
      3. plan = buildImportPlan({ fileMap, currentSite })          // headless, pure — verified pure by design
      4. commitImportPlan(plan, serverAdapter)                     // serverAdapter is the new piece
      5. serverAdapter accumulates the mutations into an in-memory SiteDocument, then persists via the
         EXISTING bundle path: serialize → SiteBundle → handleImportRoute(bundle, strategy:'merge-overwrite')
         (that path already does the atomic DB upsert-by-id — do NOT hand-write row SQL)
```

## The one substantial new module: a server-side `SiteImportAdapter`

Interface in `src/core/siteImport/adapter.ts` (~14 methods). Server implementation should live at
`server/handlers/cms/siteImport/serverAdapter.ts` and:

- `uploadAsset(file)` → write bytes via `importMediaAsset` (repositories/media), return `/uploads/<storagePath>`.
- `installGoogleFont(font)` → reuse the CMS Google-font install path (fonts repo) → `FontEntry`.
- `commit(recipe)` → run `recipe(tx)` where `tx` mutates an in-memory working `SiteDocument`
  (start = `structuredClone(currentSite)`), then persist that document as a `SiteBundle` through
  `handleImportRoute(…, 'merge-overwrite')`.
- `tx.addPage` / `tx.overwritePage` — convert the `ImportFragment` (class **names** on `node.classIds`)
  into a `Page` (`{ nodes, rootNodeId }`), reconciling class names→ids (create bare classes for unknown
  names — port the logic referenced by `src/admin/pages/site/store/slices/site/nodeActions.ts:insertImportedNodes`).
  `addPage` uses the provided pre-minted id; `overwritePage` reuses the existing page id → the `pages`
  rows carry ids that upsert.
- `tx.addStyleRule` / `overwriteStyleRule` → into `site.settings.…` class/style registry.
- `tx.addColorTokens` / `overwriteColorTokens` → `site.settings.framework.colors`.
- `tx.addFonts` / `addInstalledFonts` / `addFontTokens` / `overwriteFontTokens` → `site.settings.fonts` + font tokens.
- `tx.addScripts` / `addStylesheets` → `site.files` + `site.runtime.{scripts,styles}` (page-scoped).
- `tx.addConditions` → `site.conditions`.
- `tx.createVisualComponent` → a `components` row (nav/footer become shared Visual Components).

Then build the `SiteBundle`: `{ schemaVersion:1, exportedAt, site: mutatedShell, tables:[pages/components
system-table defs from listDataTables], rows:[changed page/component rows] }` and call the existing
`handleImportRoute` with `merge-overwrite`.

## OpenDesign side

- `apps/daemon/src/routes/` — new `POST /api/projects/:id/push/instatic` (model on `import-export-routes.ts`
  `/finalize/:provider` + `deploy.ts`). Reads the project's on-disk files (reuse the helpers behind
  `/api/projects/:id/archive`). Requires `OD_INSTATIC_URL` (advanced tenants only — see odRuntime).
  Rebuild the daemon after editing (`tsc -p apps/daemon/tsconfig.json --noCheck`).
- `apps/web/src/components/ProjectActionsToolbar.tsx` — add "Share to CMS" to the share dropdown →
  confirm modal → call the push route → on success redirect to `{instatic}/admin`. Rebuild the web
  (`--serve-web`) to serve it.

## Prerequisite already shipped
- OD receives `OD_SSO_SECRET`, `OD_TENANT_SLUG`, `OD_INSTATIC_URL` (advanced tenants) — committed.
- Instatic `/admin/api/cms/sso` mints an Owner session — committed + verified (Phase 4).
- Instatic `merge-overwrite` import exists — verified by reading `import.ts`.

## Verification plan
1. Instatic on SQLite: POST a 2-page FileMap to `/import/site-html` → 2 `pages` rows, styles/tokens in the shell.
2. Re-POST the same FileMap → **same row ids, zero new rows** (no duplicates).
3. Change one page + add one → the changed page's row updates in place; one new row; others untouched.
4. Full path: OD `Share to CMS` → lands in Instatic showing both pages editable.
