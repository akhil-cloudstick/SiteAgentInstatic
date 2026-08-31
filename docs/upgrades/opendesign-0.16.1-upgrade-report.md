# OpenDesign **v0.14.0 → v0.16.1** — Upgrade Report & Customization Ledger

_Executed 2026-08-03. This doc is both the record of **this** upgrade and the permanent **MMS/SiteAgent
customization ledger** — clone it and re-verify every row on the next upgrade._

**Companion:** `docs/upgrades/opendesign-upgrade-runbook.md` (the reusable procedure) ·
`docs/upgrades/opendesign-version-comparison.md` (what each release changed).

---

## Verdict

**The upgrade landed cleanly and nothing MMS-owned was lost.** The merged tree is exactly upstream
**v0.16.1** **plus** our 131-file customization layer. The merge produced **14 conflicts**, all
resolved by hand or by explicit combine; four post-merge type/syntax repairs were needed.

| Metric | Value |
|---|---|
| Version before | **v0.14.0** |
| Version after | **v0.16.1** (latest upstream release, verified live) |
| Releases adopted | **0.14.1 · 0.15.0 · 0.15.1 · 0.16.0 · 0.16.1** (5 releases) |
| Upstream delta absorbed | 2,302 files |
| MMS customization ledger | **131 files** before merge → **131 files** after |
| Customizations silently lost | **0** (proven by set-difference, see §Verification) |
| Merge conflicts | 14 |

---

## ⚠️ The biggest finding: the version fields lie

`docs/upgrades/opendesign-version-comparison.md` claimed we were on **0.12.x**. We were actually on
**v0.14.0** — two releases further along than every in-repo signal said. **Upstream's `package.json`
version lags its release tags by 1–3 releases:**

| Upstream release | Its own `package.json` says |
|---|---|
| v0.13.0 | `0.12.1` |
| v0.16.1 | `0.15.1` |

Our vendored copy read `0.12.1` and its `README.md` advertised `0.13.0` — three signals, all
disagreeing, all wrong. The only reliable way to identify the version is to **diff the vendored tree
against each upstream release** and take the closest match:

