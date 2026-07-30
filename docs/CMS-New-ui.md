# MMS-CMS admin-wide re-skin — MMS design language, light + dark, screen by screen
_Approved plan (2026-07-30). NOT yet executed — saved for reference; implementation begins only when the team says so. Locked via grill (Claude + user); dashboard portion hardened by Codex (rounds 1–3). Content/program/Site-editor sections pending a Codex pass when quota resets._

## Context
The whole MMS-CMS admin (`s:\SiteAgentHub\Instatic`) is being re-skinned to the MMS visual language (cream / navy / green, heavy friendly headings, restrained pill controls) from `mmsbuild-instatic-cms-redesign-guide.md`, in **both a light and a dark theme**. The client supplies approved reference images **screen by screen**; today we have images for two screens (Dashboard, Content), more to come. Two problems are solved together: (1) reintroduce a **dark theme** (the admin is single-light today — dark was deliberately removed) as a shared foundation every page inherits; (2) restyle/relayout each screen to its approved images as they arrive.

**Locked decisions (grill):** full dark mode, admin-wide; keep customizable widgets/panels but seed approved layouts + migrate existing users; **UI + theme (and required UI/UX) only** with **honest placeholders** (no fabricated data); **extend the existing token vocabulary** (no parallel `--mms-*` namespace); reuse existing primitives + stores, no bespoke duplicates.

**Why this is tractable:** every admin/ui CSS module reads `var(--token)` and hardcoded hex is banned + gated (`css-token-policy.test.ts`). Confirmed token-clean so far: dashboard, content. So a `[data-theme="dark"]` token block + a theme switch makes **every token-clean page render in dark automatically** — the per-screen work is then visual polish + any layout changes to match each image, not a color rewrite.

---

## Phase 0 — Shared theme foundation (unlocks every page)
The keystone. Do this first; all screens depend on it.

1. **Tokens in `src/styles/globals.css`:** keep `:root { color-scheme: light; }`; add `:root[data-theme="dark"] { color-scheme: dark; }` (NOT `light dark` on `:root` — native-control/token mismatch on dark OS before the attribute exists). Tune light surfaces to the assets (`--bg-body`→`#FBF7EA`, `--bg-surface`→`#FFFDF5`). New surface levels (workspace/raised/tint) map onto the existing `--bg-surface-2..5` ramp where possible; only add named tokens if the token-vocab gate/docs are updated in the same change. Use `--success` for green — no `--action` token.
2. **Dark override block** authoring dark values for the **entire consumed token set**, not just the ~10 `.md` anchors: surfaces, borders, text, `--overlay-*`, `--scrim-*`, **`--accent-1..10` + every `-10` alpha companion** (inline `--tint: var(--accent-*)` in `Widget.tsx` flips only if the accent + companion are overridden), `--danger/--warning/--success` families, `--syntax-*`, `--chart-*`, `--kbd-*`, shadows, `--focus-ring`. Canvas neon affordance rings stay constant. `.md` anchors: body `#071F29`, workspace `#082A38`, surface `#0E303A`, raised `#143843`, tint `#2B2C20`, border `rgb(248 241 223 / 12%)`, text `#F8F1DF`, text-muted `#AEBBB8`; green stays `#1BA957`.
3. **Theme state — reuse `adminUi`, no new store:** `theme: 'light'|'dark'|'system'` in the existing `adminUi` Zustand store (or a small adjacent `adminTheme` module) with a **TypeBox schema** + synchronous localStorage read helper (`parseJsonWithFallback`). On change/boot set `html[data-theme]`; for `system` subscribe to `matchMedia`.
   - **Bootstrap ↔ store contract:** the inline head script can't import TypeBox/`parseJsonWithFallback`. Fix one minimal payload — `{ "theme": "light"|"dark"|"system" }` under a fixed key — with a tiny inline defensive parser (try/catch, whitelist three literals, else `system`); the store reads/writes the same key/shape.
