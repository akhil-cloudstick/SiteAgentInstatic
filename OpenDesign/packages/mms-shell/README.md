# `@mms/shell`

The MMSBUILD two-row product shell — **one implementation, every MMS product**.

```
ROW 1  MmsShellHeader     [MMSBUILD] [Product Hub + context] [Hub nav]
                                  [Help][Bell][Theme][Settings][Account]
ROW 2  MmsSpecialistRow   [identity + scope] [destinations] [local actions]
```

The shared-header contract requires row 1 to *"look and behave as one shared
component, not three visual copies maintained independently."* This package is
how that is enforced rather than merely intended: MMS-CMS (Instatic) and MMS
Design (OpenDesign) both import this source, so a header change is made once.

Per-product differences are **props only** — the row-1 secondary label, the
row-2 identity and scope, the destination list, the local actions, and which end
`Back to Product Hub` sits on (`left` in MMS Design per DECISIONS 2026-08-10,
`right` in the CMS).

## What a consumer wires up

```tsx
import { MmsShellHeader, MmsSpecialistRow } from '@mms/shell'
import '@mms/shell/styles/fonts.css'
import '@mms/shell/styles/tokens.css'
import '@mms/shell/styles/fontawesome/fontawesome-solid.css'
```

`tokens.css` is the base token layer for BOTH products (`:root`, the dark block,
the two-row geometry). A product re-scopes a token for one surface the way
Instatic already does — a scoped block such as `[data-editor-screen='site']` or
`.start-desk` — never by editing the base layer.

The dark block answers to `[data-editor-theme='dark']` *and* `[data-theme='dark']`
so each product keeps the attribute it already persists.

## Rules for anything added here

- **React 18-compatible.** MMS Design runs React 18.3.1, the CMS runs 19.2.5.
  Use `forwardRef`, never ref-as-prop; no `use()`, no `useActionState`.
- **No manual memoization.** The CMS compiles this with the React Compiler,
  which bans it; MMS Design has no compiler, so correctness must not depend on
  one either.
- **No product imports.** Nothing from `@core/*`, `@admin/*`, `@ui/*`,
  `@site/*`, or an app's `src/`. Behaviour arrives as props.
- **No bundler-specific globals.** `import.meta.env` exists in Vite and not in
  Turbopack — use `process.env.NODE_ENV`.
- **No app-absolute asset URLs.** MMS Design is served under a `/design` base
  path, so `/mmsbuild-logo-light.png` resolves outside the app. Import assets so
  the bundler rewrites them.

## Module resolution — the one sharp edge

This package is consumed as **source via a path alias**, not as an installed
dependency, because that is what makes "edit once, see it in both" true with no
build step in between.

The cost: `shared/mms-shell` has no `node_modules` above it, so a bare
`import 'react'` inside it cannot resolve by the normal upward walk. **Every
consumer must pin `react` and `react-dom` to its own copy**, both so resolution
succeeds and so the shell can never end up with a second React (which would give
it its own hook dispatcher and break every state update inside the header).

Instatic does this in three places, and a new consumer needs the equivalent:

| Where | Why |
|---|---|
| `vite.config.ts` → `resolve.alias` | the browser build |
| `tsconfig.app.json` → `paths` (to `@types/react`) | the typechecker wants declarations |
| `tsconfig.json` → `paths` (to `react`) | `bun test` wants JavaScript |

`bun test` additionally does not apply tsconfig `paths` to importers located
outside the project root, so running the shell's components under the CMS test
runner needs `shared/mms-shell/node_modules/react` to exist as a link to the
consuming app's copy. That is a known gap, not a design intent — see the
handoff notes.
