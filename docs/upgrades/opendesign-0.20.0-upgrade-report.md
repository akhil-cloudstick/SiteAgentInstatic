# OpenDesign vendored upgrade — `open-design-v0.16.1` → `open-design-v0.20.0`

Executed 2026-08-20. Absorbs 7 upstream releases (0.17.0, 0.18.0, 0.18.1, 0.19.0,
0.19.1, 0.19.2, 0.20.0). Landed by `robocopy /MIR`, **not committed** — the user
reviews the diff.

## Headline

| | |
|---|---|
| Upstream delta | 2,651 files, +478,474 / −55,204 |
| Merge conflicts | **119** (23 delete-vs-modify, 96 content) |
| MMS layer | **361 files before → 361 after, 0 lost** |
| Daemon typecheck | **0 errors** |
| Web app | rebuilt as upstream pages + MMS skin — see "The web app" below |
| CMS compliance tests | **63 pass** |
| `pnpm guard` | **30 checks pass, exit 0** |
| Shared web build | **✓ compiled, BUILD_ID + required-server-files.json present** |

> ⚠️ **Baseline warning.** An early run of this upgrade reported "web typecheck:
> 0 new errors". That was **wrong**: the comparison branch (`ours`) had been
> advanced by the merge commit itself, so the "pre-merge" worktree was actually
> merged code. Always take a baseline from the merge's **first parent**
> (`git rev-parse <merge>^1`), never from the branch you merged into. The same
> mistake hides real breakage — it masked genuine JSX/`const` damage that only
> surfaced when Turbopack refused to build.

## ⚠️ The merge-base trap (new, and the most important lesson)

`open-design-v0.16.1` is **NOT an ancestor of `v0.20.0`** — it is a release-branch
tag carrying 32 commits that never reached main. Git therefore picked
`bbb216783` as the merge base, which is *older* than our fork point, and
attributed **144 files** of upstream's own work to us. That inflated the conflict
set to 166 and produced bogus `AA`/`UD` states.

Fix — reparent the target onto our real fork point, then merge that:

```sh
THEIRS_TREE=$(git rev-parse 'open-design-v0.20.0^{tree}')
REPARENTED=$(git commit-tree "$THEIRS_TREE" -p open-design-v0.16.1 -m 'reparented')
git merge "$REPARENTED"      # merge base is now exactly v0.16.1
```

Conflicts fell 166 → 119 and the spurious states disappeared. **Check
`git merge-base --is-ancestor <base-tag> <target-tag>` before every OD merge.**

Second trap: `git archive HEAD:OpenDesign | tar -x --exclude='AGENTS.md'` (the old
runbook line) silently drops **17 real tracked files** — `AGENTS.md` is a regular
file in this repo, not a symlink. That created phantom deletions and corrupted the
ledger (72 D instead of 56). Do not exclude it.

## Resolution decisions worth keeping

| Area | Decision |
|---|---|
| `runtimes/registry.ts` | keep OURS — `BASE_AGENT_DEFS = [byokOpenCodeAgentDef]`. Upstream re-adds 21 CLI defs incl. **DeepSeek Harness** (0.19.1); all stay unregistered. |
| `defs/deepseek-harness.ts` | **kept on disk, unregistered.** 8 upstream modules import it directly (`agent-companion-setup`, `cli`, `routes/daemon`, `runtimes/auth`…), same rule as `amr`/`antigravity`/`codex`. Invisible because it is not in `AGENT_DEFS`. |
| AvatarMenu / InlineModelSwitcher / AgentPicker | stay deleted (23 delete-vs-modify conflicts resolved as "keep deleted") |
| `server.ts` | COMBINE — MMS tenant-SSO block kept, upstream's `STATIC_DIR`→`staticDir` rename adopted; CMS vars feed upstream's new hoisted `systemPromptInputs`; **`promptCoreVariant` classic default preserved**. |
| `loadPluginRegistryView` | upstream added workspace scoping, MMS added an SMB read-cache. Kept BOTH: cache serves the unscoped view, a workspace-scoped request bypasses it. |
| `routes/runs.ts` | upstream's project-authorization guard runs first, then the MMS managed-AI override, then validation on the managed-resolved `meta`. Upstream's new `withoutSensitiveRunInput()` + `workspaceScope` adopted as the base object. |
| `static-resource.ts` / `plugins/index.ts` | took upstream's workspace scoping, re-applied `cachedRead` with a workspace-scoped key. |
| `projects.ts` | MMS text normalisation kept for HTML/CSS; upstream's `createLazyArchiveFileStream` adopted for binaries. |
| i18n (19 locales) | **key-level merge**, not side-picking: every MMS string kept, **863 new upstream keys appended per locale** with the MMS rebrand applied. A blind `theirs` silently dropped MMS-only keys (`projects.*`, `settings.appearance*`). |
| CSS/theme (13 files) | "keep ours unless our side is empty" — MMS palette/geometry preserved, upstream's genuinely-new rules (e.g. `.design-card-menu`) adopted. |
| `packages/mms-shell` peerDeps | pinned to exact `18.3.1` — upstream's guard now rejects `>=18`. |
| `package.json` version | set to the **tag** value `0.20.0` (upstream's own field lags; it reads `0.19.2`). |

## New protected surfaces (add to runbook §6)

`apps/daemon/src/managed-ai.ts` · `packages/mms-shell/**` + its four wiring points
(`apps/web/next.config.ts` transpilePackages, `apps/web/tsconfig.json` paths,
`apps/web/src/index.css`, `apps/web/src/styles/tokens.css` which now *aliases*
`@mms/shell/styles/tokens.css`) · `apps/web/src/utils/visibleAgents.ts` · the
`*Screen` component families · env `OD_MANAGED_AI`, `OD_AI_GATEWAY_URL`,
`NEXT_PUBLIC_OD_MANAGED_AI`.

## Post-merge repairs

- `runs.ts` — duplicate `meta` declaration (upstream rebuilt it below our block).
- `design-systems/index.ts` — upstream's loop-body `continue` landed inside the MMS
  `Promise.all(map())` fan-out → `return null`; `teamSynced: true` widened to `boolean`
  for `exactOptionalPropertyTypes`.
- Per-hunk resolution on JSX-heavy components **splits tag pairs and `const`
  declarations** — it produced unterminated JSX in `ProjectView.tsx` and a
  `cannot reassign to a variable declared with const` in `state/projects.ts`.
  `tsc` reported these as ordinary errors, but Turbopack refuses to build on
  them. Resolve `.tsx` conflicts whole-file, never hunk-by-hunk.
- The i18n merger must be **quote-agnostic**: `zh-CN`/`zh-TW` quote their keys
  with double quotes, so a single-quote scan saw only 298 of 4,497 entries and
  re-appended keys that already existed (TS1117 duplicate property).

## Pre-existing failures (NOT upgrade regressions)

- `apps/landing-page` fails `astro check`.
- `packages/dsh-runtime` typecheck fails on a nested `commander@15` vs root
  `commander@11` typing clash under `node-linker=hoisted`. Upstream's new package.
- `getAgentDef('amr')` returns `null` (`integrations/vela.ts`, `amr-model-probe.ts`,
  `routes/vela.ts`) — `amr` is not in `AGENT_DEFS`.

---

## The web app: upstream pages + MMS skin (owner decision)

The MMS OpenDesign UI rework and upstream 0.17–0.20 turned out to be **mutually
exclusive**, and no merge resolution could satisfy both:

- upstream's `EntryShell.tsx` imports `DesignsTab`, `DesignSystemsTab`,
  `TasksView`, `ExtensionsMarketplace` and `InlineModelSwitcher` — every one of
  which the MMS rework had deleted and replaced with the `*Screen` family;
- the MMS web app does not compile against 0.20.0's packages (116 missing-export
  errors when restored wholesale).

