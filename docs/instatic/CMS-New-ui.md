# MMS-CMS admin-wide re-skin — all 7 screens, light + dark (MMSBUILD v2 guide)
_Approved plan (2026-07-31). **Implementation in progress** on branch `feat/cms-reskin-dark-and-screens` (uncommitted): Phase 0 dark theme + first-pass changes on all 7 screens are done and tsc/lint/gate-verified; several per-screen items remain (see the status table in "Visual review & bug log"). Source of truth: `mmsbuild-instatic-cms-redesign-guide` v2 (developer handoff, 31 Jul 2026)._

## Context
Re-skin the entire Instatic CMS admin (`s:\SiteAgentHub\Instatic`) to the MMSBUILD design language (cream / navy / green, heavy headings, restrained pills) in **both a light and a dark theme**, matching the approved **v2 developer-handoff guide**, which is pixel-approved across all 7 workspaces and repo-cross-checked at commit `c35fd8fb…` (all 64 reference paths exist).

**Guide's golden rules (apply to every screen):** the mocks are *visual targets*, not permission to replace Instatic's state / persistence / authorization / rendering. Start from each screen's Repository constraints, adapt existing components, implement progressive disclosure as *presentation* logic, and **never fabricate status** — every visible status must come from a real repository or MMSBUILD workflow state (or an explicit "unavailable" state). Everyday clients stay in the MMSBUILD Client Hub; this CMS is operator/agency backstage.

**Ground truth from exploration:** admin is currently **single light theme** (dark was removed; no `data-theme` switch). Every admin/ui CSS module is **token-clean** (`var(--*)` only, hardcoded hex gated) — confirmed for dashboard, content, data, media, plugins, users — so a dark token block + switch cascades to all screens automatically. Two data-driven color injections need dark-safe handling: `LiveCanvas.tsx` (iframe `rgba(127,127,127,0.55) !important`) and the Data select-option swatch (`CellDisplayRenderer.tsx:180/211`). The `index.html` loader hardcodes light colors (first-paint flash).

**Scope:** UI + theme + required UI/UX only. Widgets whose data doesn't exist render **honest "unavailable / not configured / not required"** states — never fabricated. New MMSBUILD backend adapters (Dashboard preflight sources, change-manifest) are **flagged, not built** this pass.

---

## Phase 0 — Shared shell, theme foundation & access (guide Phase 1)
The keystone; every screen depends on it.

