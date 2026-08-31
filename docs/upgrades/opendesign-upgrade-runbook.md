# OpenDesign Upgrade Runbook — safely adopt any future upstream release

_Reusable, version-agnostic procedure for upgrading the vendored OpenDesign fork (`OpenDesign/`) to a
newer upstream release **without breaking the MMS/SiteAgent customizations, theme, or workflows**.
Written from the real **v0.14.0 → v0.16.1** upgrade (2026-08-03). Follow it for
0.16.1 → next, and every release after._

> **Companion docs**
> - `docs/upgrades/opendesign-0.16.1-upgrade-report.md` — the **customization ledger** (what's MMS-owned + how each conflict was resolved). Clone and re-verify it each upgrade; it's the single most useful artifact.
> - `docs/upgrades/opendesign-version-comparison.md` — human summary of what each release changed (regenerate per upgrade).
> - `docs/upgrades/instatic-upgrade-runbook.md` — the sibling procedure for the CMS. Same golden rule, different repo shape.

---

## 0. The mental model (read first)

- **OpenDesign here is a vendored fork with NO git lineage to upstream.** Upstream =
  `github.com/nexu-io/open-design` (public; release tags `open-design-vX.Y.Z`). Our repo = the
  `akhil-cloudstick/SiteAgentInstatic` monorepo. You cannot `git pull` upstream — you do a **manual
  3-way merge** driven from a freshly-cloned upstream, in a scratch repo on **local C:**.
- **It is a multi-app desktop monorepo** (`apps/{daemon,web,desktop,packaged,landing-page,telemetry-worker}`,
  ~15 `packages/*`, plus `skills/`, `design-systems/`, `plugins/`, `e2e/`). ~10,800 tracked files.
  SiteAgentHub only *runs* `apps/daemon` + `apps/web`, but we merge the **whole** tree so the
  vendored copy stays a coherent upstream release.
- **The golden per-conflict rule:**
  | Change type | Resolution |
  |---|---|
  | Upstream security / reliability / runtime / model providers / export | **take UPSTREAM** |
  | Branding, product name, `tokens.css` palette, MMS copy | **keep OURS** |
  | Share-to-CMS, tenant SSO, gateway base-path, capture proxy, annotate/edit-mode | **keep OURS**, re-applied onto upstream's new structure |
  | Build/runtime contract (`.npmrc`, `pnpm-workspace.yaml`, `next.config.ts`, `bin/od.mjs`) | **keep OURS**, adopt upstream fixes inside it |
  | A file both sides changed | **COMBINE** — never pick a whole side, never resolve a directory |

---

## 1. Pin the REAL baseline — do NOT trust `package.json` (this is the big one)

**Upstream's `package.json` version field lags its release tags by 1–3 releases.** At tag
`open-design-v0.13.0` upstream's `package.json` reads `0.12.1`; at `v0.16.1` it reads `0.15.1`.
Our vendored copy inherits that stale number, and `README.md` advertises yet another version.
Believing any of them puts the merge base several releases too early and multiplies conflicts.

**Pin it empirically instead** — clone upstream, then sweep the tags:

```sh
git clone https://github.com/nexu-io/open-design.git /c/od-upgrade/upstream
# scratch repo whose 'ours' branch holds our vendored tree (see §3 for construction)
for t in $(git tag -l 'open-design-v0.1*' | sort -V); do
  printf '%-28s ' "$t"; git diff --shortstat "$t" ours | sed 's/^ //'
done
```

The tag with the **fewest changed files** is the baseline neighbourhood. Then narrow to the exact
commit by sweeping the commit range to the next tag — this is worth the few minutes it costs:

```sh
for c in $(git rev-list --reverse open-design-vBASE..open-design-vNEXT); do
  echo "$(git diff --name-only "$c" ours | wc -l) $c"
done | sort -n | head -5
```

At the 2026-08-03 upgrade this corrected the version from the assumed **v0.13.0** (1,027-file delta)
to the actual **v0.14.0** (196), and the commit sweep tightened it further to a **131-file delta** —
cutting the merge from an unusable mess to **14 conflicts**. Confirm your chosen base is an ancestor
of the target: `git merge-base --is-ancestor <base> <target>`.

_(The commit sweep is a merge-mechanics optimisation only — it does not change which **version** you
are on. If you prefer, merge straight from the release tag; you just resolve more conflicts.)_

**Sanity-check with feature probes** too — presence/absence of release-marker files
(`apps/daemon/src/agent-session-resume.ts`, `deck-export.ts`, `apps/web/src/components/MessageCenter.tsx`)
tells you which releases are already in the tree.

---

## 2. Freeze the tree (the only git write)

The user's standing rule is **no git state changes**. The one exception, and only with explicit
say-so, is committing the *current* in-flight work first so the upgrade diff is reviewable on its own:

```sh
cd s:/SiteAgentHub
git status --porcelain          # inspect; path-scope the add if anything is outside the target area
git commit -m "chore: snapshot ... before OpenDesign vTARGET upgrade" && git push origin <branch>
```

Then take a **filesystem** rollback point (no branches, no tags):

```powershell
robocopy "S:\SiteAgentHub\OpenDesign" "C:\od-upgrade\backup-od-<version>" /MIR `
  /XD node_modules node_modules.old_delete .next dist out data .task /XF *.log /NFL /NDL /NJH /NP
```
(robocopy exit code 1 means "files copied" — that is success, not an error.)

**After the merge lands: no further commits, no pushes.** The user reviews the diff.

---

## 3. The 3-way merge (scratch repo on local C:, never the UNC share)

Because the fork has no common ancestor with upstream, manufacture one by branching **from the real
upstream commit** pinned in §1 — this gives genuine ancestry, so `git merge` computes a true merge base.

```sh
# Export our tree with EOL conversion OFF. This is mandatory: core.autocrlf=true is set in
# both repos, and `git archive` would emit CRLF, making every text file look 100% changed.
cd s:/SiteAgentHub
git -c core.autocrlf=false archive --format=tar HEAD:OpenDesign -o /c/od-upgrade/archives/ours.tar

MW=/c/od-upgrade/merge-work; rm -rf "$MW"; mkdir -p "$MW"; cd "$MW"
git init -q
git config core.autocrlf false      # keep LF; must match the upstream object store
git config core.symlinks false      # AGENTS.md is a symlink; Windows can't create it
git config core.longpaths true
git remote add up /c/od-upgrade/upstream && git fetch -q up --tags

git checkout -q -b ours <PINNED_BASE_COMMIT>
find . -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} +
tar -xf /c/od-upgrade/archives/ours.tar
git add -A -f && git commit -qm "ours: MMS/SiteAgent OpenDesign (vendored from <PINNED_BASE_COMMIT>)"

