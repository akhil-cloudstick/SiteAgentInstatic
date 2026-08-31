# Instatic (MMS-CMS) vendored upgrade — `v0.0.14` → `v0.0.16`

Executed 2026-08-20. Absorbs 0.0.15 + 0.0.16. Landed by `robocopy`, **not
committed** — the user reviews the diff.

## Headline

| | |
|---|---|
| Upstream delta | 377 files, +21,570 / −4,737 |
| Merge conflicts | **31** (1 delete-vs-modify, 2 modify-vs-delete, 28 content) |
| MMS layer | 1,102 files before → 1,162 after (grew: the `/cms` rename touched upstream files) |
| Typecheck | **9 errors vs 13 pre-merge baseline — 0 new, 4 fixed** |
| Architecture suite | **27 failures vs 56 baseline — 29 fixed, 2 new (both explained)** |
| `vite build` | **passes**, `dist/index.html` 14,373 B |

Baseline caveat: `bunx tsc -b` is incremental and **under-reports** on a warm
`.tsbuildinfo`. Always `--force` and delete `*.tsbuildinfo` first, and take the
baseline from the real pre-merge commit — not from a branch your own merge has
advanced.

## 🔴 Migrations — the rule that protects live tenant DBs

Upstream 0.0.15/0.0.16 shipped ids **022, 023, 024**, which **collide** with
MMS-owned ids already applied on tenant databases. Per runbook §4, MMS ids never
move; upstream's were renumbered, identically in both dialects:

| upstream id | renumbered to |
|---|---|
| `022_collab_documents` | **`026_collab_documents`** |
| `023_collab_document_generation` | **`027_collab_document_generation`** |
| `024_clear_email_display_names` | **`028_clear_email_display_names`** |

Final order (deliberately non-numeric — do not "tidy"): …`023_mcp_oauth`,
`019_ai_message_model_id`, `020_media_content_hash`, `024_plugin_staged_packages`,
`025_sessions_hub_context`, `026`, `027`, `028`. 28 migrations, no duplicate ids,
`migration-parity` gate green.

## 🔴 The `/admin/api` → `/cms/api` rename

Our tree had **zero** `/admin/api/` references; the merge introduced **110 files**
carrying them (upstream's new routes, clients and tests). All were rewritten to
`/cms/api/`. The `server-route-prefix` architecture gate is green. Re-run this
sweep after every upgrade.

## 🔴 The collab rewrite vs the MMS site editor (the hard part)

Upstream 0.0.15 replaced the editor's **manual save / dirty-tracking / history**
model with always-on **Yjs collab**: it deleted `dirtyTracking`, `requestEditorSave`,
`EDITOR_SAVE_REQUEST_EVENT`, dropped `PersistenceController.saveSite`, and reshaped
`PersistenceSaveStatus` to `loading|synced|connecting|offline|error`. The MMS
site-editor toolbar is built on the old model, so neither side could be taken
wholesale (upstream's files also re-import components MMS deleted —
`ModulePickerDropdown`, `CanvasModeToggle`, `UndoRedoButtons`).

Resolution — **upstream engine + MMS UI ported on top**:

1. `saveTrackingSlice.ts` (MMS-only, still present, `dirtyTracking` survived) was
   **re-composed into `store/store.ts`** — upstream rewrote the file and dropped it.
2. `usePersistence` re-gained the MMS surface, additively:
   - `saveSite()` ships the accumulated dirty marks through the adapter (which
     still exposes `saveSite`), and **restores the snapshot on failure** so the
     next save retries exactly that work;
   - `'saving' | 'unsaved'` states + `lastSavedAt` for the toolbar;
   - `markNewSiteUnsaved` option — a freshly created site starts dirty.
3. MMS Share-to-CMS transaction methods `upsertEverywhereTemplate` and
   `createVisualComponent` were **ported onto upstream's `helpers.ts`**, including
   its new 4th `linkImportedClassNames` argument (style-rule order allocator).
   Taking upstream's helpers wholesale had silently dropped both.
4. `CanvasNotch` gained `buttonRef` / `expanded` (forwarded as `ref` +
   `aria-expanded`) for the Content token-picker popover.

**Net effect:** the site editor keeps its explicit Save and MMS chrome, and gains
upstream's collab document sync underneath.

## Other decisions

| File | Decision |
|---|---|
| `toolClassification.ts` | upstream extracted `AUTO_NAVIGATE_TOOLS`; MMS's local copy was a **duplicate declaration that broke the build**. Removed the local const and added the MMS tool `site_insert_component_ref` to **both** upstream sets — including `SITE_MUTATION_TOOLS`, so it passes the new collab write gate. |
| `runtime.ts` | took upstream (carries the new `/runtime/validate` endpoint *and* the preview route), then prefix-renamed. |
| `writeTools.ts` | MMS description kept, upstream's "never place the loop inside a `<table>`" warning merged in. |
| `ContentCollectionCreateDialog` | upstream deleted it (schema-dialog reuse) and nothing imported it — deletion accepted. |
| `ui/components/ContextMenu.module.css` | stays deleted (MMS replaced the primitive). |
| `BodySlashMenu.module.css` | kept — still imported by `BodySlashMenu.tsx`. |
| `modules/base/button` | upstream's `buttonType` (reset support) adopted with MMS's `content` rendering. |

## Known-failing gates (with reasons)

- **`SitePage-*.js` 38.1 kB vs 29.3 kB budget** — real growth from adopting 0.0.15/0.0.16.
  The guard's *intent* still holds: `AdminCanvasEditorBody`, `collab` and the
  canvas remain separate chunks. **The budget number needs an explicit decision —
  it was left failing rather than silently relaxed.**
- **"pixel-art-icons as one chunk"** — false positive. `pixel-art-icons-*` IS one
  chunk; the test's name-derived pattern also matches `upload-*.js`, a chunk from
  upstream's new media-upload feature that happens to share a vendored icon's name.
- Pre-existing (unchanged): `PreflightWidget` × 6, `@mms/shell` resolution × 3.
