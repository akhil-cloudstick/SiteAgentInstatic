/**
 * One React instance for `bun test`, matching what the real build already does.
 *
 * `@mms/shell` is shared as SOURCE and physically lives under OpenDesign, so a
 * bare `import ... from 'react'` inside it resolves by walking UP from its own
 * directory and finds `OpenDesign/node_modules/react` — never this package's
 * copy. Both are 19.2.5 since 2026-09-23, but they are still two separate
 * MODULE INSTANCES, and React keeps its hook dispatcher in module-level state:
 * this package's `react-dom` sets the dispatcher on ITS react, while the shell's
 * hooks read the OTHER react and get `null`. That surfaces as
 * "Invalid hook call" / "resolveDispatcher() is null" in every test that renders
 * a tree containing the shell.
 *
 * This is NOT a stub and NOT a behaviour change. `vite.config.ts` already
 * aliases `react` and `react-dom` to `node_modules/react{,-dom}` for the whole
 * bundle, shell included, so the shipped app has always had exactly one React.
 * Only `bun test` lacked that alias. This restores parity — the tests once again
 * exercise the component tree that actually ships, which is precisely why
 * stubbing the shell was the wrong fix.
 *
 * Mechanism: Bun never calls `onResolve` for bare `node_modules` specifiers
 * (that is the documented dead end that made earlier attempts silently do
 * nothing), but it DOES call `onLoad` for the resolved file. So every react /
 * react-dom file that resolves outside this package is replaced by a re-export
 * of our copy — one shared instance, rather than a second copy of the source.
 *
 * The rule is derived, not hardcoded to OpenDesign: any react resolving from a
 * `node_modules` that is not ours is redirected here.
 */
import { plugin } from 'bun'
import path from 'node:path'

/** This package's root — the `node_modules` that wins. */
const OWN_MODULES = path.join(path.resolve(import.meta.dir, '../..'), 'node_modules')

const norm = (value: string): string => value.split('\\').join('/')

/** Escape for use inside a RegExp, then accept either path separator. */
function pathPattern(value: string): string {
  return norm(value)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .split('/')
    .join('[\\\\/]')
}

/**
 * Files under a foreign `react` / `react-dom` package directory.
 *
 * Two parts are load-bearing:
 *  - the leading negative lookahead excludes OUR OWN copy, which must load
 *    normally (an onLoad hook that matches must return an object, so the
 *    cheapest way to leave a file alone is not to match it);
 *  - the trailing separator after the package name keeps `react-is`,
 *    `react-error-boundary` and friends out — they must resolve normally.
 */
const FOREIGN_REACT_FILE = new RegExp(
  `^(?!${pathPattern(OWN_MODULES)}[\\\\/])` + `.*[\\\\/]node_modules[\\\\/](?:react|react-dom)[\\\\/]`,
)

plugin({
  name: 'single-react',
  setup(build) {
    build.onLoad({ filter: FOREIGN_REACT_FILE }, (args) => {
      // Map `<anywhere>/node_modules/react/...` onto `<ours>/node_modules/react/...`,
      // keeping the subpath so `react-dom/client` and `react/jsx-runtime` land
      // on their real counterparts rather than on the package root.
      const suffix = norm(args.path).split(/[\\/]node_modules[\\/]/).pop()
      if (!suffix) throw new Error(`[single-react] could not map ${args.path}`)
      const spec = JSON.stringify(norm(path.join(OWN_MODULES, suffix)))

      // A re-export, deliberately — NOT a copy of the source. Re-reading the
      // file would create a third instance with its own dispatcher and change
      // nothing. `export *` plus an explicit default covers both how the shell
      // imports React (`import { useId } from 'react'`) and how the app does
      // (`import React from 'react'`).
      return {
        contents: `export * from ${spec};\nimport _default from ${spec};\nexport default _default;\n`,
        loader: 'js',
      }
    })
  },
})