git diff --shortstat <PINNED_BASE_COMMIT> ours      # <- THE CUSTOMIZATION LEDGER
git merge open-design-vTARGET --no-edit
git diff --name-only --diff-filter=U                 # <- the conflict list
```

**Gotchas that will bite you:**
- `git add -q` is not a flag (`git add` has no `-q`); use plain `git add -A -f`.
- `-f` on `git add` matters — the extracted `.gitignore` would otherwise skip tracked files.
- Windows has no `python`; use `node -e` / a `.mjs` script for text surgery. Beware quoting: write a
  script file rather than embedding single-quoted JS in a bash `-e` string.

---

## 4. Resolve conflicts by the golden rule

Most conflicts are **additive on both sides** (upstream appended fields to the same options object we
appended to) — those simply combine. A small helper makes the mechanical ones safe:

```js
// resolve.js <file> <ours|theirs|both> [rename]
s = s.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> [^\n]*\r?\n/g,
  (m, ours, theirs) => side === 'ours' ? ours : side === 'theirs' ? theirs : ours.replace(/\s*$/,'\n') + theirs);
if (rename) s = s.replace(/Open Design Cloud/g, 'MMS Design').replace(/Open Design/g, 'MMS Design');
```

**Judgement conflicts get resolved by hand**, never by the helper. Then:

- **Prove the branding transform before applying it.** Before assuming "our change is just a rename",
  test it: apply the rename to the BASE file and diff against OURS. Anything left over is genuine MMS
  copy you must re-apply by hand. (At 0.16.1 this exposed 12 real copy overrides in `en.ts` —
  `app.brandPill`, `homeHero.subtitlePrefix`, the GitHub→URL import language, etc. — that a blind
  `sed` would have destroyed. It also showed the rename must not touch phrases like
  "**Open** the **Design** Systems panel".)
- **Re-scan for product-name regressions after merging.** Upstream keeps adding new UI strings:
  `grep -rn "Open Design" apps/web/src/components apps/web/app`. Rebrand tenant-visible display text;
  leave identifiers, GitHub action names ("Open Design PR"), and code comments alone.
- **Verify zero markers remain:** `grep -rlE '^(<<<<<<<|=======|>>>>>>>)' --exclude-dir=.git .`

### Watch for upstream shipping a validation-only default

v0.16.1 shipped `promptCoreVariant: process.env.OD_PROMPT_CORE === 'classic' ? undefined : 'slim'`
with upstream's own comment saying *"main keeps classic as the default — do NOT carry this flip into a
PR against main"*. Adopting it blindly silently swaps the whole system-prompt core. **Read the
comments in conflicting upstream hunks** — when upstream flags its own code as validation-only, adopt
the plumbing and keep our default. Grep each release for new `process.env.OD_*` defaults.

---

## 5. Prove the merge did not lose anything (do this every time)

```sh
# 1. The merged tree must equal upstream + exactly our layer:
git diff --shortstat open-design-vTARGET HEAD

