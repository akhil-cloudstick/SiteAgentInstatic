# OD → CMS compliance — core logic, the flow, and the failure playbook

_Canonical reference for how OpenDesign (OD) is kept compatible with the Instatic CMS importer. Read this before touching `templateRule.md`, the OD CMS contract prompt, or the compliance gate. Companion to [`od-cms-vision.md`](./od-cms-vision.md) (the acceptance bar for "Share to CMS")._

## The core idea (veg-kitchen)

Instatic's "Import Site" is a **visual editor importer**, not a web host. It reads a page's HTML **as a text file** — it never runs the page's JavaScript — and turns each element into an **editable block**, and the CSS into **editable rules and color/font tokens**. So it can only accept content that is already **real, static HTML** with **plain CSS** it can parse.

A non-technical tenant just types a prompt ("build me a toy store with a filterable gallery"). They neither know nor should have to know what "inline JS content" is. So the fix is **at the source**:

> **Run a veg-only kitchen.** OD must only ever "cook" what the CMS can "eat" — build every page to the import limits from the start. If a tenant asks for something off-menu (a JS-built gallery, a `color-mix()` background), OD makes the closest thing the CMS *can* serve (a static gallery, a `var(--token)` color) and tells the tenant plainly. It never plates the non-compliant dish and lets the gate reject it at the counter.

**Compliance is about the TECHNIQUE, not the feature.** Animations, 3D, loading spinners, filterable galleries, carousels, tabs — all are welcome. They're built with a *compliant technique* (CSS + behavioral JS on already-present static markup), never with JS that *generates content*. OD analyzes the intended feature and picks the compliant implementation; it must **never keyword-match** the prompt (a tenant asking for "js" or "animation" is not asking to break the import).

## The three layers (why the gate is not the fix)

