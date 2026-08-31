# Instatic Version Comparison — Current v0.0.7 vs Latest v0.0.14

**Current vendored version in this repo:** `0.0.7` (2026-06-29)
_Source: `Instatic/package.json` → `"version": "0.0.7"`._

**Latest upstream release:** `0.0.14` (2026-07-25) — [github.com/CoreBunch/Instatic](https://github.com/CoreBunch/Instatic)

**Seven releases** separate this repo's copy (0.0.7) from upstream latest (0.0.14). This doc
compares them **segment by segment** — logic, workflow, UI, AI, security, platform — so each
area shows its *current (0.0.7)* state vs its *latest (0.0.14)* state.

> Install footprint is stable: `engines.bun` is unchanged across the range (`>=1.3.0 <1.4.0`),
> and the changelog notes no dependency additions/removals. Upgrading carries no new
> install-time requirements. **Caveat:** this repo carries a heavy local **MMS-CMS re-skin**
> (`src/core/brand.ts`, `src/styles/globals.css`, Remix-icon vendoring) — a straight upstream
> pull would conflict with that theming. See "Upgrade notes" at the bottom.

---

## At-a-glance — the releases between us and latest

| Version | Date | Headline change |
|---|---|---|
| **0.0.7** (this repo) | 2026-06-29 | MCP connectors for external AI clients |
| 0.0.8 | 2026-07-01 | Unified Framework panel + consolidated Explorer + security headers |
| 0.0.9 | 2026-07-01 | Redesigned AI assistant panel (tool-call rows, previews, auto-titles) |
| 0.0.10 | 2026-07-01 | OpenAI-compatible custom AI provider |
| 0.0.11 | 2026-07-11 | Transactional saves, multi-image AI, light theme, security hardening |
| 0.0.12 | 2026-07-24 | MCP OAuth + AI provider settings redesign + loop preview |
| 0.0.13 | 2026-07-24 | Page-slug editing dialog + SVG/contrast fixes |
| **0.0.14** (latest) | 2026-07-25 | `isSafeUrl()` javascript-URL bypass fix + scroll-container fix |

---

## Master comparison (0.0.7 → 0.0.14)

The whole picture in one table. Each row is detailed further below.

| # | Segment / Section | Current (0.0.7) | Latest (0.0.14) | Example |
|---|---|---|---|---|
| 1 | AI Assistant Panel (UI) | Plain message stream; manually named chats | Compact tool-call rows, inline color/render previews, auto-titled chats, avatars, errors as toasts | A `site_apply_css` call renders as a labeled row with a color swatch instead of raw text |
| 2 | AI Providers & multimodal (logic) | Built-in providers only; text prompts | OpenAI-compatible custom base-URL provider; multi-image chats (paste/picker); context meter | Point the AI at a local/self-hosted OpenAI-compatible endpoint; paste 3 screenshots into one prompt |
| 3 | MCP Connectors (integration + security) | Scoped bearer tokens; no expiry | OAuth authorization + token lifecycle; 90-day token expiry; headless doc listing; capability-gated publishing | An external agent authorizes via OAuth instead of pasting a static token |
| 4 | Framework & Explorer panels (UI/workflow) | Separate Layers / Site / Code / Media; separate framework controls | One tabbed **Framework** panel (Full/Variables/None) + one consolidated **Explorer** | Layers, Code, and Media now live as tabs in a single left panel |
| 5 | Canvas & editor interactions (UX) | Basic scroll/select; limited shortcuts | Middle-mouse panning, Shift+wheel horizontal pan, empty-canvas right-click menu, aligned shortcuts | Hold the middle mouse button to pan the canvas like a design tool |
| 6 | Content & data model (logic/workflow) | Plain data tables; no structured field editors; template-title bug | Structured/media/relation field editors, repeater/loop authoring, loop preview, editable page slugs | Add a "related posts" relation field; edit a page's slug via the new Page settings dialog |
| 7 | Import pipeline (logic) | Iframes imported as raw HTML; script/SVG edge cases | YouTube/HTML video → native Video modules; module scripts install npm deps; SVG sizing/fragments preserved | An imported `<iframe youtube>` becomes an editable Video block |
| 8 | Publishing engine (reliability) | Non-transactional saves; Windows slot-swap + scroll issues | Transactional whole-site saves w/ explicit deletes + serialized queue; Windows swap fix; scroll-container preserved | A save that deletes + adds pages now commits atomically or not at all |
| 9 | UI / theming (UI) | Dark-only admin; fixed text size | Light admin theme, UI text-size + density preferences, restored switch/canvas contrast | A user switches the admin to light theme and bumps UI text size |
| 10 | Security & data safety (security) | CodeQL-flagged sanitizers tightened | `isSafeUrl()` allowlist rewrite (javascript-URL bypass, GHSA-pqcp-872g-gmp8); injection hardening; upload validation; CSP `base-uri`/`object-src` | `javascript:` URLs with control chars are no longer marked "safe" |
| 11 | Platform & reliability (logic) | Postgres JSON hydration + interrupted-AI-turn issues | Postgres JSON text-column hydration fix; retryable AI browser-tool turns; stream cleanup; Sharp patch | A dropped AI browser-tool turn is retried instead of failing the chat |

---

## Segment detail

### 1. AI Assistant Panel

_Where: the in-editor AI chat panel. Changed in 0.0.9 and 0.0.12._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Tool calls | Raw text in the message stream | Compact labeled rows with status indicators |
| Previews | None | Inline color-token swatches + render snapshots |
| Conversation titles | Named manually | Auto-titled from first prompt; avatar + relative timestamp |
| Errors | Inline / easy to miss | Surfaced as toasts |
| Model selection | Could reset between messages | Persists across the chat |

_Example: asking the assistant to recolor a heading shows a tool-call row "Applied CSS · color"
with a live swatch in 0.0.14; in 0.0.7 the same action printed a plain text line._

### 2. AI Providers & multimodal

_Where: AI provider settings + chat composer. Changed in 0.0.10, 0.0.11, 0.0.12._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Providers | Built-in provider set only | Adds **OpenAI-compatible** provider with a custom base URL |
| Images | Text prompts | Multi-image conversations via paste + file picker, compact galleries |
| Cost visibility | None | Context meter: remaining context, tokens, cache, cost, pricing |
| Provider settings UI | Basic | Redesigned for clearer connection management (0.0.12) |

_Example: point the assistant at any OpenAI-compatible endpoint (self-hosted or third-party) by
entering a base URL, then paste three screenshots into a single prompt for a multi-image review._

### 3. MCP Connectors

_Where: external-AI-client integration (`server/ai/mcp/`). Changed in 0.0.8, 0.0.11, 0.0.12._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Auth | Static scoped bearer tokens | **OAuth** authorization with scoped grants + token lifecycle |
| Token expiry | None | Expiry timestamps, 90-day grace period |
| Reads | Tool surface exposed | Adds headless document listing |
| Publishing | Not gated per capability | Capability-gated publishing from connectors |

_Example: an external agent (Claude Code / Codex) completes an OAuth handshake to obtain a
scoped, expiring grant instead of the owner pasting a long-lived static token._

### 4. Core Framework & Explorer panels

_Where: the editor's left-side panels. Changed in 0.0.8._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Framework controls | Separate/scattered | One tabbed **Framework** panel: Full / Variables / None manager |
| Layers/Site/Code/Media | Four separate surfaces | One consolidated **Explorer** panel with a dedicated Code tab |
| Media on canvas | Not draggable from Media workspace | Drag media assets straight onto the canvas |

_Example: Layers, Code, and Media browsing now live as tabs inside a single Explorer panel
instead of being reached through separate views._

### 5. Canvas & editor interactions

_Where: the visual editor canvas. Changed across 0.0.8–0.0.11._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Panning | Limited | Middle-mouse-button panning; Shift+wheel pans horizontally |
| Empty-space actions | None | Right-click empty canvas → body context menu |
| Shortcuts | Canvas/Layers diverged | Canvas and Layers keyboard shortcuts aligned |
| Wheel behavior | Inconsistent | Normal wheel = vertical scroll, Shift+wheel = horizontal pan |

_Example: hold the middle mouse button and drag to pan the canvas, matching design-tool muscle
memory._

### 6. Content & data model

_Where: content workspace, data tables, page settings. Changed 0.0.11–0.0.14._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Field editors | Plain fields | Editors for structured, media, and relation values |
| Repeaters/loops | Limited | Repeater authoring; loop output shown in page preview |
| Data tables | Could default kind to plain table | Retains the selected table kind |
| Page slugs | Not directly editable | Editable via a new **Page settings** dialog |
| Composed templates | Used template titles | Use rendered page/entry titles |

_Example: add a "related posts" relation field to a collection, then edit that page's URL slug
in the Page settings dialog instead of it being fixed._

### 7. Import pipeline

_Where: Import Site / Super Import. Changed 0.0.10–0.0.13._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Video/iframes | Imported as raw HTML | YouTube iframes + HTML `<video>` → native Video modules |
| Module scripts | npm deps not always installed | Imported module scripts install their npm dependencies |
| SVG | Sizing/fragment edge cases | Imported SVG sizing + safe fragment refs preserved through import & publish |

_Example: an imported page containing a YouTube `<iframe>` becomes an editable Video block
rather than an opaque HTML embed._

### 8. Publishing engine

_Where: whole-site save + static publish. Changed 0.0.11, 0.0.14._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Saves | Not transactional | Transactional whole-site save with explicit deletes + serialized queue |
| Windows | Static publish-slot swap could fail | Slot-swap fixed on Windows |
| Scroll | Publisher could drop scroll container | Window scroll container preserved |
| Media | Background images unoptimized | Media-library backgrounds optimized into responsive variants |

_Example: a save that deletes one page and adds another now commits atomically — no half-applied
state if a step fails._

### 9. UI / theming

_Where: admin shell preferences. Changed 0.0.11, 0.0.13._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Theme | Dark-only admin | Light admin theme option |
| Text size | Fixed | UI text-size preference alongside density settings |
| Contrast | — | Restored contrast on switches + canvas mode controls |

_Example: a user switches the admin to the light theme and increases UI text size for
readability._

> **Note for this repo:** we already ship a bespoke **MMS-CMS light "cream" theme** via
> `src/styles/globals.css` + `src/core/brand.ts`. Upstream's generic light theme overlaps this
> area, so it is the segment most likely to conflict on an upgrade.

### 10. Security & data safety

_Where: URL guards, upload validation, CSP. Changed 0.0.11, 0.0.14._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| URL safety | Sanitizers tightened per CodeQL | `isSafeUrl()` rewritten to an **allowlist** (WHATWG stripping); fixes control-char `javascript:` bypass — **GHSA-pqcp-872g-gmp8**; three guards unified w/ arch tests |
| Attribute injection | — | Custom HTML attributes hardened against stored script injection |
| Uploads | — | Magic-byte, MIME, SVG sanitization, and path-traversal validation |
| CSP | Baseline | Adds `base-uri 'self'` and `object-src 'none'` |

_Example: in 0.0.7 a `javascript:` URL padded with control characters could slip past the
denylist; 0.0.14's allowlist marks it unsafe. **This is the most upgrade-worthy fix.**_

### 11. Platform & reliability

_Where: DB layer, AI runtime, tooling. Changed 0.0.11–0.0.14._

| Aspect | Current (0.0.7) | Latest (0.0.14) |
|---|---|---|
| Postgres | JSON text-column hydration bug | Hydration fixed |
| AI turns | Interrupted browser-tool turns could fail | Recovered as retryable failures |
| Streams | Could leak on disconnect | MCP/editor/plugin streams cleaned up |
| Deps/health | — | Sharp patched; function-level coverage reporting restored |

_Example: if an AI browser-tool turn is interrupted mid-flight, 0.0.14 marks it retryable
instead of failing the whole conversation._

---

## Upgrade notes

- **Distance:** 7 releases (0.0.7 → 0.0.14). No `engines.bun` change; no dependency additions
  flagged in the changelog, so no new install-time requirements.
- **Highest-value reasons to upgrade:** the `isSafeUrl()` security fix (#10), transactional
  saves + Windows publish-slot fix (#8), and the MCP OAuth / token-expiry work (#3).
- **Biggest merge risk:** this repo's **MMS-CMS re-skin** (#9 theming, brand strings, Remix
  icons) overlaps upstream's new light theme and UI-preference work. Plan the theme
  reconciliation before pulling.
- This document is descriptive (what changed), **not** a step-by-step upgrade runbook.