# 2. NOTHING may have silently reverted to stock. Both lists must be the same size,
#    and the comm output must be EMPTY:
git diff --name-only <PINNED_BASE> HEAD^1        | sort > /tmp/before.txt
git diff --name-only open-design-vTARGET HEAD    | sort > /tmp/after.txt
comm -23 /tmp/before.txt /tmp/after.txt          # files customized before but stock now = LOST WORK
```

Note `git merge` advances the branch, so the pre-merge tree is `HEAD^1`, not the branch name.

---

## 6. Protected core — verify present + behaviourally intact

**Net-new MMS files (must exist; expect zero conflicts):**
`.npmrc`, `apps/daemon/src/{cms-compliance,cms-consistency,cms-image-materialize,cms-normalize,od-share-to-cms,tenant-sso}.ts`,
`apps/daemon/src/prompts/cms-contract.ts`, `apps/daemon/src/routes/capture-proxy.ts`,
`apps/daemon/tests/cms-*.test.ts`,
`apps/web/app/{gateway-basepath-shim.ts,client-providers.tsx,client-providers-inner.tsx,not-found.tsx}`,
`apps/web/app/[[...slug]]/client-shell.tsx`, `apps/web/src/styles/mms-overrides.css`,
`apps/web/public/{mms-horizontal.png,favicon*,site.webmanifest}`, `start-/stop-open-design.{cmd,sh}`.

**Woven seams to re-verify by grep after every merge:**

| Seam | Check |
|---|---|
| CMS output contract | `instaticCmsMode` + `cmsRuleBody` in `prompts/system.ts`; `renderCmsOutputContract` still pushed **late** and **not gated** on the slim/classic core |
| Compliance gate | `onRunSucceeded` hook in `runtimes/runs.ts` + its wiring in `server.ts` |
| Share-to-CMS | `/api/projects/:id/push/instatic` route; `pushProjectToCms` / `CmsBlockedDialog` / `buildFixInstruction` in `FileViewer.tsx` |
| Tenant SSO | `app.get('/sso')` + `tenantSsoEnabled()` whole-surface gate in `server.ts` |
| Mandatory tenant brand | `instaticTenantMode` design-system fallback in `server.ts` (keep upstream's Web Clone exemption) |
| Gateway base path | `OD_WEB_BASE_PATH`/`basePath` + `/sso` rewrite in `next.config.ts`; `stripBase`/`withBase` in `router.ts`; `withGatewayBasePath` in `providers/registry.ts` |
| Preview assets | `mapPublicRootAssets` + `injectAssetRewriteBridge` at the head of the `srcdoc.ts` chain; `materializeImages` in `routes/project/index.ts` |
| Annotate/screenshot | `queryElementAtPoint`, `disableScreenshot`, `PreviewSnapshotResult` retry semantics in `PreviewDrawOverlay.tsx` / `FileViewer.tsx` |
| Theme | `tokens.css` MMS palette (`#f8f1df` cream, `#082a38` navy, Approval-Green) + `color-scheme: light` |

