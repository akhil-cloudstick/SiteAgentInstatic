# Instatic 0.0.7 → 0.0.14 — Preflight Impact Report
_Phase 1 deliverable. Read-only analysis against the real upstream diff. No merge has been performed. This doc doubles as the permanent MMS customization ledger — re-check it on every future upgrade._

Generated on branch `instatic-0.0.14` (cut from the frozen baseline `backup/siteagent-v1` @ `a270f56`).
Upstream compared: clean `github.com/CoreBunch/Instatic` tags **v0.0.7 → v0.0.14**.

---

## Verdict

**The upgrade is feasible and the real conflict surface is materially SMALLER than the pre-analysis feared.** The single biggest worry — a token-vocabulary rename collision across ~156 CSS files — **does not exist**: upstream and MMS already speak the same token language. The genuine work is ~10 files of import-engine reconciliation, a **migration ID renumber**, and a mechanical theme-value merge.

**Scale of upstream delta:** 844 files, +46,036 / −16,283 lines across 7 releases.

### Corrections to `docs/instatic-version-comparison.md` (it was wrong on two points)
1. **There ARE 3 new DB migrations** (`019_mcp_connector_token_expiry`, `020_site_sync_sequence`, `021_mcp_oauth`) — the comparison doc said "no schema migration." This creates an **ID collision** with MMS's own migrations (see §Conflicts).
2. **One dependency bumped:** `sharp ^0.34.5 → ^0.35.0` (the doc said "no dependency add/remove" — technically one version bump; no adds/removes; bun engine unchanged).

---

## Good news — confirmed de-risks

| # | Finding | Impact |
|---|---|---|
| D1 | **Token vocabulary is identical.** Upstream 0.0.14 `globals.css` defines the exact MMS names (`--bg-body/-surface/-2..5`, `--border/-muted/-strong/-subtle`, `--accent-1..10` + every `-10`, `--overlay-*`, `--text-*`). Upstream module CSS: **0** use `--editor-*`, 130 use `--bg-*`, 172 use `--text-*` — same as MMS (126 `--bg-*`, 0 `--editor-*`). | The "re-tokenize 156 files" risk is **gone**. `CLAUDE.md`'s `--editor-*` design section is simply **stale**. globals.css merge = MMS keeps VALUES, adopt upstream's token STRUCTURE. |
| D2 | **All 5 net-new MMS files are absent upstream** — `brand.ts`, `tenantSso.ts`, `sso.ts`, `importSiteHtml.ts`, `siteImport/stagedImports.ts`, `useStagedSiteImportHandoff.ts`, `globalSections.ts` — none exist in upstream 0.0.14. | Zero merge conflict; they carry over untouched. `sso.ts` and `globalSections.ts` were over-classified as "woven"; they are isolated. |
| D3 | **7 "woven" files are upstream-UNTOUCHED** in the range: `commitPlan.ts`, `linkRewrite.ts`, `conflicts.ts`, `htmlImport/text.ts`, `importPlanning.ts`, `main.tsx`, `index.html`. | The MMS edits in these apply cleanly (3-way merge sees theirs==base). Includes the big `everywhere`-template promotion in `commitPlan.ts`. |
| D4 | **MCP OAuth is a NET-NEW subsystem** (`server/ai/mcp/oauth/**` didn't exist at 0.0.7), and **no MMS code customizes MCP** (all `server/ai/mcp/*` files are stock upstream). | Adopt wholesale; no MMS collision inside Instatic. One cross-repo check flagged below. |

---

## Real conflicts — ranked, with the resolution

### C1 — Migration ID collision (HIGH, concrete)
MMS added `019_ai_message_model_id`, `020_media_content_hash`. Upstream added `019_mcp_connector_token_expiry`, `020_site_sync_sequence`, `021_mcp_oauth`. **Numbers 019 & 020 mean different things on each side.**
- **Fix:** keep upstream's 019–021 as-is (they're the "official" sequence); **renumber the 2 MMS migrations to `022_ai_message_model_id`, `023_media_content_hash`** (append after upstream). Apply the renumber **identically in `migrations-pg.ts` AND `migrations-sqlite.ts`** (gated by `migration-parity.test.ts`). Verify no code references the old MMS IDs as strings.
- Pre-release ⇒ safe to drop the local dev DB and re-run all 023 migrations from scratch.

### C2 — `src/core/htmlImport/rules.ts` (HIGH)
Upstream rewrote this exact rule table for YouTube/`<video>` → Video modules + SVG sizing; MMS edited the same table (inline-text handling, `a.btn` icon-recurse).
- **Fix:** take upstream's new rule table as the base, then **re-apply** the two MMS behaviors on top (both must work — MMS text/button fidelity AND upstream video/SVG import). Hand-combine, don't pick a side.

### C3 — `server/handlers/cms/index.ts` router (HIGH)
Upstream changed the dispatch chain; MMS registers `handleSsoRoutes` + the two staged-import routes here.
- **Fix:** re-insert the 3 MMS `?? (await handle…)` links + their imports into upstream's new ordering (SSO early, staged-import near the other import routes).

