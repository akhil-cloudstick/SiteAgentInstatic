# Pending — MMS shared shell & Website Start Desk

Last updated: 2026-08-11

Two things live in this file: **the structure decision you may want to revisit**,
and **the UI work that is genuinely unfinished**.

---

## 1. Structure: why `@mms/shell` sits inside OpenDesign

### Where it is now

```
OpenDesign/packages/mms-shell/     ← the ONE MMSBUILD two-row shell
  src/shell/       MmsShellHeader (row 1) · MmsSpecialistRow (row 2)
  src/primitives/  Button · FaIcon · Tooltip · Separator · ContextMenu
  src/styles/      tokens.css · fonts.css · fontawesome/ (+ vendored woff2)
  src/assets/      mmsbuild-logo-{light,dark}.png
```

Consumed by **both** products:

| Product | How it resolves |
|---|---|
| MMS Design (`OpenDesign/apps/web`) | pnpm workspace package + `transpilePackages: ['@mms/shell']` |
| MMS-CMS (`Instatic`) | Vite `resolve.alias` + tsconfig `paths` → `../OpenDesign/packages/mms-shell/src` |

### Why it is NOT at `<repo>/shared/mms-shell`

That was the original intent and the first implementation. It had to move.

**Turbopack will not read source or assets from outside the app's package.**
Widening `turbopack.root` does not help. With the package at `<repo>/shared/`
the OpenDesign build failed with:

```
Module not found: Can't resolve '@mms/shell'
Module not found: Can't resolve '.../fonts/inter-latin-wght-normal.woff2'
Module not found: Can't resolve '.../fa-solid-900.woff2'
```

…for files that demonstrably existed at exactly those paths. Vite (the CMS)
reads them without complaint, which is why only OpenDesign hit the wall.

Two more Windows/Turbopack constraints found on the way, worth knowing before
anyone re-arranges this:

- A **non-wildcard `paths` key with more than one target panics** Next's SWC
  tsconfig resolver (`value of 'paths.react' should be an array with one
  element`). It fails before compilation starts. Give each exactly one target.
- `turbopack.resolveAlias` **rejects absolute Windows paths** —
  "windows imports are not implemented yet". Relative-to-root only.

### If you want it outside both apps again

The goal — one copy, edit once, both products update — is already met by the
current layout. If the *location* still matters, the way to get it is a small
sync step, not a config flag:

1. Keep `<repo>/shared/mms-shell` as the single source of truth.
2. Add a prebuild step to `Operator/scripts/build-od-web.mjs` that mirrors it
   into `OpenDesign/packages/mms-shell` before `next build` runs.
3. CMS keeps consuming the original directly through its Vite alias.

Cost: a second copy on disk that someone will eventually edit by mistake, and a
script to maintain. That is the only reason it was not done this way.

### Rules that must survive any move

- **React 18 compatible.** MMS Design runs React 18.3.1, the CMS runs 19.2.5.
  `forwardRef`, never ref-as-prop; no `use()`, no `useEffectEvent`.
- **No manual memoization.** The CMS compiles this with the React Compiler
  (which bans it); MMS Design has no compiler, so correctness must not depend
  on one.
- **No product imports** — nothing from `@core/*`, `@admin/*`, `@ui/*`,
  `@site/*`. Behaviour arrives as props.
- **No bundler-specific globals** (`import.meta.env` is Vite-only).
- **No app-absolute asset URLs.** `/design` is a base path; `/logo.png` resolves
  outside the app. Import assets so the bundler rewrites them.
- **Each consumer pins `react`/`react-dom` to its own copy**, so the shell can
  never get a second React and its own hook dispatcher.

---

## 2. Build & serve — the step that is easy to miss

`/design` is served from a **prebuilt** bundle. `npm run dev` from Operator
starts the stack and serves whatever is already on disk — it never rebuilds
OpenDesign. Source edits are invisible until:

```powershell
cd s:\SiteAgentHub\Operator
node scripts/build-od-web.mjs --force   # ~2 min; logs to %TEMP%\siteagent-od\_shared-web\web.log
# then restart the control plane, then hard-refresh /design
```