**The Operator contract (breaking any of these takes tenants down):**
- entrypoint `node apps/daemon/bin/od.mjs --port <n> --no-open`
- `OpenDesign/node_modules/next/dist/bin/next` must resolve from the **root** (hoisted linker)
- env: `OD_DATA_DIR, OD_PORT, OD_WEB_PORT, OD_ALLOWED_ORIGINS, OD_SSO_SECRET, OD_TENANT_SLUG,
  OD_GATEWAY_ORIGIN, OD_INSTATIC_URL, OD_CMS_RULE_FILE, OD_CMS_COMPLIANCE_MAX_ATTEMPTS,
  OD_WEB_BASE_PATH, OD_WEB_DIST_DIR`
- `next.config.ts` rewrites `/api`, `/artifacts`, `/frames`, **`/sso`** → daemon origin
- `Operator/rules/templateRule.md` lives OUTSIDE `OpenDesign/` (hot-reloaded via `OD_CMS_RULE_FILE`) —
  unaffected by the upgrade, but re-confirm the loader path still reads it.

---

## 7. Dependencies (SMB is the hazard — read all of this before installing)

`.npmrc` (`node-linker=hoisted`, `script-shell=…Git\usr\bin\bash.exe`) and `pnpm-workspace.yaml`
(`scriptShell:`) are **MMS-owned — never take upstream's**. pnpm's default symlink store does not work
on the `\\ZAISERVER\dev_projects` SMB share, and Operator resolves `next` from the root `node_modules`,
which only exists under a hoisted layout.

Install **in the scratch tree on C: first** (`pnpm install --no-frozen-lockfile`), confirm
`node_modules/next` exists, and only then reinstall on the share.

**STOP THE TENANT STACK BEFORE INSTALLING ON THE SHARE.** Operator's running daemons execute out of
this very tree, and a live `bin/od.mjs` holds `better-sqlite3`'s native module open, which pnpm
cannot replace over SMB:
```
ERR_PNPM_EPERM [importPackage …\node_modules\better-sqlite3] Permission denied
```
Check first: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*OpenDesign*' }`.

Two more SMB traps seen at 0.16.1:
- **Stale pnpm-store project markers.** `EPERM … rename '…/.pnpm-store/v10/projects/<hash>' -> '…/.ignored_<hash>'`
  happens when both the marker *and* its `.ignored_` twin exist as directory symlinks. Delete the
  `.ignored_<hash>` symlink and re-run.
- **`node ./scripts/postinstall.mjs` fails on the share** with `spawnSync pnpm.cmd EINVAL` (the UNC
  cwd problem). It cannot build the workspace packages there.

**Under `node-linker=hoisted`, `node_modules/@open-design/*` are real COPIES, not symlinks.** So a
source upgrade does *not* reach them: the daemon will fail to compile with
`Module '"@open-design/contracts"' has no exported member …` until those copies are refreshed.
If a clean install is not possible yet, sync them from the built tree:

```powershell
# 1. build outputs (packages/*/dist, apps/*/dist) from the VERIFIED local merge tree
# 2. then refresh each workspace copy inside node_modules
foreach ($d in (Get-ChildItem "$root\node_modules\@open-design" -Directory)) {
  $src = "$root\packages\$($d.Name)"; if (-not (Test-Path $src)) { $src = "$root\apps\$($d.Name)" }
  if (Test-Path $src) { robocopy $src $d.FullName /MIR /XD node_modules .next out .turbo /NFL /NDL /NJH /NJS /NP }
}
# tools-dev/pack/release/serve map to tools\dev|pack|release|serve
```
That makes the tree **runnable**, but it is not a substitute for the real install — `node_modules/.modules.yaml`
stays absent and `tsc` from source on the share will emit spurious `TS7006 implicitly has an 'any' type`
errors that do not occur on local disk. Finish with a proper `pnpm install` once the stack is down.

---

## 8. Build + verify

```sh
cd /c/od-upgrade/merge-work
pnpm install --no-frozen-lockfile
pnpm --filter @open-design/daemon build     # REQUIRED: bin/od.mjs loads dist/cli.js and
                                            # throws if it is missing. Stale dist = old daemon.
pnpm typecheck                              # upstream's own gate
pnpm guard                                  # style policy, product neutrality, import isolation, …
node --import tsx --test apps/daemon/tests/cms-*.test.ts
node apps/daemon/bin/od.mjs --port <free> --no-open    # boots?
```