| Candidate version | Files differing from our tree |
|---|---|
| v0.13.0 (the doc's assumption) | 1,027 |
| **v0.14.0** (actual) | **196** |
| v0.14.1 | 603 |
| v0.15.0 | 1,891 |
| v0.16.0 | 2,350 |

Getting this right is what turned an unworkable merge into **14 conflicts**: starting from the
assumed v0.13.0 would have replayed two releases of upstream changes we already had. Never trust
`package.json`; see runbook §1.

Second-order finding: `git archive` honours `core.autocrlf=true` (set in both repos) and emits CRLF,
which made every text file look 100% changed on the first attempt. All exports must use
`git -c core.autocrlf=false archive`.

---

## The 14 conflicts and how each was resolved

| # | File | Nature | Resolution |
|---|---|---|---|
| 1 | `.gitignore` | both appended | **COMBINE** — our `apps/web/tsconfig.build.json` + upstream's `.looper-attachments/` |
| 2 | `apps/daemon/src/prompts/system.ts` ×2 | both appended fields to `ComposeInput` + its destructure | **COMBINE** — our `instaticCmsMode`/`cmsRuleBody` alongside upstream's `freeformDeckSignal`/`promptCoreVariant`/`mediaHintSignal`/`platformHintSignal` |
| 3 | `apps/daemon/src/runtimes/runs.ts` | both added a hook option | **COMBINE** — our `onRunSucceeded` + upstream's `onEventEmitted` |
| 4 | `apps/daemon/src/server.ts` (a) | run-service options | **COMBINE** — both hooks wired |
| 5 | `apps/daemon/src/server.ts` (b) | upstream **moved + rewrote** design-system resolution, adding a Web Clone exemption; we had the mandatory-tenant-brand block there | **COMBINE** — adopt upstream's new location + `isWebCloneRun` exemption, re-apply our `instaticTenantMode` fallback on top (and exempt Web Clone from it) |
| 6 | `apps/daemon/src/server.ts` (c) | `promptCoreVariant` default | **DEVIATE — see below** |
| 7 | `apps/daemon/src/routes/project/index.ts` | upstream extracted our inlined bridge code into `applyUrlPreviewBridgesToHtml()` | **COMBINE** — keep our `materializeImages` + web-root asset bridge as a pre-step, then delegate to upstream's helper (it is an exact extraction of the half we would have duplicated) |
| 8 | `apps/web/src/i18n/locales/en.ts` ×11 | upstream changed copy on keys we had rebranded | **THEIRS + rebrand**, then verified our 12 non-rename copy overrides survived |
| 9 | `apps/web/src/components/plugins-home/facets.ts` ×2 | upstream replaced hand-written deck facets with generated `DECK_SUBCATEGORIES` | **THEIRS + rebrand** (our change there was purely the rename — proven) |
| 10 | `apps/web/src/components/EntryNavRail.tsx` | upstream swapped the logo `<img>` for a CSS glyph | **OURS** (MMS logo) |
| 11 | `apps/web/src/components/HomeHero.tsx` | same | **OURS** (MMS logo + "MMS Design") |
| 12 | `apps/web/src/components/EntryShell.tsx` | upstream re-added `GithubStarBadge` + expanded AMR balance imports | **COMBINE minus GithubStarBadge** — see AMR note below |
| 13 | `apps/web/src/components/HomeView.tsx` | upstream changed `preferDefaultFacet`; we wrap the section in a community-reveal gate | **OURS + upstream's prop** |
| 14 | `apps/web/src/components/FileViewer.tsx` ×4, `PreviewDrawOverlay.tsx` ×4, `runtime/srcdoc.ts` | upstream added `full` snapshot option, text-marks, redirect guard, deck chrome | **COMBINE** — see below |

### Deviation from upstream (deliberate, one place)

Upstream v0.16.1 ships:
```ts
promptCoreVariant: process.env.OD_PROMPT_CORE === 'classic' ? undefined : 'slim',
```
…carrying its **own** comment: *"VALIDATION DEFAULT — feat/system-prompt integration branch only …
main keeps classic as the default — do NOT carry this flip into a PR against main."* Adopting it
verbatim would silently swap the entire system-prompt core for every tenant.

**We adopted the slim plumbing but kept `classic` as the default** (`=== 'slim' ? 'slim' : undefined`),
because ① the CMS output contract and templateRule compliance gate were tuned against the classic
stack, and ② slim deliberately skips the tail overrides — including
`ACTIVE_DESIGN_SYSTEM_VISUAL_DIRECTION_OVERRIDE`, which backs our mandatory tenant brand.

**To opt in later:** set `OD_PROMPT_CORE=slim` on a daemon and re-run the Share-to-CMS compliance
flow. Verified: our CMS contract injection is *not* gated on the core variant, so it fires under both.

### AMR balance UI came back (flagged for your decision)

Our tree had **deleted** `AmrBalanceDialog`, `AmrLowBalanceDialog` and `amr-balance-gate`. Upstream
0.16.0 substantially expanded that pre-run balance flow, and `EntryShell`'s merged body now depends on
it. Re-deleting it would mean surgically unpicking upstream's new run-start path — a real regression
risk for no functional gain, since the strings are already rebranded to "MMS Design" via `en.ts`.

**So the AMR balance dialogs are restored.** They only surface when a tenant actually runs on the
Open Design Cloud (AMR) provider. `GithubStarBadge` remains removed from the top bar. If you want the
AMR dialogs hidden again, say so and I'll gate them behind `tenantSsoEnabled()`.

---

## Post-merge repairs (4)

| File | Problem | Fix |
|---|---|---|
| `apps/daemon/src/od-share-to-cms.ts` | upstream's `@types/node` bump made `Awaited<ReturnType<typeof fsp.readdir>>` resolve to the **Buffer** overload (`Dirent<NonSharedBuffer>[]`), breaking all 8 `entry.name` string uses | infer from the call instead: `await fsp.readdir(dir, {withFileTypes:true}).catch(() => null)` |
| `apps/web/src/components/PreviewDrawOverlay.tsx` | my combine of two helper blocks left them sharing one trailing `}` → `TS1005` | added the missing brace |
| `apps/web/src/components/FileViewer.tsx` | upstream's export callers expect `PreviewSnapshot \| null`; our retry returns the richer `PreviewSnapshotResult` | unwrap at the boundary in `captureVersionPreviewSnapshot` — both behaviours kept |
| `apps/web/app/gateway-basepath-shim.ts` | **pre-existing** (not caused by the upgrade): assigning to readonly `EventSource.CONNECTING/OPEN/CLOSED` | copy via a mutable alias — this was the reason `next.config.ts` carries `ignoreBuildErrors: true`; the web app now typechecks clean |

Also rebranded 4 tenant-visible product strings upstream newly introduced in
`FileWorkspace.tsx` demo/deck templates ("Open Design deck/document/Landing"). Identifiers, GitHub
action names ("Open Design PR") and code comments were deliberately left alone.

---

## Verification results

| Check | Result |
|---|---|
| Conflict markers remaining | **0** |
| Merged tree vs upstream `v0.16.1` | 131 files — exactly our layer |
| Customizations silently reverted to stock | **0** (`comm -23` of the before/after ledgers is empty) |
| `pnpm install` (hoisted linker) | **pass**; root `node_modules/next` present (Operator requirement) |
| `apps/daemon` build (`dist/cli.js`) | **pass** — required, `bin/od.mjs` throws without it |
| `apps/daemon` typecheck | **pass** (0 errors) |
| `apps/web` typecheck (`tsc -b`) | **pass** (0 errors) |
| `pnpm guard` | **pass** — incl. 151-brand design-system token/manifest parity |
| Guard test suite (62 tests, incl. product-neutrality) | **62/62 pass** |
| Our web suites (`source-patches`, `registry`, `turn-index`) | **75/75 pass** |
| Daemon boot + tenant SSO probe | **pass** — listens; `/sso?token=bogus` → 401; `/` → 401 (whole-surface gate live) |
| Daemon CMS suites | 99/101 pass — **2 pre-existing failures, not upgrade regressions** (below) |

### Landing on the share — and the ONE step still outstanding

| Check on `S:\SiteAgentHub\OpenDesign` | Result |
|---|---|
| Source landed (`robocopy /MIR`, 11,500 files) | **pass**, 0 failures |
| Live per-tenant builds preserved (`.next-prod-*`, `.next-*`) + `data/` | **pass** — untouched |
| `apps/daemon/dist/cli.js` | **byte-identical** to the verified local build (same MD5) |
| Daemon boots from the share | **pass** — listens; `/` → 401 and `/sso?token=bogus` → 401 (tenant SSO gate live) |
| `pnpm install` on the share | ⚠️ **incomplete — see below** |

**`pnpm install` could not finish on the share** and needs one clean run:

```
ERR_PNPM_EPERM [importPackage …\node_modules\better-sqlite3] Permission denied
```

Your tenant stack is **running** out of this exact tree — PID `21968` (`node bin/od.mjs --port 7500
--no-open`) holds `better-sqlite3`'s native module open, and PID `29080` (`next start --port 8100`)
serves a tenant's web. pnpm cannot replace a locked native module on an SMB share. (A first attempt
also hit `EPERM` renaming a stale `.pnpm-store` marker — that one is fixed: the duplicate
`.ignored_2402b86a…` symlink was removed.)

