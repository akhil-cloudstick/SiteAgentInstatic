# Instatic Upgrade Runbook — safely adopt any future upstream release

_Reusable, version-agnostic procedure for upgrading the vendored Instatic fork (`Instatic/`) to a newer
upstream release **without breaking the MMS custom logic, UI, or workflows**. Written from the real
0.0.7 → 0.0.14 upgrade (2026-07-31). Follow it for 0.0.14 → next, and every release after._

> **Companion docs**
> - `docs/upgrades/instatic-version-comparison.md` — human summary of what each release changed (regenerate per upgrade).
> - `docs/upgrades/instatic-0.0.14-upgrade-report.md` — the **customization ledger** (what's MMS-owned + the conflict map). Update/clone it each upgrade; it's the single most useful artifact.

---

## 0. The mental model (read first)

- **Instatic here is a vendored fork with NO git lineage to upstream.** Upstream = `github.com/CoreBunch/Instatic` (public; release tags `vX.Y.Z`). Our repo = the `akhil-cloudstick/SiteAgentInstatic` monorepo. So you can't `git pull` upstream — you do a **manual 3-way merge** driven from freshly-cloned upstream tags.
- **Upstream changes are mostly additive** (security fixes, features, UI redesigns). The MMS layer is a mix of **net-new isolated files** (low risk) and **edits woven into upstream files** (the real conflict surface).
- **The golden per-conflict rule:**
  | Change type | Resolution |
  |---|---|
  | Security / DB / save / publisher-output / correctness | **take UPSTREAM** |
  | Branding / product name / colours / icons / typography | **keep MMS** |
  | Importer / publisher / SSO / deploy **contract** | adopt upstream **fixes**, preserve MMS **behaviour** |
  | A file both sides changed | **COMBINE** — upstream's new structure + MMS feature re-applied on top |
  Never resolve a whole directory "ours"/"theirs".

---

## 1. Preflight (read-only — decide before touching anything)

1. **Confirm upstream + tags reachable:** `git ls-remote --tags https://github.com/CoreBunch/Instatic.git`. Note current pin (`Instatic/package.json` "version") and target tag.
2. **Regenerate the delta:** clone upstream, `git diff vCURRENT vTARGET --stat` and `--name-only`. Update `docs/upgrades/instatic-version-comparison.md`.
3. **Refresh the customization ledger:** open `docs/upgrades/instatic-0.0.14-upgrade-report.md`. For each MMS-owned file, re-verify it still exists and still diverges. Intersect the ledger with the upstream `--name-only` diff → mark each customization **SAFE** (upstream didn't touch the file), **RE-APPLY** (both changed, additive), or **CONFLICT** (both changed same lines).
4. **Flag the landmines explicitly** (these bit us at 0.0.14 — check every time):
   - **New DB migrations?** `diff` the migration files, list new IDs. → see §4.
   - **Dependency changes?** `diff` `package.json` dependencies. (0.0.14: only `sharp` bumped.)
   - **Breaking behavioural changes** (0.0.14: MCP static-token → OAuth). Check nothing MMS/Operator depends on the old behaviour.
   - **A sanitizer/util signature change** that MMS callers extend (0.0.14: `safeUrl`/`isSafeUrl` lost the MMS `allowDataImages` option). → §6.
5. **STOP and review the report** with the team before merging. This is the "no surprises" gate.

---

## 2. Backup (never skip)

```sh
cd s:/SiteAgentHub
git status -sb                       # inspect; commit the current MMS working state
git add -A && git commit -m "chore: snapshot MMS baseline before Instatic vTARGET upgrade"
git branch backup/siteagent-vN       # bump N each upgrade
git push -u origin backup/siteagent-vN
git tag siteagent-vN
git checkout -b instatic-vTARGET      # e.g. instatic-0.0.15   (NO codex/claude branch prefixes)
```
The backup branch (pushed) + tag is your one-command rollback. `master` is protected — never push to it directly; finish via PR.

---

## 3. The 3-way merge (in a throwaway scratch repo, not your real tree)

Because the fork has no common ancestor with upstream, merge where git can find one, then copy the result back. Use `git archive` so `node_modules`/builds never enter the merge.

```sh
SCRATCH=<a temp dir on a LOCAL C: drive, NOT the UNC share>
git clone --quiet https://github.com/CoreBunch/Instatic.git "$SCRATCH/upstream"
MW="$SCRATCH/merge-work"; rm -rf "$MW"; mkdir -p "$MW"; cd "$MW"
git init -q; git config user.email m@l; git config user.name m; git config core.autocrlf false

# base = clean vCURRENT
git -C "$SCRATCH/upstream" archive vCURRENT | tar -x --exclude='AGENTS.md'   # AGENTS.md is a symlink; Windows tar chokes on it
git add -A && git commit -qm "base vCURRENT"; git branch base
# theirs = clean vTARGET
git checkout -qb theirs; git rm -rq .
git -C "$SCRATCH/upstream" archive vTARGET | tar -x --exclude='AGENTS.md'
git add -A && git commit -qm "theirs vTARGET"
# ours = current MMS tree (from the monorepo Instatic subtree)
git checkout -q base; git checkout -qb ours; git rm -rq .
git -C s:/SiteAgentHub archive HEAD:Instatic | tar -x --exclude='AGENTS.md'
git add -A && git commit -qm "ours MMS"
# 3-way merge (base is the real ancestor -> conflicts only where BOTH edited the same lines)
git merge theirs --no-edit
git diff --name-only --diff-filter=U    # the conflict list
```

Resolve each conflict by the golden rule (§0). Tips from the 0.0.14 run:
- Many "woven" files **auto-merge cleanly** (non-overlapping hunks) — but **verify MMS intent survived** (grep the merged file for your customization markers; don't trust a clean auto-merge blindly).
- For large/semantic conflicts, resolving in parallel (one worker per area: AI/agent, MCP/publisher, theme/CSS, import) is effective. Give each the golden rule + the MMS conventions (tokens `--bg-*`/`--text-*` never `--editor-*`; product name via `BRAND_NAME`; single light theme).
- Confirm **zero markers** remain: `grep -rlE '^(<<<<<<<|=======|>>>>>>>)' .`

When clean: `git add -A && git commit`, then copy the merged tree into the real repo:
```sh
cd s:/SiteAgentHub
git ls-files -z Instatic/ | xargs -0 rm -f          # remove tracked files (node_modules etc. stay)
git -C "$MW" archive --format=tar HEAD | tar -x -C s:/SiteAgentHub/Instatic
# bump Instatic/package.json version + CHANGELOG
```

---

## 4. Migrations — THE critical rule (gets existing tenant DBs wrong if ignored)

The runner (`server/db/runMigrations.ts`) tracks **per-ID** in `schema_migrations` (`select id ... where id = ?`). Existing tenant **Postgres** DBs already recorded the MMS migrations under their **original IDs**.

**RULE: MMS migrations KEEP their original IDs. Renumber UPSTREAM's new migrations to sit AFTER the highest existing ID.**

Why: a renumbered *MMS* migration = a new ID → the runner re-runs its `ADD COLUMN` → **fails on existing DBs** (column already exists) → tenant won't boot. Keeping MMS IDs means existing DBs **skip** them (already applied) and only apply upstream's genuinely-new ones. No re-run, no data loss, no DB drop.

Example (0.0.14): MMS kept `019_ai_message_model_id` / `020_media_content_hash`; upstream's three became `021_mcp_connector_token_expiry` / `022_site_sync_sequence` / `023_mcp_oauth`.

- Apply the numbering **identically in `migrations-pg.ts` AND `migrations-sqlite.ts`** (gated by `migration-parity.test.ts`).
- Grep that no code references an old MMS ID as a string (there shouldn't be any).
- Fresh DBs are unaffected (all apply in array order regardless of numeric order).

---

## 5. Re-apply the woven MMS seams (the protected core)

**Isolated net-new files (carry over untouched — verify present):** `src/core/brand.ts`, `server/auth/tenantSso.ts`, `server/handlers/cms/sso.ts`, `server/handlers/cms/importSiteHtml.ts`, `server/handlers/cms/siteImport/stagedImports.ts`, `src/admin/pages/site/hooks/useStagedSiteImportHandoff.ts`, `src/core/siteImport/globalSections.ts`, `src/styles/remixicon/**`, `src/ui/components/RemixIcon/**`, `vendor/pixel-art-icons/**`.

**Woven edits to re-apply / verify after merge:**
- **Router:** `server/handlers/cms/index.ts` — re-insert the SSO + staged-import `?? (await handle…)` links + imports.
- **Import engine:** `siteImport/{commitPlan,globalSections,adapter,linkRewrite,conflicts}.ts` (everywhere-template promotion, `upsertEverywhereTemplate`, `forceOverwriteResolutions`), `htmlImport/{rules,text}.ts` (MMS text/button on top of upstream video/SVG import), `SiteImportModal.tsx`, `store/slices/site/helpers.ts`, `createSiteImportAdapter.ts`, `mediaUpload.ts` (content-hash dedup).
- **AI managed mode:** `server/ai/managed.ts`, `server/ai/handlers/chat.ts` (per-category `classifyCategory` → `buildSystemPromptForScope` → `managedRouting` → `resolveModelId`), `AuditTab.tsx` brand label. Re-apply managed-mode **on top of** upstream's AI-runtime rewrite.
- **Brand/theme:** `index.html` (MMS title/loader/favicon), `src/admin/main.tsx` (globals + remixicon imports), `src/styles/globals.css` (MMS cream **light** values on the shared token names — vocabulary matches upstream, so it's value-merge not rename), Button/Switch CSS (green tokens).
- **Sanitizer:** `src/core/html-sanitize/index.ts` — keep the MMS `allowDataImages` option on `isSafeUrl`/`safeUrl` (layered on upstream's allowlist).

**The 4 core workflows to protect + smoke-test every upgrade:** ① OD → Share-to-CMS import (staged token: `nanoid(32)`, 5-min TTL, same-user, single-use; reuses `buildImportPlan`/`commitImportPlan`; everywhere-template; re-share dedup). ② Manual + AI-chat editing. ③ AI managed mode (operator model from DB Settings; per-category routing). ④ Publish → `INSTATIC_DEPLOY_WEBHOOK` deploy → live URL.

---

## 6. Fix cross-file breaks — let `tsc` find them

After copy-back, run `cd Instatic && bunx tsc -b`. The type errors are your to-do list. Recurring classes (seen at 0.0.14):
- **A MMS feature spanning files** where upstream changed the shared helper's signature → re-add the MMS option/param to the merged helper (e.g. `allowDataImages` on `isSafeUrl`/`safeUrl`). **Combine, don't drop the feature.**
- **Orphaned MMS files** superseded by an upstream redesign (e.g. old agent image-attachment `attachments.ts`/`AttachMenu.tsx`) → delete them.
- **New required fields** on an upstream type that an MMS constructor must now provide (e.g. `toolResultImages` on `AiProviderCapabilities`) → add the field.

---

## 7. Verify

```sh
cd Instatic
bunx tsc -b            # 0 errors
bunx vite build        # bundle builds
# targeted architecture gates (full `bun test` TIMES OUT on the UNC share — run key gates w/ high timeout):
bun test --timeout 180000 src/__tests__/architecture/{migration-parity,css-token-vocabulary,css-token-policy,no-third-party-icons,no-css-var-fallbacks}.test.ts
bunx eslint <files you hand-edited>
```
- Boot **both** DB dialects (SQLite default + `DATABASE_URL=postgres://…`).
- **Manual E2E** of the 4 core workflows (§5) via your normal `npm run dev` in `Operator/` (control-plane spawns each tenant's `bun server/index.ts`).
- Full `bun test` + full lint belong on a **non-UNC CI host** — they time out locally.

---

## 8. Commit, push, PR

- **Exclude build artifacts.** `git add -A Instatic/` can sweep in `dist_new/` — confirm `.gitignore` covers `dist`, `dist_new`, `dist-ssr`. Check the staged file count is sane (0.0.14 was ~845, not ~1100).
- Commit on `instatic-vTARGET`, push the branch, open a **draft PR → master** (master is protected; draft by default). Don't merge until reviewed.

---

## 9. Rollback

`git checkout backup/siteagent-vN` (or `git reset --hard <baseline commit>`). **Caveat:** new upstream migrations advance the schema — an app-only rollback isn't safe against an already-migrated DB. Pre-release/dev DBs are disposable (drop + re-migrate). For real tenant data, restore a DB backup taken **before** the upgrade.

---

## 10. Environment gotchas (this repo specifically)

- **UNC / mapped `s:` drive:** `bun` works; `pnpm`/`vitest` fail; `bun install` can EINVAL on the lockfile rename; `du`/full-`bun test` time out. Do the scratch merge on a **local C: dir**. The build runs fine on the existing `node_modules` if deps didn't change (only reinstall when they did).
- **`AGENTS.md` is a symlink → CLAUDE.md** — `tar --exclude='AGENTS.md'` on Windows extracts.
- **`dist_new/` is the LIVE frontend** tenants serve from (`Operator/.../tenantRuntime.mjs` `distDir()` points there during the `dist` incident recovery). After a **source** upgrade the tenant **server** is new but the **admin UI** is still the old build — **rebuild the frontend** into the served dir (`dist`/`dist_new`) to actually ship the new admin. Never commit `dist*`.
- **CRLF warnings** ("LF will be replaced by CRLF") on `git add` are harmless on Windows.

---

## 11. Future-proofing

- After each successful upgrade, record the **clean upstream tree** on a `vendor/instatic-upstream` branch/tag in this repo — then the *next* upgrade can be a real `git merge` with a known base instead of the scratch-repo dance.
- Keep the **customization ledger** (`docs/upgrades/instatic-<version>-upgrade-report.md`) current — clone it per upgrade and re-verify every entry. It's the memory that makes each upgrade cheaper than the last.