Then hand the user the 5 workflows to eyeball after their rebuild: ① tenant SSO into OD via the hub,
② gateway serving OD at `/od/<slug>`, ③ design run → **Share to CMS** → Instatic import (compliance +
`templateRule` + re-share updates instead of duplicating), ④ annotate/screenshot/manual-edit overlay,
⑤ MMS theme unchanged.

---

## 9. Land it

```powershell
robocopy "C:\od-upgrade\merge-work" "S:\SiteAgentHub\OpenDesign" /MIR `
  /XD .git node_modules .next out dist data .task /XF *.log /NFL /NDL /NJH /NP
```
`/MIR` so upstream's **deletions and renames** land too. Exclude `.git` or you will nuke the monorepo's
repository metadata layout, and enumerate every live `.next-prod-<slug>-*` / `.next-<slug>` build dir
in `/XD` — those are what Operator's `next start` is serving.

> ### ⚠️ `/MIR` deletes GITIGNORED files the runtime needs
> The merged tree only contains **tracked** files, so `/MIR` removes anything in the destination that
> git ignores but the stack depends on. This bit us at 0.16.1: `apps/web/tsconfig.build.json` (a
> two-line `{"extends": "./tsconfig.json"}` shim, gitignored, **never auto-generated**) is passed by
> `odRuntime.mjs` as `OD_WEB_TSCONFIG_PATH` — deleting it made every tenant web build fail with:
> ```
> ./apps/web/tsconfig.build.json — An issue occurred while parsing a tsconfig.json file. tsconfig not found
> ```
> **Before landing, inventory the destination's ignored-but-required files** and restore them after:
> ```sh
> git -C s:/SiteAgentHub ls-files --others --ignored --exclude-standard OpenDesign/ \
>   | grep -vE 'node_modules|\.next|/dist/|/out/|\.log$'
> ```
> Anything that survives that filter is config, not build output — copy it back from the backup.

Then on the share: reinstall deps, rebuild the daemon dist, set `OpenDesign/package.json` `version` to
the **tag** version explicitly (ending upstream's lag), and record the tag in `CHANGELOG.md`.

**Then rebuild the OD web — this is the OD analog of Instatic's "rebuild `dist`".**
Operator serves a pre-built `.next-prod-shared-<ms>`; a source upgrade does not touch it, so without
this you are still looking at the pre-upgrade UI:
```sh
cd s:/SiteAgentHub                                # repo root, NOT OpenDesign/
node Operator/scripts/build-od-web.mjs --force    # ONE build for ALL tenants
```
**One build, not one per tenant.** Since 2026-08-04 the bundle's Next basePath is a fixed,
tenant-agnostic `/design` and the gateway resolves the tenant from the hub session cookie — see
`docs/opendesign/opendesign-shared-web-build.md`. `--force` is required after a source upgrade; without it the
script skips when any shared build already exists.

A failed build leaves a versioned dir with no `BUILD_ID`; `newestBuildDir()` ignores those, so the
previous good build keeps serving. Delete the dud before retrying. Build errors go to
`%TEMP%\siteagent-od\_shared-web\web.log`, not to stdout.

**Stop there. No commit, no push.**

---

## 10. Rollback

`robocopy C:\od-upgrade\backup-od-<version> S:\SiteAgentHub\OpenDesign /MIR` (plus a dependency
reinstall and daemon rebuild), or `git checkout -- OpenDesign/` since nothing was committed after §2.
OpenDesign keeps all state in per-tenant `OD_DATA_DIR`s **outside** the repo, so — unlike Instatic —
there is **no schema-migration hazard** and an app-only rollback is safe.

---

## 11. Future-proofing

- Record the **clean upstream tree** for the version you just adopted on a `vendor/opendesign-upstream`
  branch/tag in this repo. Then the *next* upgrade is a real `git merge` with a known base, and §1's
  baseline hunt disappears entirely. **This is the single highest-value follow-up.**
- Keep the ledger (`docs/upgrades/opendesign-<version>-upgrade-report.md`) current — clone it per upgrade and
  re-verify every row.
- Each upgrade, re-check: new `process.env.OD_*` defaults, new hardcoded product-name strings, and
  whether `.npmrc`/`pnpm-workspace.yaml` drifted toward upstream.