1. **Dark theme reintroduction in `src/styles/globals.css`:** keep `:root { color-scheme: light }`; add `:root[data-theme="dark"] { color-scheme: dark }` (NOT `light dark` on `:root`). Tune light surfaces to the assets; add workspace/raised/tint surface levels onto the existing `--bg-surface-2..5` ramp (no `--mms-*` namespace, no `--action` token — use `--success`). Author a **complete dark token set** (surfaces, borders, text, `--overlay-*`, `--scrim-*`, `--accent-1..10` + every `-10` companion, danger/warning/success, syntax, charts, keycaps, shadows, focus ring). `.md` anchors: bg `#071F29`, workspace `#082A38`, surface `#0E303A`, raised `#143843`, tint `#2B2C20`, border `rgb(248 241 223 / 12%)`, text `#F8F1DF`, text-muted `#AEBBB8`; green stays `#1BA957`. Light↔dark are **semantically identical** — theme changes surfaces/contrast only, never actions/meaning/permissions.
2. **Theme state — reuse `adminUi` store (no new store):** `theme: 'light'|'dark'|'system'` with a TypeBox schema + a minimal shared payload `{ "theme": … }`; inline `<head>` bootstrap (before the loader `<style>`) sets `html[data-theme]` pre-paint with a tiny defensive parser; loader CSS made theme-conditional to kill the flash. Toggle via existing `Select` (or binary `Switch` v1), hosted in the top-bar/account cluster.
3. **Fix non-token color injections** (won't follow `data-theme`): LiveCanvas iframe color → forward theme into the srcdoc; Data select-swatch → add a dark-safe border/contrast. Grep `style={{ '--` across `src/admin`+`src/ui` and audit remaining inline custom-prop setters (all others found are geometry, not color).
4. **Preserve authorization**: no route/store/handler/capability changes — this is presentation + task hierarchy. Visible actions derive from the existing capability model; never leak disabled tabs/controls that name inaccessible features.

---

## Phase 1 — Routine operator screens (guide Phase 2): Dashboard, Content, Data, Media

### Screen 1 — Dashboard "Live Release Desk"
Reuse the 12-col / 70px grid + `Widget` (`src/ui/components/Widget/`) + 980px stacking, in the **lightweight** layout (no CanvasRoot / editor store / DnD graph / CodeMirror). **Preserve OnboardingPanel (5 setup steps)** for first-run; the Release Desk is the returning-operator state.
- **Grid map** (seed as default + version-migrate existing users via `version?:number` on `DashboardLayoutSchema`): Live preview 8×5 · Release progress 4×5 · Changes in this version 8×3 · **MMSBUILD preflight 4×3** · Recent activity 12×2. ≤980px DOM order: preview→release→changes→preflight→activity.
- **Live preview** (new read-only widget): renders the **published** site only via a sandboxed, non-interactive iframe at the literal `'/'` path (NOT `pagePublicPath('/')`→`//`, NOT `useActiveLivePath` — editor-coupled) or a server thumbnail; 16:9, `min-width:0`, `overflow:hidden`; lazy-load on viewport-enter (IntersectionObserver + cleanup); controls (Desktop/Mobile, Open preview, Edit site) OUTSIDE the surface; fallback thumbnail when embedding is blocked. Do NOT reuse the visual-editor canvas or `PreviewOverlay`.
- **Release progress** (new): Editing→Preview→Client approval→Published + CTA. Client approval is a **Hub/plugin workflow record**, not core state — show **"Approval not required"** for operator-only projects; never overload draft/published fields to fake approval.
- **Changes in this version**: needs a real aggregation endpoint / revision manifest — **must NOT be fabricated** from the publish-lineup. This pass: **honest empty/derived state**; the aggregation endpoint is flagged backend work.
- **MMSBUILD preflight** (replaces the old static Publish-readiness): rows Domain & SSL · Draft synchronization · Plugin runtime · Client approval · Backup policy, each from an **explicit adapter/aggregation response**. The current `StatusWidget`/`DomainWidget` are hardcoded placeholders — do NOT use them as a data source, and **do NOT restore SEO basics / Mobile view / Broken links** rows. A preflight row must not block publishing unless its adapter is authoritative and represents unavailable/error explicitly. *(These adapters — hosting/DNS, backup, collab-readiness, plugin status — are largely MMSBUILD infra; unbuilt sources render as honest "unavailable" this pass.)*
- **Recent activity**: reuse `useRecentActivityStats()` + `ActivityWidget`, compact 12×2.

### Screen 2 — Content "Live-context editor"
Approved = the **Post-settings** layout (guide images 1 & 2), reusing the three-pane `AdminWorkspaceCanvasLayout` (`workspace="content"`). *(The earlier "Content library table + Release checklist" concept is superseded.)*
- **Document toolbar** (`ContentToolbar` + `ContentModeToggle`): one sticky row — breadcrumb, dirty state, Write/Live, Save draft, Publish menu, Open live entry. **Preserve status derivation** (Unsaved draft / Saving draft / Draft saved / Publishing / Published / Save failed).
- **Live canvas** (`LiveCanvas`): keep the single iframe + markdown/editor bridge; add only the green focus edge + "Editing article content" label. **Dark:** make the injected iframe color theme-aware; the template-rendered site inside Live keeps its real site colors (dark applies to admin chrome only). Write-mode quick actions (Heading/Text/Media/Data token) never show over Live.
- **Content library** (`ContentSidebar`/`ContentExplorerPanel`): improve row hierarchy, search visibility, selected/status/date scanning, New-post prominence — **rows, not cards**.
- **Post settings** (`ContentSettingsPanel`): group into Publishing / URL / SEO / Featured media / Author & collection / More fields as **presentation-level disclosure** around the existing inputs + gates. **SEO "Complete" is a locally-derived summary** of the SEO title/description cells (via `@core/data/cells`), not a persisted status or API. Keep custom fields lazy in More fields. Retain the compact first-post empty state.

### Screen 3 — Data "Adaptive Data Workbench"
Reuse three-pane layout: `DataSidebar` / `DataGrid` / `DataInspector` (42px rail + 300–520px bounds from `src/admin/state/workspaceLayout.ts`).
- **One adaptive shell**, actions derived from table kind / system flag / selected row / status / capabilities. Grid stays **read-only**; editing in `RowDetail` via `CellEditorRenderer`. **Do NOT** add a Records/Schema tab or a Table-settings toolbar shortcut (guarded by `dataPageToolbar.test.ts`) — deselecting the row is the transition to `TableSettings`.
- **Inspector:** group `RowDetail` into Core content / table-specific details / SEO; `TableSettings` progressive disclosure General / Display / Fields / Routing / Danger (no row selected). Add the quiet "Deselect the row to manage table fields" helper.
- **Handoffs:** custom post-type → **Edit in Content** (primary); page/component → **Open in Site editor** (+ suppress Add row/destructive on system tables); plain data → relabel Add-row with the singular label, no editorial chips, autosave visible.
- **Fix:** the layout-kind badge bug in `DataSidebar.tsx` (`kindLabel` map missing `'layout'` → renders "data"). **Dark:** add a border/contrast to the data-driven select-option swatch (`CellDisplayRenderer.tsx:180/211`); media thumbnails keep natural colors. Preserve `useDataGridSelection`/`dataGridRows.ts` semantics.

### Screen 4 — Media "Adaptive Media Workspace"
Canvas-style layout, **no `contentRightPanel`**; floating windows. Reuse `MediaPage`, `MediaCanvas`, `MediaSidebar`/`MediaFolderPanel`, and the shared `FloatingWindow`/`PanelHeader`/`useDraggablePanel`/`workspaceLayoutStorage`.
- **Preserve derived windows:** 1 selection → `MediaViewerWindow`, 2+ → `BulkEditWindow`, clear → close; `UploadQueueWindow` independent/persistent (rules at `MediaPage.tsx:79-92`). No permanent inspector.
- **Folders + fixed smart folders** (Missing alt/title, Untagged, Large >1MiB, Recently replaced) + Trash; warm selection tint; folders before assets.
- **Upload** (`useUploadQueue`): keep 3-concurrency; **extend `UploadItem` with `checkSizeLimit` level/message** for the per-file 10 MB soft warning (50 MB hard fail); destination subtitle from `UploadItem.folderId`.
- **Replace** (`ReplaceFileDialog`): clearer current/new comparison; keep the same-URL permanent-replacement warning; **no affected-pages enumeration** (usage table `media_usage_refs` is dormant — **no usage counts**).
- **Dark:** admin chrome only — thumbnails/preview keep natural brightness (already token-clean). Don't hardcode the mock's counts/salon data. Preserve `media.read/write/replace/delete` gates + server MIME/magic-byte validation.

---

## Phase 2 — Advanced / security-sensitive screens (guide Phase 3): Plugins, Users

### Screen 5 — Plugins "Adaptive lifecycle workspace"
Lightweight `AdminPageLayout`; single VM `usePluginsWorkspace`. One adaptive workspace, three contextual states:
- **Control room (default):** 4 summary tiles (installed / active / needs-attention / **Live status** from the SSE bridge) **derived from `payload.plugins`** (no second inventory, no update-ready count); client-side search/status/sort; per-card controls on `PluginCard` (Settings, Schedules, Re-sync pack, Restart, Reinstall, Enable/Disable, Remove — destructive Remove separated).
- **Safe install review:** `pendingInstall` + `PermissionReviewSection` + host diff; **mandatory approval + step-up**, all-or-nothing grants, `editor.code` unsandboxed warning retained; fresh installs show full allowlist, upgrades diff hosts.
- **Recovery focus:** built **only** from `lifecycleStatus` / `lastError` / `recentCrashes` / enabled / schedules / sibling list; expose "Open recent issues". **Remove the v1 mock's `Last healthy`, `Affected: analytics export only`, and `CMS core unaffected`** rows — the payload has no `lastHealthy` / affected-scope / core-health probe (per the v2 guide; the older recovery PNGs still showing them are superseded). Upgrade panel appears only after a newer package is uploaded (no marketplace/auto-update).
- **Dark:** surfaces/borders/contrast only; status meaning, warning strength, permission/recovery copy identical to light.

### Screen 6 — Users "Adaptive Team Access"
Lightweight `AdminPageLayout`; `useUsersPageData`; capability-gated tabs (internal `users`/`roles`/`audit`, friendlier visible labels People/Roles/Activity).
- **Team roster (People):** identity / status / role / **read-only MFA** / last login / owner-protected; client-side search + filters; keep existing row actions in overflow, **never expose actions on Owner**.
- **Safe account creation:** focused panel (move `UserDialog` fields intact) — email, display name, **initial password ≥12**, non-owner role, active default; **direct create (no invitations)**; step-up; **preserve the password-manager-suppression input names**; plain-language role summary.
- **Progressive role workbench (Roles):** split workspace (role list / identity / **searchable grouped capabilities** / outcome summary) replacing the oversized modal, around the same `CapabilityPicker`/`CAPABILITY_GROUPS`. Render counts from payload — **38 capabilities, 11 groups, Client = 5**; Owner locked; `roles.manage` owner-only; step-up on create/update/delete.
- **No** invitations / teams / SSO / approval queues / per-user overrides. **Dark:** surfaces/borders/contrast only.

---

## Phase 3 — Guided Site workspace (guide Phase 4): Screen 7
Three states over **two real render surfaces + one presentation-only focus flag** — do NOT add a third persisted canvas engine.
- **Live Edit** (default): existing `CanvasLiveSurface`, one 100%-zoom editable iframe; device controls set viewport width.
- **Section Focus:** UI-only focus flag over the same Live canvas/selection/collaborative document — dim surroundings, keep selection/undo identity; background controls not keyboard-active when dimmed.
- **Responsive Review:** existing `design` canvas / `CanvasTransformLayer` / breakpoint frames; emphasize the active frame, dim/compact companions, keep pan/zoom.
- **Guide editor rules:** collapse the left panel by **canvas *container* width** (extend `src/admin/pages/site/layout/responsiveChrome.ts` beyond the 900px viewport rule); float/overlay Properties when the canvas is narrow; never shrink controls/text below accessible sizes. Breakpoint labels read the site config (defaults Mobile 375 / Tablet 768 / Desktop 1440).
- **Guided inspector:** Page outline = projection of top-level layer nodes (`node.label`); Add section → existing inserter; show VC-instance params first, else the selected-node schema; slot content = real slot children (VC param types limited to string/number/boolean/url/enum/color/image/richText/slot — no repeater param).
- **Collab preserved:** states Draft synced / Connecting / Offline / Sync failed (no "Draft saved"/manual Save); Publish disabled until synced; `whenCollabWritable()` before programmatic writes. Capability split: `site.content.edit` / `site.structure.edit`+`pages.edit` / `site.style.edit` / `pages.publish`; Client hides Add section/Insert/Duplicate/Reorder/Layout/Style/advanced CSS.
- **Dark = delivery gap:** the 3 Site states are approved **light only**; generate dark from the corrected light states (Phase-0 tokens theme the chrome automatically; the *visual* dark mocks are still to be produced).

---

## Cross-cutting
- **Honest data (no fabrication):** the only genuinely backend-bearing items are the Dashboard **MMSBUILD preflight** adapters and the **Changes** aggregation (rendered as explicit "unavailable"/empty until MMSBUILD provides them), plus retaining the upload soft-warning level. Everything else is presentation/disclosure over existing state.
- **Capability gates** preserved on every screen; server-side permission/step-up/system-record/destructive protections stay intact after visual refactor.
- **Reuse primitives** (`Button`/`Select`/`Switch`/`Widget`/`Tree`/`FloatingWindow`/`CapabilityPicker`) — no bespoke duplicates.

## Acceptance checklist (from the guide)
Client completes preview/approval/change-request without raw Instatic · one clear primary job per screen, Advanced restores full toolset · every visible status is real (no fabricated draft/approval/safety/validation) · actions shown/hidden from the capability model, no leaked disabled features · Site = 2 canvas engines + 1 focus flag (not 3) · VC quick-edit uses supported param types + real slot children · breakpoint labels read site config · narrow layouts keep readable text/controls + internal overflow, no page-level horizontal overflow · light/dark meet contrast and leave the live site/media visually unmodified · keyboard/iframe focus, floating-window reachability, reduced motion tested · sync/offline/error/publish/destructive outcomes announced semantically, not by color alone · server-side protections intact.

## Verification
- End gate per screen/PR: `bun run build` (`tsc -b && vite build`), `bun test`, `bun run lint`.
- Targeted gates: `css-token-policy`, `no-css-var-fallbacks`, `button-primitive-usage`, `dataPageToolbar`, `capability-picker-coverage`; **new** tests for the theme bootstrap attribute + theme-conditional loader + dashboard layout version/migration + live-tile iframe `sandbox`/`inert`.
- Manual smoke (`bun run dev`, SQLite) per screen in **both themes** at its breakpoints: matches the approved asset; theme toggles + persists with **no first-paint flash** on a dark OS; ≤980px/narrow layouts preserve readable controls + internal overflow; capability-gated actions correct; placeholder vs real-data states honest.

## Codex adversarial review status
Dashboard portion hardened over 3 Codex rounds (17→6→3 findings, all folded in). The expanded all-7-screens plan is **not yet cross-model reviewed** (Codex quota exhausted; resets ~Aug 29). Recommend one `/codex-review` pass before implementation.

---

# Visual review & bug log

Screenshots of the running build (both themes) + fixes needed, per screen. Save
images to [`cms-new-ui-review/`](./cms-new-ui-review/) using the naming convention
in that folder's README, then reference them below. Paste in chat + describe a
bug and it gets logged here.

Run the app via **`npm run dev` from `s:\SiteAgentHub\Operator`** (control-plane;
not `bun run dev` from Instatic).

## Implementation status (branch `feat/cms-reskin-dark-and-screens`)

| # | Screen | Done this pass | Remaining |
|---|--------|----------------|-----------|
| 0 | Theme foundation | Dark token block, `adminTheme` store, pre-paint bootstrap + theme-conditional loader, toggle on every route | — |
| 1 | Dashboard | Live preview / Release progress / Changes (honest empty) / MMSBUILD preflight (honest rows) widgets + Release Desk default layout | Site-title header, existing-user layout migration, real preflight/changes adapters |
| 2 | Content | Carded post-settings sections (Publishing + Schedule row, URL + copy, SEO chip, Featured, Author, More) · library reskin: "Search content", prominent "New post", collection chevron, entry rows = title + status·date (no thumbnail) · Live-canvas green "Editing article content" edit-frame · Write/Live toggle moved into the toolbar as a text segmented control | Document sub-toolbar breadcrumb ("Posts / <title>" + dirty state) row |
| 3 | Data | Layout-kind badge fix, dark-safe select swatch | RowDetail Core/details/SEO grouping, deselect helper, kind handoffs |
| 4 | Media | Per-file 10 MB soft-warning surfaced in upload queue | Folder destination subtitle, replace comparison, restyle |
| 5 | Plugins | Control-room summary tiles (real payload counts) | Install-review polish, recovery view |
| 6 | Users | Roster client-side search | Status/role/security filters, account panel, role workbench |
| 7 | Site | Guided-mode labels (Live edit / Responsive review) | Section Focus mode, container-width panel collapse |

## Bug log

Newest first. Format: `[screen] theme — description → fix → status`.

- **[all] dark — "Dark theme looks light (green/white), not navy."** Root cause: the admin already had a `theme` preference (Settings › Preferences › Theme) that sets `html[data-editor-theme]`, but globals.css had **no dark block** for it (default was `'dark'` → fell back to `:root` cream), plus a leftover **cool-gray** `[data-editor-theme='light']` block, and my first pass added a *third* parallel `data-theme` system. → **Fixed:** removed the cool-gray block + the parallel `data-theme`/`adminTheme`/index-bootstrap; retargeted the MMS-navy dark tokens to `[data-editor-theme='dark']`; set `:root` light to the exact mock cream (`--bg-body #FBF7EA`, `--bg-surface #FFFDF5`); default theme → `light`; toolbar toggle now drives the real `theme` pref. Light = MMS cream + navy text + green primary; Dark = MMS navy `#071F29` + cream text + green primary. → **DONE** (tsc/lint/css-gates + appearance test pass). ⚠️ Requires running/deploying this branch to see it.

## Approved reference mocks

All 75 MMSBUILD design assets live in [`cms-new-ui-review/`](./cms-new-ui-review/)
(committed to the repo). Per screen: the **build-target** master(s) are embedded
inline; every other variant (approved-vN, existing capture, existing-vs-redesign
comparison, and early direction explorations) is linked under **More variants**.
Site has approved **light** states only (dark is the guide's delivery gap).

### Screen 1 — Dashboard (Live Release Desk)
_Build target: repo-aligned preflight v2._
| Light | Dark |
|---|---|
| ![Dashboard — light](./cms-new-ui-review/01-dashboard-light-repo-aligned-preflight-v2.png) | ![Dashboard — dark](./cms-new-ui-review/01-dashboard-dark-repo-aligned-preflight-v2.png) |

More variants: [approved-warm (light)](./cms-new-ui-review/01-dashboard-light-approved-warm.png) · [approved (dark)](./cms-new-ui-review/01-dashboard-dark-approved.png) · [fused live-release-desk](./cms-new-ui-review/01-dashboard-light-fused-live-release-desk.png) · [option 1](./cms-new-ui-review/01-dashboard-light-option-1.png) · [option 2](./cms-new-ui-review/01-dashboard-light-option-2.png) · [option 3](./cms-new-ui-review/01-dashboard-light-option-3.png)

### Screen 2 — Content (Live-context editor)
| Light | Dark |
|---|---|
| ![Content — light](./cms-new-ui-review/02-content-light-approved-live-context-editor.png) | ![Content — dark](./cms-new-ui-review/02-content-dark-approved-live-context-editor.png) |

More variants: [existing](./cms-new-ui-review/02-content-existing.png) · [existing vs redesign](./cms-new-ui-review/02-content-existing-vs-redesign-comparison.png) · [dir: editorial writing desk](./cms-new-ui-review/02-content-light-direction-editorial-writing-desk.png) · [dir: live-context editor](./cms-new-ui-review/02-content-light-direction-live-context-editor.png) · [dir: release-aware workbench](./cms-new-ui-review/02-content-light-direction-release-aware-workbench.png)

### Screen 3 — Data (Adaptive Workbench)
_Master frame = selected custom-post-type record._
| Light | Dark |
|---|---|
| ![Data — light](./cms-new-ui-review/03-data-light-approved-adaptive-workbench.png) | ![Data — dark](./cms-new-ui-review/03-data-dark-approved-adaptive-workbench.png) |

Companion states: ![system-safe index](./cms-new-ui-review/03-data-light-repo-aligned-system-safe-index-v2.png) ![schema/records lens](./cms-new-ui-review/03-data-light-repo-aligned-schema-records-lens-v2.png) ![operator record desk](./cms-new-ui-review/03-data-light-direction-operator-record-desk.png)

More variants: [existing](./cms-new-ui-review/03-data-existing.png) · [existing vs redesign](./cms-new-ui-review/03-data-existing-vs-redesign-comparison.png) · [dir: system-safe index](./cms-new-ui-review/03-data-light-direction-system-safe-index.png) · [dir: schema records lens](./cms-new-ui-review/03-data-light-direction-schema-records-lens.png)

### Screen 4 — Media (Adaptive Workspace)
| Light | Dark |
|---|---|
| ![Media — light](./cms-new-ui-review/04-media-light-approved-adaptive-workspace.png) | ![Media — dark](./cms-new-ui-review/04-media-dark-approved-adaptive-workspace.png) |

States: ![asset library](./cms-new-ui-review/04-media-light-approved-asset-library-state.png) ![safe file replacement](./cms-new-ui-review/04-media-light-approved-safe-file-replacement-state.png) ![upload queue](./cms-new-ui-review/04-media-light-approved-upload-queue-state.png)

More variants: [existing](./cms-new-ui-review/04-media-existing.png) · [existing vs redesign](./cms-new-ui-review/04-media-existing-vs-redesign-comparison.png) · [dir: asset library desk](./cms-new-ui-review/04-media-light-direction-asset-library-desk.png) · [dir: safe file replacement](./cms-new-ui-review/04-media-light-direction-safe-file-replacement.png) · [dir: upload intake organizer](./cms-new-ui-review/04-media-light-direction-upload-intake-organizer.png)

### Screen 5 — Plugins (Lifecycle workspace)
Control room (v2 approved):
| Light | Dark |
|---|---|
| ![Plugins — light](./cms-new-ui-review/05-plugins-light-approved-installed-control-room-v2.png) | ![Plugins — dark](./cms-new-ui-review/05-plugins-dark-approved-installed-control-room-v2.png) |

Safe install review:
| Light | Dark |
|---|---|
| ![Install review — light](./cms-new-ui-review/05-plugins-light-approved-safe-install-review.png) | ![Install review — dark](./cms-new-ui-review/05-plugins-dark-approved-safe-install-review.png) |

Uploaded-upgrade & recovery (repo-aligned v3 = build target):
| Light | Dark |
|---|---|
| ![Recovery — light](./cms-new-ui-review/05-plugins-light-repo-aligned-upgrade-recovery-v3.png) | ![Recovery — dark](./cms-new-ui-review/05-plugins-dark-repo-aligned-upgrade-recovery-v3.png) |

> ⚠️ **Recovery build note:** the older recovery mocks still show `Last healthy`,
> `Affected: analytics export only`, and `CMS core unaffected`. Per the v2 guide
> (and the real plugin payload, which has no `lastHealthy`/affected-scope/core
> health probe) the built recovery view must **omit** them — build to v2 text.

More variants: [control room v1 (light)](./cms-new-ui-review/05-plugins-light-approved-installed-control-room.png) · [control room v1 (dark)](./cms-new-ui-review/05-plugins-dark-approved-installed-control-room.png) · [recovery v1 (light)](./cms-new-ui-review/05-plugins-light-approved-upgrade-recovery.png) · [recovery v2 (light)](./cms-new-ui-review/05-plugins-light-approved-upgrade-recovery-v2.png) · [recovery v1 (dark)](./cms-new-ui-review/05-plugins-dark-approved-upgrade-recovery.png) · [recovery v2 (dark)](./cms-new-ui-review/05-plugins-dark-approved-upgrade-recovery-v2.png) · [existing](./cms-new-ui-review/05-plugins-existing.png) · [existing vs redesign](./cms-new-ui-review/05-plugins-existing-vs-redesign-comparison.png) · [existing vs redesign v2](./cms-new-ui-review/05-plugins-existing-vs-redesign-comparison-v2.png) · [dir: control room](./cms-new-ui-review/05-plugins-light-direction-installed-control-room.png) · [dir: install review](./cms-new-ui-review/05-plugins-light-direction-safe-install-review.png) · [dir: upgrade recovery](./cms-new-ui-review/05-plugins-light-direction-upgrade-recovery.png)

### Screen 6 — Users (Team Access)
Team roster:
| Light | Dark |
|---|---|
| ![Users — light](./cms-new-ui-review/06-users-light-approved-team-access-roster.png) | ![Users — dark](./cms-new-ui-review/06-users-dark-approved-team-access-roster.png) |

Safe account creation (repo-aligned v2):
| Light | Dark |
|---|---|
| ![Account — light](./cms-new-ui-review/06-users-light-repo-aligned-safe-account-creation-v2.png) | ![Account — dark](./cms-new-ui-review/06-users-dark-repo-aligned-safe-account-creation-v2.png) |

Progressive role workbench:
| Light (v3) | Dark (v2) |
|---|---|
| ![Roles — light](./cms-new-ui-review/06-users-light-repo-aligned-role-access-workbench-v3.png) | ![Roles — dark](./cms-new-ui-review/06-users-dark-repo-aligned-role-access-workbench-v2.png) |

More variants: [account creation approved (light)](./cms-new-ui-review/06-users-light-approved-safe-account-creation.png) · [account creation approved (dark)](./cms-new-ui-review/06-users-dark-approved-safe-account-creation.png) · [role workbench v2 (light)](./cms-new-ui-review/06-users-light-approved-role-access-workbench-v2.png) · [role workbench approved (dark)](./cms-new-ui-review/06-users-dark-approved-role-access-workbench.png) · [existing](./cms-new-ui-review/06-users-existing.png) · [existing vs redesign](./cms-new-ui-review/06-users-existing-vs-redesign-comparison.png) · [dir: roster](./cms-new-ui-review/06-users-light-direction-team-access-roster.png) · [dir: account creation](./cms-new-ui-review/06-users-light-direction-safe-account-creation.png) · [dir: role workbench](./cms-new-ui-review/06-users-light-direction-role-access-workbench.png) · [dir: role workbench v2](./cms-new-ui-review/06-users-light-direction-role-access-workbench-v2.png)

### Screen 7 — Site (Guided workspace)
_Approved **light** only (dark = guide delivery gap). Three states over two real render surfaces + one focus flag._
| Live Edit | Section Focus | Responsive Review |
|---|---|---|
| ![Live edit](./cms-new-ui-review/01-site-light-repo-aligned-guided-live-editor-v2.png) | ![Section focus](./cms-new-ui-review/01-site-light-repo-aligned-section-focus-workbench-v2.png) | ![Responsive review](./cms-new-ui-review/01-site-light-repo-aligned-responsive-review-studio-v2.png) |

More variants: [existing editor reference](./cms-new-ui-review/01-site-existing-user-reference.png) · [dir: guided live editor](./cms-new-ui-review/01-site-light-direction-guided-live-editor.png) · [dir: section focus](./cms-new-ui-review/01-site-light-direction-section-focus-workbench.png) · [dir: responsive review](./cms-new-ui-review/01-site-light-direction-responsive-review-studio.png)
