# OpenDesign Version Comparison — Current v0.12.x vs Latest v0.16.1

**Current vendored version in this repo:** `0.12.1`
_Source: `OpenDesign/package.json` → `"version": "0.12.1"` (the "Brand-backed Design System" line)._

**Latest upstream release:** `0.16.1` (2026-07-23) — [github.com/nexu-io/open-design](https://github.com/nexu-io/open-design)

> ⚠️ **Current-version caveat.** This repo's OpenDesign copy is internally inconsistent:
> `package.json` says **0.12.1**, but the local `README.md` announces **0.13.0** and the local
> `CHANGELOG.md` stops at **0.9.0** (stale). Treat **0.12.x** as the working baseline — the
> comparison gap that matters is **0.13.0 → 0.16.1** (six releases of features this repo does
> not yet have). If a git-level version check later pins it exactly, adjust the baseline.

This doc compares them **segment by segment** — agents/AI, model selection, Studio/editor,
export, design system, version history, UI, MCP, reliability, platform, localization — so each
area shows its *current (0.12.x)* state vs its *latest (0.16.1)* state.

> **Upgrade footprint note.** Unlike Instatic (one Bun package), OpenDesign is a **multi-app
> desktop monorepo** (`apps/desktop`, `apps/daemon`, `apps/web`, ~20 `packages/*`), so a version
> bump is a heavier operation. And this repo carries **local Share-to-CMS customizations** —
> `apps/daemon/src/cms-compliance.ts`, `apps/daemon/src/od-share-to-cms.ts`, and the
> `templateRule.md` enforcement — that a straight upstream pull would clobber. See "Upgrade
> notes" at the bottom.

---

## At-a-glance — the releases between us and latest

| Version | Date | Codename / headline change |
|---|---|---|
| **0.12.0** (~this repo) | — | "Brand-backed Design System" |
| 0.13.0 | 2026-07-02 | **Stay in Flow** — native session resume + screenshot-backed PPTX/PDF export |
| 0.14.0 | 2026-07-08 | **Inspiration Time Machine** — plan mode + HTML version history |
| 0.14.1 | 2026-07-10 | Model expansion — Grok 4.5 Free, GPT 5.6, Fable 5, Muse 1.1 |
| 0.15.0 | 2026-07-14 | **OD's DeepSeek Moment** — design-system prompt optimization (−49.5% time-to-first-token) |
| 0.15.1 | 2026-07-17 | **Sharper Vision, Longer Flow** — upgraded built-in OpenDesign Agent |
| 0.16.0 | 2026-07-22 | **Reliable Delivery** — automatic-update + long-running-task resilience |
| **0.16.1** (latest) | 2026-07-23 | **An Unobstructed Preview** — fixed run status covering generated work |

---

## Master comparison (0.12.x → 0.16.1)

The whole picture in one table. Each row is detailed further below.

| # | Segment / Section | Current (0.12.x) | Latest (0.16.1) | Example |
|---|---|---|---|---|
| 1 | Agents & AI runtimes | Runs restart from scratch on interruption | Native **session resume** across Codex / OpenCode / Pi / OD Cloud; long-running tasks keep newest context | Close the app mid-run, reopen, and the design run continues where it left off |
| 2 | Model selection & providers | Fixed model set; BYOK setup basic | BYOK presets + cost tiers; Grok 4.5 / GPT 5.6 / Fable 5 / Muse 1.1; Atlas Cloud / OpenRouter / OpenAI-compatible | See a model's price tier before selecting it |
| 3 | Studio / Editor | Single-page design flow | Multi-page **deck workspace** w/ thumbnails + keyboard nav; speaker notes + Presenter View; **plan mode** (Excalidraw sketch first) | Sketch a rough layout in plan mode before the agent builds the full page |
| 4 | Export & deliverables | Basic export | Screenshot-backed **PPTX/PDF**; version-specific PDF/img/ZIP/HTML; **Cloudflare Pages** preview vs production targets | Export the current version to a shareable PPTX with slide screenshots |
| 5 | Design System | Scanned brands, basic chips | Richer chip/preview UI + lightbox; repo imports preserve token packages + YAML; Source Context plugin | Import a design-system repo and keep its exact color/spacing tokens |
| 6 | Version history & recovery | No document history | **HTML version history** — track and recover previous iterations | Roll a page back to an earlier generated version without losing work |
| 7 | UI / navigation | Static home + settings | **Message center** notification bell; homepage/nav overhaul; template galleries prioritize real templates | A bell badge surfaces unread product news in Home |
| 8 | MCP & integrations | stdio helpers, some leaks | Idle stdio session cleanup; WSL setup paths; **Kiro** in the MCP picker; MCP follow-up continuation | External MCP clients get the latest message and continue instead of stalling |
| 9 | Reliability & diagnostics | Reloads on crash; vague errors | Renderer **crash-recovery screen**; export error codes; stopped tasks cancel underlying processes (no wasted quota) | Stopping a run now kills its process instead of burning quota |
| 10 | Platform & deployment | Standard installers | **Azure App Service / ACI** deploy; improved auto-update w/ clear status states | Deploy OD to Azure ACI; auto-update shows "downloading / ready to restart" |
| 11 | Localization & community | Baseline locales | Russian, Thai, Traditional Chinese coverage; expanded social/community channels | The full UI reads natively in Traditional Chinese |

---

## Segment detail

### 1. Agents & AI runtimes

_Changed across 0.13.0, 0.15.x, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Session continuity | Interruptions lose the run | Native session resume across Codex, OpenCode, Pi, OpenDesign Cloud |
| Long-running tasks | Fail near conversation limits | Continue with the newest useful context instead of aborting |
| Agent bench | Fixed set | Adds Mimo Code, upgraded built-in OpenDesign Agent (0.15.1) |
| Error recovery | Generic failures | Specific guidance for missing agents, oversized inputs, quota, timeouts |

_Example: close OpenDesign mid-run and reopen — the design run resumes from its last turn
rather than starting over._

### 2. Model selection & providers

_Changed across 0.13.0, 0.14.x, 0.15.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Model catalog | Fixed set | Adds Grok 4.5 (Free), GPT 5.6, Fable 5, Muse 1.1 (0.14.1) |
| BYOK | Basic setup | Discoverable presets; routing through OpenCode; internal/enterprise endpoints |
| Cost visibility | None | Model cost tiers shown before selection |
| Third-party endpoints | Limited | Atlas Cloud, OpenAI-compatible, Kiro, OpenRouter |

_Example: the model picker shows each model's price tier, so you can pick a cheaper tier before
committing a long run._

### 3. Studio / Editor

_Changed across 0.14.0, 0.15.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Decks | Single-page flow | Multi-page deck workspace w/ thumbnail nav + arrow/Home/End keyboard control |
| Presenting | — | Speaker notes alongside slides + Presenter View |
| Planning | Build directly | **Plan mode** — sketch in Excalidraw before committing to a full build |
| Visual direction | Limited scope | Style choices extend to documents, posters, videos, Web Clones, wireframes, Hyperframes |

_Example: start in plan mode, rough out a layout as an Excalidraw sketch, then have the agent
build from that plan._

### 4. Export & deliverables

_Changed across 0.13.0, 0.15.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Documents | Basic export | Screenshot-backed PPTX / PDF generation |
| Versioned export | Always latest edits | Export a *specific* version as PDF, images, ZIP, or HTML |
| Deploy targets | Single target | Cloudflare Pages **Preview vs Production** targets (UI + CLI) |
| Audit trail | — | Website Clone writes a `NOTES.md` with approach + known limitations |

_Example: export the current document to a PPTX where each slide is a faithful screenshot of the
rendered work._

### 5. Design System

_Changed across 0.13.0, 0.14.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Brand chips | Basic chips | Richer chip + preview UI for scanned brands; lightbox browsing |
| Repo imports | Lossy | Faithfully preserve token packages, layout values, common YAML formats |
| In-flow context | — | Design System Source Context plugin surfaces system material during work |
| Living assets | Static | Rename, pin, real swatches, GitHub-connected design systems |

_Example: import a design-system repository and keep its exact color/spacing tokens instead of an
approximation._

### 6. Version history & recovery

_Changed in 0.14.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Document history | None | HTML version history — track and recover previous iterations |
| Composer context | Results only | Source materials shown alongside results for inspection |

_Example: roll a generated page back to an earlier version without losing the current work._

### 7. UI / navigation

_Changed across 0.14.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Notifications | None | Message center: notification bell in Home + project headers, filters, mark-all-read |
| Home/nav | Older layout | Homepage + navigation overhaul; better wide-screen project display |
| Template browsing | Flat | Trending/newest sorting; galleries prioritize real-usage templates (no blank cards) |

_Example: a bell badge in Home surfaces unread product news you can filter and mark all read._

### 8. MCP & integrations

_Changed across 0.13.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| stdio helpers | Can leak | Idle stdio helpers release abandoned sessions |
| Follow-ups | Could stall | MCP conversations receive the latest message and continue |
| Client coverage | Baseline | Adds Kiro to the MCP setup picker with copyable config |
| WSL | Unclear setup | Clearer WSL MCP configuration paths |

_Example: an external MCP client continues a conversation with the newest message instead of
stalling on a stale turn._

### 9. Reliability & diagnostics

_Changed across 0.14.0, 0.15.0, 0.16.1._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Renderer crashes | Endless reload loop | Desktop recovery screen |
| Stopped tasks | Kept consuming quota | Cancel underlying processes on stop |
| Export failures | Generic | Specific export error codes + crash-evidence packaging |
| Run status UI | Could cover output | Fixed run status overlaying generated work (0.16.1) |

_Example: pressing Stop now cancels the underlying process, so a halted run stops burning quota._

### 10. Platform & deployment

_Changed across 0.13.0, 0.16.0._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Cloud deploy | Baseline | Azure App Service + ACI deployment support |
| Auto-update | Basic | Improved reliability on Windows/macOS; clear status (current / downloading / ready / waiting) |
| Proxy | Restart needed | System proxy switch picked up on the next outbound request |

_Example: deploy OpenDesign to Azure ACI, and the updater shows a clear "ready to restart" state._

### 11. Localization & community

_Changed across 0.15.0, plus site/community work._

| Aspect | Current (0.12.x) | Latest (0.16.1) |
|---|---|---|
| Locales | Baseline set | Improved Russian, Thai, Traditional Chinese coverage |
| Community | Fewer channels | Expanded official channels + community front door on the site |

_Example: the full interface reads natively in Traditional Chinese rather than partially
translated._

---

## Upgrade notes

- **Distance:** six releases (0.13.0 → 0.16.1) of features this repo lacks — session resume,
  plan mode, HTML version history, deck/export tooling, and the 0.15.0 prompt optimization
  (−49.5% time-to-first-token, −25.1% tokens).
- **Highest-value reasons to upgrade:** session resume + long-running-task resilience (#1),
  the design-system prompt optimization (#2/#5 performance), and stopped-tasks-cancel-processes
  (#9, saves quota).
- **Biggest merge risk:** this is a **desktop monorepo** and the repo carries **local
  Share-to-CMS / templateRule compliance code** (`apps/daemon/src/cms-compliance.ts`,
  `od-share-to-cms.ts`) that upstream does not have. An upgrade must re-apply those on top of
  the new base — this is the OD analog of Instatic's MMS re-skin risk.
- **Version metadata is inconsistent locally** (`package.json` 0.12.1 vs README 0.13.0 vs
  CHANGELOG 0.9.0). Reconcile the vendored version before an upgrade so the baseline is exact.
- This document is descriptive (what changed), **not** a step-by-step upgrade runbook.