4. **Kill the first-paint flash** (`index.html` ~lines 41-85 hardcode loader `#f8f1df`/`#082a38` before React+globals.css): add the inline theme bootstrap in `<head>` **before the loader `<style>`**, and make the loader CSS conditional on `html[data-theme="dark"]`.
5. **Fix known non-token color injections** (these won't follow `data-theme`): `src/admin/pages/content/components/LiveCanvas/LiveCanvas.tsx` injects hardcoded `rgba(127,127,127,0.55) !important` into its preview iframe — forward the theme/token into the srcdoc style instead. Also grep `style={{ '--` across `src/admin`+`src/ui` and audit each inline custom-prop setter + any plugin-passed tint API.
6. **Theme toggle control:** existing **`Select`** primitive for `light|dark|system`; if a segmented control is wanted and none exists, ship a binary light/dark `Switch` v1 and defer `system`. Host in the admin chrome top bar/account area (the gear/account cluster present on every screen).

---

## Phase 1 — Dashboard "Live Release Desk" (images approved; Codex-hardened)
Reuse the grid engine + `Widget` primitive (`src/ui/components/Widget/`; 12-col / 70px / 980px stacking). No new grid.
1. **Chrome** in `src/admin/pages/dashboard/DashboardPage.tsx`: approved site-title header — site name, "Site is live" pill, a **boolean freshness pill** ("Changes ready" / "Draft differs" / "Up to date" — NOT a fabricated count; `getCmsPublishStatus()` gives `draftMatchesPublished`, not a count), "Last published …", "New page". Keep Customize + Add block, restyled.
2. **Register new widgets before seeding**, then **seed the Release Desk default + migrate existing users** (layout is server-persisted per-user in `user_preferences`; the `v3` string is only the old localStorage key, not a schema version): add `version?: number` to `DashboardLayoutSchema`, normalize missing/older to the default once on load, persist versioned. Map: Live preview 8×5, Release progress 4×5, Changes 8×3, Publish readiness 4×3, Recent activity 12×2; ≤980px stack order preview→release→changes→readiness→activity.
3. **Widgets:**
   - **Live-site tile** — read-only iframe at literal `'/'` (NOT `useActiveLivePath`, editor-coupled and breaks dashboard bundle isolation; NOT `pagePublicPath('/')`, yields `//`). `sandbox="allow-same-origin"` with NO `allow-scripts` (scripts disabled by the sandbox regardless of page CSP) + `pointer-events`/`inert` shield; lazy-load via IntersectionObserver hook with cleanup + mounted guard. `allow-same-origin` is PreviewOverlay cookie-parity to verify, not a URL-resolution requirement. Do NOT reuse editor-store-coupled `PreviewOverlay`.
   - **Release progress** — only publish-status-backed states; "Approval not required" until a real approval plugin API exists.
   - **Changes in this version** — honest placeholder (no audit-derived fake manifest).
   - **Publish readiness** — honest "Not configured" states; no SEO overclaim from site-level settings.
   - **Recent activity** — reuse `useRecentActivityStats()` + `ActivityWidget.tsx`.

---

## Phase 2 — Content section (images provided)
Layout is `AdminWorkspaceCanvasLayout` (`workspace="content"`): left `ContentSidebar` / center `ContentDocumentCanvas` (Tiptap) / right `ContentSettingsPanel` / `ContentToolbar` (all under `src/admin/pages/content/`). All token-clean → inherits dark from Phase 0.

**Reference divergence (client images differ structurally):** images 1&2 show a "Post settings" panel + Collections›Posts list; image 3 shows a "Content library" filterable table + a "Release" essentials checklist. Do not block on it — the visual language + dark/light theme are locked now; the **exact final content layout is confirmed against the client's latest content image at build time**. Default target = the richer image-3 structure (superset), captured as additive changes:
1. **Restyle (token/type/spacing only)** every content module CSS to the MMS look — heavier `--font-display` headings, pill controls, cream/navy surfaces, the green "Editing" badge. No color rewrites (token-clean).
2. **Left "Content library"** (image 3): add All/Drafts/Published **filter tabs** + Title/Status/Updated **columns** on top of the existing entries data from `useContentWorkspace` (`listCmsDataRows`) — additive to `ContentExplorerPanel`; keep the collections list. Confirm vs the tree-style images 1&2 at build time.
3. **Right "Release" essentials checklist** (image 3, "N of M essentials complete"): net-new component, but backed by **real per-entry data** — Title/Slug/Featured-image/SEO-description present? (via existing `readTitleCell`/`readSlugCell`/`readFeaturedMediaCell`/`readSeoDescriptionCell` in `@core/data/cells`), Public URL Pending until `publishedAt`. This is honest data, not a placeholder. Sits with/above ContentSettingsPanel's existing fields (Collection/Slug/SEO/Status/Author/Featured media), grouped under collapsible sections + "More fields" to match the images.
4. **Editor chrome:** restyle the Write/Live toggle (`ContentModeToggle`), the block inserter notch/slash menu (Heading/Text/Media/Data token), and the `PublishActionGroup` split button. "Data token" picker stays stubbed (functionality out of scope).
5. **Dark fix:** LiveCanvas iframe injected color (Phase 0 #5) must be theme-aware so Live preview matches the theme.

---

## Phase 3 — Remaining screens (repeatable pattern, as client images arrive)
Every other admin page — **Data**, **Media**, **Plugins**, **Users**, **Account/Settings**, **PreAuth/login** (`src/admin/preauth/AdminPreAuthForm.tsx`) — is handled by the same playbook. (The **Site editor** gets its own Phase 4 because it's a canvas redesign, not just a re-skin.) Because they're token-clean, Phase 0 already gives them a correct dark theme; per-screen work is visual polish + layout changes to match each image.

**Per-screen playbook (repeat for each new client image):**
1. Explore the screen's components/layout + confirm token-cleanliness (grep for hardcoded hex / injected iframe or inline colors — fix any into tokens, like the LiveCanvas case).
2. Restyle its CSS modules to the MMS language (tokens/type/spacing/pills) — no new color literals.
3. Apply layout/structure changes the image requires, as **additive** changes reusing existing primitives (`Button`/`Select`/`Switch`/`Widget`/`Tree`), never bespoke duplicates.
4. Back any new "status/checklist" UI with **real data** where it exists, honest placeholders where it doesn't — never fabricated.
5. Verify in both themes at the screen's breakpoints.

Track screens in a checklist; ship incrementally (one screen per PR is fine) but all on the shared Phase-0 foundation for consistency.

---

## Phase 4 — Site editor: canvas + chrome redesign (per the guide's editor rules)
Not just a re-skin — the guide's "Site editor rule for the later editor screen" prescribes real interaction/layout changes. Grounded in the editor layout code (`src/admin/state/workspaceLayout.ts` sidebar constants, `src/admin/pages/site/layout/responsiveChrome.ts` responsive rules) + the canvas per-frame behavior. Current spatial baseline (from the guide): permanent 42px left rail; left panel 300–520 (default 320); right panel 300–520 (default 360); left→rail-only at ≤900px when the right panel is open; right panel→overlay <760px; Design mode = fixed-width breakpoint frames in a pannable/zoomable/overflow-hidden canvas starting at 50% zoom; Live mode = one 100%-zoom frame resizable 240px→breakpoint width.

Redesign to the guide's rules:
1. **Keep pan + zoom** in multi-breakpoint **Design mode** (do not try to fit desktop/tablet/mobile beside two open panels at readable scale — panning is expected, page overflow is not).
2. **Single-frame Live mode is the operator-friendly default** (one 100%-zoom frame, resizable).
3. **Collapse the left panel by the canvas *container* width**, not only the browser's 900px viewport breakpoint — so a narrow canvas (open panels on a wide screen) still collapses correctly. Extends `responsiveChrome.ts` from viewport-only to container-query/measured-width logic.
4. **Float / overlay Properties** when the remaining canvas becomes too narrow, instead of squeezing it.
5. **Inactive breakpoint frames dimmed or compact**, active frame stays legible.
6. **Never** shrink controls or text below accessible sizes to make things fit.
7. **Re-skin the chrome** (rail, panels, toolbar, breakpoint frames) to the MMS language in both themes — token-clean, inherits Phase 0.

No approved client image for this screen yet: the guide gives concrete rules to build against; refine against the client's Site image when it arrives. This phase is heavier than a re-skin — it touches the editor layout/measurement logic, so it ships as its own PR(s) after the lighter screens.

---

## Key decisions & tradeoffs
1. **Program, not one-shot:** Phase 0 is the shared dependency; screens land incrementally as images arrive. Keeps each PR coherent (CLAUDE.md PR-scope rule).
2. **Full dark via token cascade** — valid only if every token family (incl `--accent-*-10`, charts, syntax, keycaps, shadows), the `index.html` loader, and injected iframe/inline colors are handled. Enumerated in Phase 0.
3. **Honest data over fabrication** — dashboard readiness/changes = placeholders (no backing data); content Release checklist = real (per-entry cells exist). The difference is intentional and per the doc's prohibitions.
4. **Extend existing tokens/primitives/stores** — no `--mms-*` namespace, no `--action`, no bespoke theme store; new tokens only with gate/doc updates in the same change.
5. **Don't block on client-image divergence** — lock the visual language + theme now; confirm exact per-screen layout against the latest image at build time.

## Risks / open questions
- **Flash-of-wrong-theme:** only fixed if the head bootstrap runs before the loader `<style>` and the loader CSS is theme-conditional — verify on a dark OS in `bun run dev`.
- **Injected/iframe colors beyond LiveCanvas:** each screen must be swept for non-token color injections during its playbook pass.
- **Content layout reconciliation:** images 1&2 vs 3 — resolve at content build time against the client's latest image.
- **iframe assets/CSP:** live tiles/previews use public same-origin assets (no admin-cookie dependency; admin cookie is `instatic_admin_session` Path=/admin). `frame-ancestors 'self'` is Caddy-only, optional hardening, not a dependency (framing works without it; no `X-Frame-Options`); verify under `bun run dev`.
- **Toggle host + 2-vs-3-state:** confirm chrome placement and whether `system` ships v1.
- **Future screens without images yet:** Phase-0 dark + a token restyle can proceed, but layout changes wait for the client image.

## In scope — clarified
- **UI/UX changes required to make the new design work are in scope** (per user): responsive/interaction changes like the Site editor's container-width panel collapse and floating Properties, layout restructures to match client images, new presentational components — all reusing existing primitives.

## Out of scope (this program)
- **Net-new backends / data features only:** dashboard change-manifest, dashboard readiness signals (domain/SSL, mobile, broken-links, backup), preview thumbnail, publish-progress streaming, the "Client approval" workflow (plugin concern), the content "Data token" picker.
- Editing engine *behavior* changes unrelated to the redesign (the Site canvas's editing internals/model are reused; Phase 4 changes its *layout/interaction/chrome*, not the page-tree/mutation engine).
- Anything that isn't UI/UX/theme.

## Verification
- End-of-task gate (per changed screen/PR): `bun run build` (`tsc -b && vite build`), `bun test`, `bun run lint`.
- Targeted tests: `css-token-policy`, `no-css-var-fallbacks`, `button-primitive-usage`; **new** focused tests for the theme bootstrap attribute, the theme-conditional loader, the dashboard layout version/migration, live-tile iframe `sandbox`/`inert` attributes, and the content Release-checklist derivation.
- Manual smoke (`bun run dev`, SQLite): each redesigned screen matches its approved image in **both** themes at its breakpoints; theme toggles + persists across reload with **no first-paint flash** on a dark OS; dashboard existing-user layout migrates to the Release Desk; content Live preview follows the theme (LiveCanvas fix); placeholder vs real-data states are honest.

---

## Codex adversarial review status
- **Dashboard (Phase 1):** hardened over 3 Codex rounds — 17 → 6 → 3 findings, all incorporated (root `color-scheme` split, `index.html` loader flash, full token-family override incl `--accent-*-10`, no `--action`, register-widgets-before-seed, publish-status-only release states, honest change placeholder, `pagePublicPath` bug, bundle-isolation leak via `useActiveLivePath`, layout version/migration, iframe `sandbox` semantics, CSP header-vs-meta reality, boolean freshness pill, bootstrap parser contract).
- **Content (Phase 2), program (Phase 3), Site editor (Phase 4):** added after Codex's quota was exhausted — **not yet cross-model reviewed**. Recommend one `/codex-review` pass on these before implementing them.
