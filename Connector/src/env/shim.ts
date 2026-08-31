/**
 * Headless DOM environment + module registry for the Connector.
 *
 * Two of Instatic's conversion functions are not DOM-free, and both fail in
 * ways that are easy to miss:
 *
 *   - `importHtml()` needs `DOMParser` plus a populated module registry.
 *     Without the base modules registered it throws on every node.
 *   - `cssToStyleRules()` needs `CSSStyleSheet`. Without it, it returns zero
 *     rules AND an `invalid-rule` warning — a caller checking only the rule
 *     count sees "success" and silently loses every style on the site.
 *
 * The DOM half reuses Instatic's own `installPackCompileEnvironment`, which the
 * plugin CLI already uses for exactly this purpose.
 *
 * The registry half does NOT. `installPackCompileEnvironment` contains its own
 * `import '@modules/base'`, but that specifier resolves through *Instatic's*
 * tsconfig, which produces a different module instance than the one Connector's
 * `@modules/*` alias resolves to. Its registrations therefore land in a registry
 * we never read. Measured on this checkout: 0 modules registered when relying on
 * it, 25 when Connector imports the barrel itself. So we import it here, from
 * this side of the boundary. The DOM globals are immune to the same problem
 * because they live on `globalThis`.
 */

// Side-effect import: registers all base modules. Load-bearing — see above.
import '@modules/base'
import { registry } from '@core/module-engine/registry'
import { installPackCompileEnvironment } from '@core/plugin-sdk/cli/packCompileEnvironment'

export class DomEnvironmentError extends Error {
  override readonly name = 'DomEnvironmentError'
}

/**
 * Install the environment and prove it took effect.
 *
 * `installPackCompileEnvironment` is deliberately silent and idempotent — it
 * no-ops when `DOMParser` already exists. Correct for the plugin CLI, wrong for
 * us: we would rather fail loudly than convert an entire site against a
 * half-installed environment. So every precondition is asserted.
 */
export function installDomEnvironment(): void {
  installPackCompileEnvironment()

  if (typeof globalThis.DOMParser === 'undefined') {
    throw new DomEnvironmentError(
      'DOMParser is not defined after installing the pack-compile environment. ' +
        'importHtml() cannot run.',
    )
  }
  if (typeof globalThis.CSSStyleSheet === 'undefined') {
    throw new DomEnvironmentError(
      'CSSStyleSheet is not defined after installing the pack-compile environment. ' +
        'cssToStyleRules() would return zero rules and report success.',
    )
  }
  if (registry.list().length === 0) {
    throw new DomEnvironmentError(
      'The module registry is empty even though @modules/base was imported. The ' +
        '@modules/* alias is probably resolving to a second module instance — ' +
        'check Connector/tsconfig.json paths against Instatic/tsconfig.json.',
    )
  }
}

/** Module ids currently registered. Used by `doctor` and the lock generator. */
export function registeredModuleIds(): string[] {
  return registry
    .list()
    .map((m) => (m as { id: string }).id)
    .sort()
}