**What I did instead so the tree is runnable now:** copied all 15 verified `dist/` build outputs
from the local merge tree, and refreshed every `node_modules/@open-design/*` workspace copy (under
`node-linker=hoisted` these are real **copies**, not symlinks — a stale one is what made the daemon
fail to compile against `@open-design/contracts`). The daemon boots and serves correctly on this
basis.

**What you still need to do — stop the stack, then run once:**

```sh
# stop Operator / the tenant daemons first (they hold better-sqlite3)
cd s:/SiteAgentHub/OpenDesign
pnpm install --no-frozen-lockfile
```

Until that runs, `node_modules/.modules.yaml` is absent (pnpm's install never finalized) and the
share's `node_modules` is a partially-updated mix. Symptom if you skip it: `tsc` **from source** on
the share reports spurious `TS7006 implicitly has an 'any' type` errors in `apps/daemon/src/plugins/*`
and `genui/events.ts` — the identical source typechecks with **0 errors** on local disk, so those are
dependency drift, not code defects. The shipped `dist/` is unaffected.

### Post-upgrade hardening: the compliance gate could pass a stripped page (fixed 2026-08-04)

Found during testing, **pre-existing — not caused by the upgrade** (the gate's correction flow is
byte-identical before and after the merge). Recorded here because it was found in this test pass.

**Symptom:** a page rendered with a completely unstyled header/nav after the post-run compliance gate
"fixed" it.

**Cause:** the gate reported the *finding* (`CSS inline in <style> — External stylesheet:
<link href="style.css">`) but not the *remedy*. The agent satisfied it by **deleting the `<link>`**
instead of inlining the stylesheet's contents, stripping every shared header/nav/footer rule. The
rule then passed, because it only checks "a `<style>` block exists AND no external link" — nothing
verified the styles survived. Worse, `normalizeSiteFiles` can only inline a `<link>` that is still
there, so the page would have **imported into the CMS unstyled** too.

**Fix (two layers, both in place):**
1. `server.ts` — the correction message now states the required remedy for this rule: *copy the full
   stylesheet contents into `<style>`, THEN remove the link; shared CSS first so page styles still win.*
2. `cms-compliance.ts` — new rule **"Styles present for markup"**: fails when ≥10 distinct classes used
   in the markup have no matching selector in the page's own CSS. Skipped when an external stylesheet
   is still linked (unresolvable, and rule 2 already covers it). Verified against the real pages —
   the broken one fails with a precise reason, the repaired one passes, and the other four pages are
   skipped with no false positives.

### The 2 pre-existing failing tests — now fixed

Both were stale assertions, and both were repaired on 2026-08-04 while fixing the above. The suite is
now **101/101 green**, so it can be used as a gate on the next upgrade.

- `cms-compliance.test.ts > summarizes fail/warn counts` — the fixture had no `<style>` block, so the
  external-stylesheet rule downgraded to a warn and only 1 fail was produced. Fixed the **fixture**
  (added a `<style>` block) rather than weakening the `>= 2` assertion, preserving its original intent.
- `prompts/system.test.ts` — asserted `'Never use Tailwind CSS or any utility-first CSS'` while
  `cms-contract.ts` says `'Never use Tailwind or any…'`. Aligned the **test** to the contract; the
  prompt text is tuned and was left untouched.

### Original analysis of those two failures

Both live in files the merge **did not touch** (verified with `git diff --quiet HEAD^1 HEAD`):

1. `tests/cms-compliance.test.ts > summarizes fail/warn counts` expects `fails >= 2`. The gate now
   returns `fails: 1, warns: 3` — Tailwind is still correctly a **fail** (the protection that
   matters); the external-stylesheet rule was softened to `warn` at some earlier point and the
   assertion was never updated. **Test drift, not a broken gate** — confirmed by probing
   `checkPageCompliance` directly.
2. `tests/prompts/system.test.ts > falls back to the embedded rule…` expects the string
   `'Never use Tailwind CSS or any utility-first CSS'`; `cms-contract.ts` actually says
   `'Never use Tailwind or any utility-first CSS'` (no "CSS" after "Tailwind"). One-word mismatch.

Neither was introduced here, so I left both assertions alone rather than blur the upgrade diff —
they are one-line fixes whenever you want them.

---

## The customization ledger (131 files)

Re-verify each group on the next upgrade. **A = net-new (ours alone), M = woven into an upstream file,
D = deliberately deleted.**

### Build / runtime contract — MMS-owned, never take upstream's
| File | Why it matters |
|---|---|
| `A .npmrc` | `node-linker=hoisted` (SMB share; pnpm's symlink store fails) + `script-shell` → Git bash. Operator resolves `next` from the **root** `node_modules`, which only exists when hoisted. |
| `M pnpm-workspace.yaml` | `scriptShell:` (same reason) |
| `M apps/web/next.config.ts` | `basePath` from `OD_WEB_BASE_PATH`, the **`/sso` rewrite**, `ignoreBuildErrors` |
| `M apps/web/tsconfig.json`, `next-env.d.ts`, `.gitignore` | build shims |
| `A start-/stop-open-design.{cmd,sh}` | local run helpers |

### Share-to-CMS pipeline
`A cms-compliance.ts` · `A cms-consistency.ts` · `A cms-image-materialize.ts` · `A cms-normalize.ts` ·
`A od-share-to-cms.ts` · `A prompts/cms-contract.ts` · `A tests/cms-{compliance,consistency,normalize}.test.ts`
`M server.ts` (route `/api/projects/:id/push/instatic`, compliance gate, `loadTemplateRuleBody`) ·
`M routes/project/index.ts` · `M projects.ts` (archive normalization) · `M prompts/system.ts` ·
`M prompt-telemetry.ts` (`cmsFixInstruction`) · `M runtimes/runs.ts` (`onRunSucceeded`) ·
`M runtimes/chat-run-context.ts` + `M packages/contracts/src/api/context.ts` (`agentInstruction`) ·
`M packages/contracts/src/api/chat.ts` (`cms_fix`) · `M FileViewer.tsx` (`pushProjectToCms`, `CmsBlockedDialog`, `buildFixInstruction`)

### Tenant SSO + public gateway
`A tenant-sso.ts` · `M server.ts` (`/sso` route + whole-surface gate) ·
`A apps/web/app/gateway-basepath-shim.ts` · `A client-providers{,-inner}.tsx` · `A [[...slug]]/client-shell.tsx` ·
`A not-found.tsx` · `M app/layout.tsx` · `M app/[[...slug]]/page.tsx` ·
`M src/router.ts` (`stripBase`/`withBase`) · `M src/providers/registry.ts` (`withGatewayBasePath`, `projectFileSourceUrl`)

### Annotate / screenshot / manual edit
`A routes/capture-proxy.ts` · `M PreviewDrawOverlay.tsx` (`queryElementAtPoint`, `disableScreenshot`) ·
`M FileViewer.tsx` · `M runtime/srcdoc.ts` (`mapPublicRootAssets`, `injectAssetRewriteBridge`) ·
`M edit-mode/{bridge,source-patches,types}.ts` · `M ManualEditPanel.tsx` · `M FileWorkspace.tsx` ·
`A docs/annotation-and-screenshot-diagnosis.md`

### Theme + branding (never take upstream)
`M src/styles/tokens.css` (MMS cream `#f8f1df`, navy `#082a38`, Approval-Green; `color-scheme: light`) ·
`A src/styles/mms-overrides.css` · `M primitives.css` · `M viewer/{composio,memory,routines}.css` ·
`M src/index.css` · `M packages/components/src/button.module.css` ·
`A public/{mms-horizontal.png,favicon*,apple-touch-icon,android-chrome-*,site.webmanifest}` · `M public/app-icon.png` ·
`M src/i18n/locales/*.ts` (19 files; **en.ts carries the full rebrand + 12 copy overrides**) · `M i18n/types.ts` ·
`M` ~25 components carrying product-name strings (`HomeHero`, `EntryNavRail`, `EntryShell`, `AvatarMenu`,
`SettingsDialog`, `PlanBadge`, `HandoffButton`, `PluginsView`, `pet/*`, …) · `M state/appearance.ts`, `state/config.ts`

### Deliberate deletions
`D deploy/Dockerfile.local` · `D docs/superpowers/plans/2026-05-10-linux-client-parity.md`
_(the AMR dialog/gate deletions did **not** survive — see the AMR note above)_

### The Operator contract — breaking any of these takes tenants down
- entrypoint `node apps/daemon/bin/od.mjs --port <n> --no-open` ✔ verified
- `OpenDesign/node_modules/next/dist/bin/next` resolvable from the root ✔ verified
- env ✔ all verified present: `OD_DATA_DIR, OD_PORT, OD_WEB_PORT, OD_ALLOWED_ORIGINS, OD_SSO_SECRET,
  OD_TENANT_SLUG, OD_GATEWAY_ORIGIN, OD_INSTATIC_URL, OD_CMS_RULE_FILE,
  OD_CMS_COMPLIANCE_MAX_ATTEMPTS, OD_WEB_BASE_PATH, OD_WEB_DIST_DIR`
- `next.config.ts` rewrites `/api`, `/artifacts`, `/frames`, `/sso` ✔ verified
- `Operator/rules/templateRule.md` lives **outside** `OpenDesign/` → untouched by the upgrade ✔

---

## Reviewing the diff — `git status` will overstate it

`git status` reports **~9,700** changed paths under `OpenDesign/`. Only **1,623** of those have real
content changes (+96,861 / −44,547), plus 450 new files and 24 deletions. The remainder are
**line-ending-only** differences: the merged tree was written with LF (mandatory — see the CRLF note
above) while the previous working tree had been checked out as CRLF under `core.autocrlf=true`.

- `git diff --numstat -- OpenDesign/ 2>/dev/null | wc -l` → the true number (1,623).
- `git add` normalizes CRLF→LF on staging, so **the line-ending noise never enters a commit** —
  a commit will contain only the real changes.
- Expect `warning: LF will be replaced by CRLF` on almost every path. Harmless on Windows.

Review with `git diff` (content-accurate), not `git status` (stat-cache driven).

## What you should eyeball after your rebuild

1. Tenant SSO into OD through the hub (one login).
2. Gateway serving OD at `/od/<slug>` — assets, `/api` proxy, deep links.
3. Design run → **Share to CMS** → Instatic import: compliance gate, `templateRule` enforcement,
   the "Fix it" self-heal, and re-share **updating** rather than duplicating.
4. Annotate / screenshot / manual-edit overlay in the preview.
5. MMS theme unchanged (cream canvas, navy text, green CTA) at desktop and narrow widths.
6. New upstream surfaces worth a glance: the **message centre** bell, updater status states, and the
   deck/export additions.

## Rollback

`robocopy C:\od-upgrade\backup-od-0.13.0 S:\SiteAgentHub\OpenDesign /MIR` (the backup is the
pre-upgrade tree; the folder name reflects the old, incorrect version label), then reinstall deps and
rebuild the daemon dist. Or `git checkout -- OpenDesign/` — nothing was committed after the initial
snapshot. OD stores all state in per-tenant `OD_DATA_DIR`s outside the repo, so **there is no
schema-migration hazard** and an app-only rollback is safe.

## Highest-value follow-up

Record the clean `open-design-v0.16.1` tree on a `vendor/opendesign-upstream` branch/tag in this repo.
The next upgrade then becomes a real `git merge` against a known base, and the entire baseline-pinning
exercise in runbook §1 disappears.