The build writes to a fresh versioned directory, so the running server keeps
serving the old bundle until it restarts.

---

## 3. Unfinished UI work

Ordered by how visible it is. Everything below is on the Start Desk
(`OpenDesign/apps/web/src/components/start-desk/`).

### Visible defects

1. **Composer footer has no controls.** `StartDesk` accepts `designSystemSlot`
   and `workingDirSlot`; `HomeView` never passes them. The footer renders the
   label "Design system:" with nothing after it, and no working-directory
   button. — *fix: pass the existing `DesignSystemPicker` and `WorkingDirPicker`
   from `HomeView`.*

2. **Clicking a start card does not focus the composer.** `HomeView`'s
   `inputRef` is typed to `HomeHeroHandle` and still calls `focusEnd()`; the
   component it pointed at is no longer rendered, so the call is a no-op.
   Selecting *Website clone* seeds the prompt but does not scroll or focus.
   — *fix: expose a handle from `StartDesk` or lift the textarea ref.*

3. **Wrong New-project dialog.** The approved design specifies two tabs
   (Prototype, From template). Template / From template still open the existing
   16-type `NewProjectModal`.

4. **No toast.** Approved: bottom-right, 48px, dismiss after 2600ms. Currently
   notices are routed into `setError`, so they appear in the error slot.

5. **"Add context" is inert.** The menu renders with the correct seven options
   and MMS-fork/Upstream badges, but choosing one only shows a hint string.
   No file picker, no drag-and-drop, no removable file chips. — *fix: wire to
   the existing `ComposerPlusMenu`.*

6. **Community gallery still renders below Recent projects**
   (`HomeView.tsx`, `{communityRevealed ? …}`). The approved Home ends at
   Recent projects.

### Deliberate, needs a decision

7. **English only.** The Start Desk uses literal strings. Adding keys to
   `i18n/types.ts` requires all 19 locale files to be filled or the build
   fails. Matches how `NewProjectModal` already works. ~55 keys when wanted.

8. **`Back to Product Hub` is hidden.** It appears only when Product Hub hands
   over role/client/project/return-URL. `Operator/control-plane/hub/hub.mjs`
   sends `hubContextParams()` to the CMS hand-off but **not** to
   `/design/sso`. MMS Design reads `window.__mmsHub`
   (`apps/web/src/state/hubContext.ts`) — a UI-only path, no daemon change.
   Until Operator injects it, the header correctly renders its no-Hub shape.

### Housekeeping

9. **`EntryNavRail.tsx` still exists.** Nothing renders it; its `EntryView`
   type is still imported by `EntryShell`, so it cannot simply be deleted.

10. **Header geometry is Instatic's, not the prototype's.** Row 1 is 60px
    (`--hub-shell-height`) and row 2 is 48px (`--product-row-height`); the
    approved PNG shows 61/54. Deliberate — the CMS header was chosen as the
    reference so both products match. Change in `tokens.css` if wanted.

11. **Nobody has compared the built page against the approved screenshots yet.**

### Known-failing tests (verified pre-existing, not caused by this work)

- `Instatic` — 6 typecheck errors in `PreflightWidget.tsx`; 5 toolbar tests
  ENOENT on a Windows `.pathname` bug (`/S:/…`); 4 assert `ZoomControls` in
  `AdminCanvasLayout`, where it appears zero times and the file's own comment
  says zoom moved to the workspace row.
- `OpenDesign` — 60 typecheck errors, all plugin-typing files.
  `next.config.ts` already documents that the repo carries these.

---

## 4. What is done and verified

- `@mms/shell` exists and is consumed by both products from one source.
- MMS-CMS fully migrated: `ProductHubHeader` and `Toolbar` are thin adapters;
  `AdminSectionNavigation` returns destinations as data.
- MMS Design: left nav rail retired, both shared rows mounted, routing
  unchanged (`changeView` still owns it).
- Website Start Desk built to the approved geometry, palette, states and
  breakpoints, with the locked start routing (blank project opens immediately,
  website clone waits for a URL) and the BYOK guard.
- **OpenDesign production build passes** (`✓ Compiled successfully in 81s`).
- CMS typechecks clean; OD typechecks clean for all changed files.