**Resolution taken:** adopt upstream's pages, drop the MMS-only screens upstream
replaces, keep the MMS style and integration layer.

| Kept (MMS) | Dropped (upstream now owns) |
|---|---|
| tenant SSO + gateway basePath: `app/client-providers{,-inner}.tsx`, `app/gateway-basepath-shim.ts`, `app/not-found.tsx`, `app/[[...slug]]/client-shell.tsx` | `ProjectsScreen`, `PluginsScreen`, `DesignSystemsScreen`, `AutomationsScreen`, `IntegrationsScreen` + satellites |
| `state/managed.ts`, `state/hubContext.ts` (operator-managed AI) | `plugins-screen/**`, `integrations/**`, `automationTemplates.ts`, `LinkedProjectRow`, `projectStatus.ts` |
| theme layer: `tokens.css`, `primitives.css`, `index.css`, `mms-overrides.css`, `mms-shell-host.css`, `studio.css`, `app/layout.tsx` | — |
| light **and** dark themes (upstream 0.20.0 forces light-only; see below) | — |
| rebranded i18n: 4,497 MMS entries + 1,039 new upstream keys per locale, 0 duplicates | — |
| `visibleAgents` still hides `byok-opencode` (upstream kept the same rule) | — |

**Consequence to expect on `/design`:** Home, Projects, Plugins, Design Systems
and Automations now render upstream's layouts rather than the MMS `*Screen`
versions. Branding, palette, fonts and the two-row shell are unchanged.

### Theme regression avoided

Upstream 0.20.0 removed the theme setting entirely (`FORCED_APP_THEME = 'light'`)
and shipped a migration that rewrites every stored `dark`/`system` to light. The
MMS re-skin ships a full dark mirror, so:
`resolveAppTheme` now **validates** instead of coercing, the wipe migration is
disabled, and `applyAppearanceToDocument` takes `theme` again — the merged
signature had dropped it while the body still read it.

## Landing notes (SMB / hoisted-linker traps hit this run)

1. `/MIR` deletes gitignored-but-live files — `apps/web/tsconfig.build.json` **and**
   `apps/desktop/vendor/dom-to-pptx/dom-to-pptx.bundle.js` (3.8 MB). Inventory and
   restore both.
2. Two OD daemons (`node bin/od.mjs --port …`) survived the "stop the stack" sweep
   because their command line contains no repo path — filter on `od.mjs`, not on
   `SiteAgentHub`. They held `better-sqlite3` and failed the install with `ERR_PNPM_EPERM`.
3. `.pnpm-store/v10/projects/<hash>` + `.ignored_<hash>` must be deleted when
   `pnpm install` fails with `EPERM … rename`. It recurs; delete both each time.
4. Under `node-linker=hoisted`, `node_modules/@open-design/*` are **real copies**.
   Build the workspace packages first, then refresh the copies, or the daemon
   compiles against last release's `.d.ts`.
5. `@mms/shell` was never declared as a dependency and only resolved because the
   old `node_modules` happened to carry it. It is now `"@mms/shell": "workspace:*"`
   in `apps/web/package.json`. Junctions do **not** work on the SMB-mapped drive —
   the hoisted entry is a real copy.
