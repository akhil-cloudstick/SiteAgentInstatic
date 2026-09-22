# Phase 6 — Productionisation

## Part 1 — Today (2026-09-22). Not for execution.

- **Committed:** `5f5a874` — Phase 5 (R11, R12, R-SEO, R13) plus the Phase 4 registration gap, 46 files. `8b13886` — the approver registry's owner page.
- **Built:** P0–P3; P4 R7–R10; P5 R11, R12, R-SEO.
- **Awaiting owner:** P4 NEW-4 and R6; P5 R13. Nothing left on our side for any of them.
- **The one blocker:** a single Cloudflare relay redeploy unblocks all three. The live relay predates the approver registry and answers `No such route` for it, so that work is committed here and does nothing in production. Message written and ready to send.
- **5 bugs fixed, none of them on the board:** rule **ids** compared against rule **names**; routes predicted that the bake never writes; a relay outage marking a push *refused*; services that exited staying dead; the launcher reading credentials from the shell.
- **Next:** Phase 6 — R15 and R16. Needs nothing from the owner.
- **Pending after Phase 6:** security E2, E3, E4, E7, E8, E10; E9 in progress.

---

## Part 2 — Phase 6. For execution.

Two requirements. Neither touches the relay, so **neither waits on the owner.**

### What the board says vs what is actually there

| | Board says | Actually |
|---|---|---|
| **R15** | "clear-all snapshots first" — implying it is adequate | The backup **omits exactly the published state R15 is about** |
| **R16** | "the administrative view collapses not-up-yet into not-installed" | The console has **no studio status at all** — it shows the *CMS* runtime |

Both are worse than the board records, and both are found, not guessed.

---

### R15 — Safe replace, and a complete clear-all

**AC-D15.2 is already built** — the clear-all covers all four stores, stops the tenant first, and is correct. **AC-D15.1 is the work.**

**The finding.** `Operator/scripts/clear-tenant-cms.ts:97-103` writes its backup to
`Operator/control-plane/.state/cms-backups/<slug>-<stamp>.json`, and it captures:

| Captured | Omitted |
|---|---|
| `site.settings_json` | `data_row_versions` — **the published versions** |
| `data_rows` (draft content) | `site_snapshots` — the live-render fallback |
| `media_assets` (rows) | `data_tables` — **custom table definitions** |
| `media_folders` | redirects, `media_asset_folders` membership |
| | media **bytes** on disk, the `published/` tree, `collab_documents` |

So even once something reads it back, it **cannot restore published state** — it never held it. The board's "it takes a snapshot first" is true and misleading. There is no schema version and no checksum either, so a reader cannot tell what it is holding.

**Three more findings, none of them on the board:**

| Finding | Where |
|---|---|
| **Destructive is the DEFAULT.** `?strategy=` absent means `replace`. | `importStrategy.ts:25` |
| **Replace leaves orphans.** It never deletes `site_snapshots` (nothing in `Instatic/server` ever does) and never touches `uploads/published/` — so the old baked pages keep being served after a replace, and snapshots orphan via an `on delete set null` FK. The clear-all handles both; replace does not. | `import.ts:260-371`, `clear-tenant-cms.ts:167` |
| **R9 retains bundles nothing can read.** `listKnownGood` has **zero callers** — exported dead code. Three generations accumulate per project and no code path reads them. | `receipt.mjs:103-114` |

**And it is all untested:** zero tests for `clear-tenant-cms.ts`, zero for `retainKnownGood`/`listKnownGood`, and no test anywhere asserts what survives a replace.

**The work.**

| # | Item |
|---|---|
| 1 | Widen the backup to hold what a restore actually needs: `data_row_versions`, `site_snapshots`, the active-version pointers, `data_tables`, and redirects. A **version stamp and a checksum**, because a reader has to know what it is holding. |
| 2 | Write the reader — the restore nothing has ever had. Tenant stopped first, one transaction, `site_snapshots` before `data_row_versions` (the FK requires it). |
| 3 | Make the **replace path** take the same backup before it destroys anything. Today it takes none. |
| 4 | Clean up what replace orphans: the stale `site_snapshots` and the `published/` tree it leaves serving old pages. The clear-all already proves the right order. |
| 5 | A restore emits a receipt, reusing R9's immutable receipt table rather than a second record. |
| 6 | Retention, so backups do not grow without bound. R9 already decided the number: three generations. |
| 7 | Tests for the clear-all and the restore — both are currently untested, and the restore is the half that can corrupt a site. |

**What is deliberately NOT restored:** `collab_documents`. The clear-all deletes those precisely because they re-seed deleted pages; writing them back would resurrect what the restore is trying to place deliberately. The relay re-derives them from the restored rows on next open.

### R16 — Cold-start clarity

**The finding, worse than the board's.** The console renders status from `t.running`, which is the **Instatic CMS** runtime (`projects.astro:124-127`). `t.od_running` is on the same object and **never referenced**. So a design-only project reads **"Stopped"** with a **"Start"** button — permanently. That is the reinstall trigger, and it is not a subtle probe bug; the studio has no status surface at all.

Worse, `isRunning` is `true` the instant `spawn()` returns (`odRuntime.mjs:47`, `:322`), so it stays true for the whole multi-minute boot. `isReady` is the honest one and is never called from `server.mjs`.