1. **Prevention — OD builds it right (the primary layer).** `templateRule.md` is the authoritative, example-rich contract of exactly what the importer accepts; it is injected into OD's system prompt via [`cms-contract.ts`](../OpenDesign/apps/daemon/src/prompts/cms-contract.ts) (`renderCmsOutputContract`, read live from `OD_CMS_RULE_FILE`), with a hard-requirements shortlist and a silent self-audit.
2. **Deterministic fix at share/preview — the guarantee.** Two mechanical, boilerplate incompatibilities that OD builds on nearly every page are repaired automatically so the page passes *clean* with **no tenant action and no gate block**:
   - **Images** — [`cms-image-materialize.ts`](../OpenDesign/apps/daemon/src/cms-image-materialize.ts) guarantees every referenced image is a real CMS-accepted file under `public/images/`: it **captures** an external photo URL (SSRF-guarded download), **fetches a real royalty-free photo** (keyless Lorem Picsum, deterministic seed) for a bare local `/images/x` with no file, or writes a **self-contained SVG placeholder** offline. Runs on the **preview** serve (fixes the OD canvas + Design panel) and in the **share** pipeline (real bytes reach the CMS). Provider-free (the AI image provider isn't needed).
   - **Visible-without-JS** — [`cms-normalize.ts`](../OpenDesign/apps/daemon/src/cms-normalize.ts) `makeVisibleWithoutJs` injects a `data-od-cms-visible` override on the **CMS-bound copy only** so content hidden until JS runs (a JS-dismissed loading overlay → `display:none`; `opacity:0`/`visibility:hidden` in-flow content → forced visible) shows in the (script-less) editing canvas. OD's source/preview keeps its JS animations.
   - It still does the older *lossless* normalize (inline CSS, convert utilities, wrap bare text, web-root asset paths). It does **not** silently rewrite genuine **design choices** (e.g. a `background: oklch(…)` colour) — those still FAIL the gate → Fix-it. **The line:** mechanical compatibility fixes are automatic (the page looks identical, it just imports); design choices are never silently changed.
3. **The gate — last-resort net + one-click self-heal.** At Share-to-CMS, [`cms-compliance.ts`](../OpenDesign/apps/daemon/src/cms-compliance.ts) checks the (normalized + auto-fixed) HTML; a `fail` returns HTTP 422 `CMS_COMPLIANCE_FAILED`. With layer 2 handling images + blank-canvas, the gate should rarely fire — only for a design-level violation (Tailwind, `@layer`, `color-mix` shorthand, JS-*built* content, external CSS). Then the tenant sees a **reassure-first dialog** (no jargon dump) with **Cancel** and **Fix it**. "Fix it" drops a short, reassuring message into the OD chat (`buildFixVisibleMessage`) while the agent privately receives the full compliance detail + fix directives via the hidden **`context.agentInstruction`** channel (`buildFixInstruction` → `onFixItPrompt` → `ProjectView.handleFixItPrompt` → `handleSend`, `entryFrom:'cms_fix'`); the agent edits the source to comply. A `warn`-only rule 14 ("content visible without JavaScript") backstops anything the transform missed.

The goal: layers 1–2 make the gate almost never fire. Nothing broken ever imports.

## The flow

```
tenant prompt → OD builds a page (must be compliant by construction)
   → Share to CMS
     → materialize images (real files under public/images) + normalize + makeVisibleWithoutJs (CMS copy)
     → compliance gate
         ├─ pass (the common case) → stage into Instatic → Import wizard → edit → publish
         └─ fail (design-level only) → 422 → reassure-first dialog (Cancel | Fix it)
                    └─ Fix it → short message in chat + hidden agentInstruction → AI edits source
                               → tenant re-clicks Share to CMS → pass
(the OD preview serve also materializes images, so the OD canvas shows them before any share)
```

## What Instatic actually accepts / blocks (researched)

Evidence lives in the importer: `Instatic/src/core/siteImport/*`, `htmlImport/*`, `css-substitution/*`, and the publisher. The full, example-rich version is in [`Operator/rules/templateRule.md`](../Operator/rules/templateRule.md); this is the summary.

**❌ Never output (breaks the import):**
- **Content built by JavaScript** (`innerHTML`/`createElement`/template strings, framework hydration) — the importer never runs JS → imports **blank**. THE #1 rule.
- **Content hidden until JS runs** (a full-screen loading overlay a script removes; `opacity:0`/`visibility:hidden` content revealed only by a JS-added class / `IntersectionObserver` scroll reveal) — the importer strips `<script>`s from the editing canvas, so it renders **blank there** (shows only on the published site). *Auto-fixed at share by `makeVisibleWithoutJs`; prevention keeps OD from building it.*
- **Tailwind / utility classes**, Tailwind CDN, `@apply` — styles lost.
- **`@layer`** (and `@import`/`@page`/`@namespace`) — the whole block is dropped silently (also kills compiled Tailwind v4).
- **Modern color function (`oklch`/`lab`/`lch`/`color-mix`/`color()`) bare inside a `background`/`border`/`font` shorthand** — the whole declaration is dropped; use `var(--token)` or the longhand.
- **External (non-Google) stylesheets**; **`@fontsource`, non-Google font CDNs, v1 `/css?family=`, `.eot`, `local()`-only** fonts.
- **Hashed/build artifacts** (`/_astro/*`, hashed chunks, ESM asset imports), **SPA hydration roots**.
- **Unsupported images**: avif/ico/bmp/tiff/heic; `data:` images; any `?query`/`#fragment` in the path. *(External `http(s)` photo URLs are now OK — `cms-image-materialize.ts` captures them into `public/images/` before share; a bare `/images/x` with no file is filled with a real photo/placeholder. So a build never ships a dead `<img>`.)*
- **Asset paths hardcoded inside `<script>` text** (not rewritten → 404); **inline `on*=` handlers** (stripped).

**✅ Imports perfectly:**
- Inline `<style>`; inline `style="…"`; `:root { --x: color }` → editable color token; `--font-*` tokens.
- `@media`/`@supports`/`@container`/`@keyframes`; `transition`/`animation`/`transform`/`sticky`/`grid`/`flex`/gradients/`url()`.
- Single bare class `.hero` → editable rule (compound/descendant/pseudo/element selectors import as non-editable ambient rules).
- Semantic HTML → editable blocks; `id`/`data-*`/`aria-*`/`role` preserved.
- **Behavioral JS** (menu/tabs/carousel/nav-active/DOM-reading swaps) survives and re-runs; prefer classic scripts.
- Google `/css2` fonts (self-hosted), self-hosted `@font-face` `.woff2`.
- `<img>` in jpg/png/webp/gif/svg (+ mp4/webm), clean web-root paths; byte-identical images de-duplicated on re-share.
- Identical top-level `<nav>/<header>/<footer>` across pages → one shared component.

**Note — `data-sa` is a no-op.** The importer reads no `data-sa` attribute; editability comes from the element type. The old `data-sa` requirement (and the compliance warn-rule) were retired.

## Future compliance-failure playbook (follow this — don't jump to code)

When a tenant's page fails to Share-to-CMS **after** this system shipped, diagnose *before* changing anything, into one of two buckets, then fix the matching layer and **test**. If it still fails, repeat for the next cause. This converges the rulebook toward 100% coverage.

1. **Reproduce & read the failure.** Run `node Operator/rules/check-template-rule.mjs <the page.html>` (or read the 422 detail) to see the exact rule(s).
2. **Classify:**
   - **(A) Adherence gap — OD broke a rule that IS already in `templateRule.md`.** The rule exists; the AI didn't follow it. → Fix: make the rule more prominent in `templateRule.md` and the `cms-contract.ts` hard-requirements shortlist; strengthen the self-audit. (The operator's stronger-model knob also helps here — see the vision doc's model note.) The tenant's immediate escape hatch is the gate's **Fix it** button, which asks the AI to correct the *source*. Do **not** paper over a content-level adherence gap with a silent rewrite in `cms-normalize.ts` — that hides the miss and leaves the OD source wrong; normalize is reserved for *lossless* mechanical transforms only.
   - **(B) Coverage gap — OD did something the CMS rejects that is NOT in `templateRule.md`.** A newly-discovered importer limitation. → Fix: research the exact importer behavior in `Instatic/src/core/siteImport|htmlImport`, then ADD the constraint to **all three**: `templateRule.md` (with a ✅/❌ example), the compliance checkers (`cms-compliance.ts` + `check-template-rule.mjs`, in parity), and the matrix above.
3. **Test:** rebuild the page in OD (or a fixture) and confirm the checker is clean and the share succeeds.
4. **Repeat** for any remaining cause.

Keep the two checkers (`cms-compliance.ts` and `check-template-rule.mjs`) in lockstep, and keep `templateRule.md` ↔ the checkers ↔ this matrix in sync — a rule that blocks at the gate must also be taught to OD, or a tenant hits a wall they can't understand.

## Where each piece lives
- `Operator/rules/templateRule.md` — the authoritative build contract (read live by OD).
- `OpenDesign/apps/daemon/src/prompts/cms-contract.ts` — injects it into OD's prompt + hard-requirements shortlist + self-audit + offline fallback.
- `OpenDesign/apps/daemon/src/cms-compliance.ts` + `Operator/rules/check-template-rule.mjs` — the gate checkers, incl. rule 14 "content visible without JavaScript" (keep in parity).
- `OpenDesign/apps/daemon/src/cms-normalize.ts` — lossless mechanical normalizer **+ `makeVisibleWithoutJs`** (the CMS-copy visible-without-JS auto-fix); no design-choice rewrites.
- `OpenDesign/apps/daemon/src/cms-image-materialize.ts` — the deterministic image guarantee (capture external / fetch Picsum / SVG placeholder → `public/images/`); wired into the raw-route preview serve (`routes/project/index.ts`) and the share handler (`server.ts`), reusing `connectionTest.ts`'s SSRF-guarded fetch.
- Share gate + dialog: `OpenDesign/apps/daemon/src/server.ts` (422 + the hidden `context.agentInstruction` → `# User request` compose) → reassure-first `CmsBlockedDialog` + `buildFixVisibleMessage`/`buildFixInstruction` in `OpenDesign/apps/web/src/components/FileViewer.tsx`; **Fix it** wiring `onFixItPrompt` (`{visible, instruction}`) → `FileWorkspace.tsx` → `ProjectView.tsx` (`handleFixItPrompt` → `handleSend` with `context.agentInstruction`, `entryFrom:'cms_fix'`). Hidden channel typed in `packages/contracts/src/api/context.ts` + `apps/daemon/src/runtimes/chat-run-context.ts`.