### C4 — Import-engine reconcile set (MED–HIGH)
Upstream changed these files that MMS also edited: `src/core/siteImport/adapter.ts` (MMS added `upsertEverywhereTemplate` iface), `src/admin/pages/site/store/slices/site/helpers.ts` (its impl), `src/admin/modals/SiteImport/SiteImportModal.tsx` (staged handoff + `forceOverwriteResolutions`, conflicts-step removed), `src/admin/modals/SiteImport/shared/createSiteImportAdapter.ts` (shim + dedup flag), `server/handlers/cms/mediaUpload.ts` (content-hash dedup).
- **Fix:** per file, take upstream behavior as base and re-apply the MMS addition. These are additive MMS methods/flags — low semantic conflict, but real textual hunks.

### C5 — `src/styles/globals.css` (MED, mechanical thanks to D1)
Upstream restructured tokens; MMS owns the cream/navy/green VALUES + self-hosted fonts + single light theme.
- **Fix:** adopt upstream's token STRUCTURE (any new token names/plumbing), overwrite VALUES with MMS. Because the vocabulary matches (D1), this is find-and-set values, not a rename. Keep MMS light-only for this PR (dark deferred to CMS-New-ui).

### C6 — Trivial (LOW)
`src/core/siteImport/index.ts` (barrel re-export — re-add MMS export), `src/core/siteImport/cssToStyleRules.ts` (MMS debug `console.error` — just drop it, don't re-add).

---

## MCP static-token → OAuth (behavioral change, adopt wholesale)
Upstream replaces static scoped bearer tokens with an OAuth authorization subsystem + token expiry (`019_mcp_connector_token_expiry`, `021_mcp_oauth`). Inside `Instatic/` **no MMS code customizes MCP**, so this is an internal upstream upgrade — take it.
- **Cross-repo check (flagged, outside this repo):** if the **Operator control-plane** provisions tenant MCP connectors by minting *static* connector tokens, that path breaks under OAuth. Verify `Operator/control-plane/*` before enabling connector provisioning for tenants. (Not blocking the Instatic merge; note for the connector-provisioning owner.)

---

## Per-customization disposition

| Customization | File(s) | Disposition |
|---|---|---|
| Brand constant | `src/core/brand.ts` | **SAFE** (net-new, absent upstream) |
| Tenant SSO verify + handler | `server/auth/tenantSso.ts`, `server/handlers/cms/sso.ts` | **SAFE** (net-new) |
| Share-to-CMS glue | `importSiteHtml.ts`, `siteImport/stagedImports.ts`, `useStagedSiteImportHandoff.ts` | **SAFE** (net-new) |
| everywhere-template promotion | `siteImport/commitPlan.ts`, `globalSections.ts` | **SAFE** (upstream untouched / net-new) |
| Link canonicalization | `siteImport/linkRewrite.ts` | **SAFE** (upstream untouched) |
| Force-overwrite re-share | `siteImport/conflicts.ts`, `importPlanning.ts` | **SAFE** (upstream untouched) |
| Import text/button fidelity | `htmlImport/text.ts` (SAFE) · **`htmlImport/rules.ts` (CONFLICT C2)** | mixed |
| Remix icons | `vendor/pixel-art-icons/**`, `src/styles/remixicon/**`, `RemixIcon/**` | **SAFE** (isolated) — plus add mappings for any new upstream icon names |
| CSS entry imports | `src/admin/main.tsx`, `index.html` | **SAFE** (upstream untouched) |
| Router registration | `server/handlers/cms/index.ts` | **CONFLICT C3** |
| `upsertEverywhereTemplate` + import modal + dedup | `adapter.ts`, `helpers.ts`, `SiteImportModal.tsx`, `createSiteImportAdapter.ts`, `mediaUpload.ts` | **RE-APPLY C4** |
| Design token VALUES | `src/styles/globals.css` | **RE-APPLY C5** (vocab aligned) |
| MMS migrations | `migrations-pg.ts`, `migrations-sqlite.ts` | **CONFLICT C1** (renumber to 022/023) |
| Barrel / debug log | `siteImport/index.ts`, `cssToStyleRules.ts` | **RE-APPLY C6** (trivial) |
| Export / site-transfer | `export.ts`, `import*.ts` | **SAFE** (stock — take upstream) |
| Publisher | `src/core/publisher/**` | **SAFE** (stock — take upstream) |

---

## Recommended merge sequence (Phase 2+, on user go-ahead)
1. Scratch-repo 3-way merge (base=v0.0.7, theirs=v0.0.14, ours=MMS) → copy merged tree back to `instatic-0.0.14`.
2. Resolve in this order: **C1 migrations** → **C3 router** → **C4 import engine** → **C2 rules.ts** → **C5 globals.css** → **C6 trivial**.
3. Bump `package.json`→0.0.14, `sharp`→^0.35.0; update `CHANGELOG.md`; fix stale `--editor-*` in `CLAUDE.md`/`design.md`/`design-tokens.md`.
4. Validate in the 4 waves (bun build/test/lint; both DB dialects; Share-to-CMS re-import dedup; publish/preview; SSO).

## Rollback reality (corrected)
`backup/siteagent-v1` (pushed) + tag `siteagent-v1` restore the app tree cleanly. **But** the 3 new migrations advance the DB schema — 0.0.7 code will not understand the new columns/tables, so an app-only rollback after migrating is NOT safe against a migrated DB. Pre-release mitigation: local DBs are disposable → rollback = restore tree **and** drop/re-create the dev DB. (No production data exists to lose.)

---

## HARD STOP
This is the end of the read-only phase. **No merge, no edits to `Instatic/` source, nothing pushed to the working branch beyond this report.** Awaiting explicit go-ahead before starting the merge (Phase 2).