**Everything needed already exists, unreported:**

| Signal | Where |
|---|---|
| `ready` — the port has answered | `odRuntime.mjs:52` |
| `inflight` — a start in progress | `odRuntime.mjs:71-98` |
| `why` — the crash reason | `odRuntime.mjs:61-62` |
| `{ready, starting, error}` tri-state | `ensure()`, `odRuntime.mjs:71-98` |
| The behaviour to copy | the waiting page, `starting.mjs:78-101` |

**The work.**

| # | Item |
|---|---|
| 1 | Report the tri-state the runtime already computes, instead of spawn-state (`server.mjs:107-112`, `tenantView.mjs`). |
| 2 | Render it: **Starting** / **Running** / **Failed (why)** / **Not set up** — four states the console cannot currently tell apart. |
| 3 | Stop offering **Start** for a studio that is already starting. |
| 4 | Record a start timestamp — the one thing the runtime does not track, and what separates "starting" from "stuck for eleven minutes". |
| 5 | Poll while anything is starting. The page reloads only during provisioning today, so a cold start never resolves on screen. |

**The constraint that shapes this:** `adminAuth.selftest.mjs:166-167` guards against per-row probing, because probing each project opened an owner session inside every one — which R5 forbids. So the fix reads in-process state, never probes. That is free: `isReady` is a Set lookup.

**Do not go looking for the words.** The phrase "not installed" appears nowhere in the admin view — a repo-wide search finds one hit, in a developer smoke-test message about a different subsystem. The defect is a *semantic* collapse, not a copy problem: what the operator actually reads is **"Stopped"** (`projects.astro:212`), **"Not running"** (`:338`), and a **Start** button offered for a daemon already mid-boot (`:272-278`). The fix is driven from the state machine and the render branch, not from changing a string.

---

## Decisions, and what settled each

You said to read the board and the PRD rather than choose. Both questions are answered there.

| Decision | Source |
|---|---|
| **Snapshot before replace**, rather than making published history survive | PRD, the R2 passage: *"a replace is not yet recoverable — R15 (Phase 6) is where that is fixed, and today's replace path takes no snapshot at all."* The PRD frames the fix as the snapshot route. |
| **Operator-side restore**, beside the clear-all | The clear-all is already an operator-run script; its restore is its pair. R14 put the admin surface behind sign-in. Nothing in the PRD grants a project self-service rollback. |
| **A restore needs no new approval** | It restores CMS *published state*; it does not put anything on the live internet. A publish does, and publish is already gated by R7. Adding a ninth gated action for something that changes no live site would widen the vocabulary for nothing. |
| **Do not restore `collab_documents`** | The clear-all deletes them *because* they re-seed deleted pages. Restoring them would undo the restore. |
| **Three retained generations** | R9 already chose three for known-good bundles; a second, different number would be a second policy. |

---

## Verification

| Requirement | Test |
|---|---|
| **AC-D15.1** | Publish a site, replace-import over it, restore — the prior published pages are back and serve. Asserted on **published versions**, not just draft rows, since that is exactly what the old backup missed. |
| **AC-D15.2** | Already built; keep it green — a deleted page stays gone from all four stores. |
| Restore is honest | A restore from a backup written by the OLD format refuses with a reason rather than half-restoring. |
| **AC-D16.1** | A studio mid-boot reports **Starting**, not Stopped and not Not-installed; a crashed one reports **Failed** with its reason; one never provisioned reports **Not set up**. |
| No regression on R5 | The listing still opens no session in any project — the existing self-test stays green. |
| Suites | Operator self-tests (which will need `new1.selftest.mjs:62` updated — it pins the current two-state shape), Relay 72, Connector 203. |

## Risks

| Risk | |
|---|---|
| **The restore is the first code that writes published state back.** | Getting it wrong leaves a site half-restored, which is worse than not restoring. Tenant stopped first, one transaction, and it refuses a backup it does not fully understand. |
| **Old backups are unrestorable.** | Every backup taken before this change lacks the published half. They will be named as such rather than silently failing at restore time. |
| **`new1.selftest.mjs` pins the two-state shape.** | Expected to change — it is asserting today's defect. |
| **No start timestamp exists yet.** | Until added, "starting" cannot be told from "hung". It is item 4 for that reason, not a nice-to-have. |

## Two things I found but am NOT doing here — your call

| | |
|---|---|
| **Destructive import is the default.** A call with no `?strategy=` replaces the whole site. That is a much wider blast radius than R15 asks about, and changing a default is a behaviour change for every existing caller — so it is not in this plan. Worth deciding separately, and it is the single cheapest safety change available. |
| **E10 becomes reachable.** R9 retains three known-good bundles per project that nothing can read. Once a restore exists, wiring `listKnownGood` to it would close E10 ("failed deployment and rollback exercised"), which is currently `todo`. Small once R15 lands — say if you want it folded in. |
| **The same bug, a second time, elsewhere.** The bridge-plugin chip in `mcp.astro:242-245` collapses "the CMS is unreachable" into "not installed", via a `.catch(() => false)` at `server.mjs:543` — identical in shape to R16's defect. It is **not** AC-D16.1 and I have not bundled it in: fixing it is a separate decision, and quietly widening a requirement is how scope creeps. Flagged so it is on the record rather than found again later. |
