/**
 * The one place `?strategy=` is read.
 *
 * `/import`, `/import/archive` and `/import/preview` all branch on this
 * parameter, and they MUST resolve an absent one identically. They did not:
 * both import endpoints defaulted to `replace` while preview treated an absent
 * value as a merge. A caller who previewed with defaults and then imported with
 * defaults was shown an 11-row merge and got an 18-row wipe — the preview
 * describing a run that would never happen, which is the single thing a dry-run
 * must never do.
 *
 * Sharing the resolver is the fix rather than copying the default into preview,
 * because the copy is what drifted in the first place.
 */
import { parseValue } from '@core/utils/typeboxHelpers'
import { ImportStrategySchema, type ImportStrategy } from '@core/data/bundleSchema'

/**
 * What an import does when the caller names no strategy.
 *
 * `replace` is the destructive one, so it is a sharp default — but it is the
 * shipped behaviour of both import endpoints, and preview's job is to report
 * the truth about them, not a gentler fiction.
 */
export const DEFAULT_IMPORT_STRATEGY: ImportStrategy = 'replace'

export class InvalidImportStrategyError extends Error {
  constructor() {
    super('Invalid strategy — must be replace, merge-add, or merge-overwrite')
    this.name = 'InvalidImportStrategyError'
  }
}

/** Resolve `?strategy=`, throwing `InvalidImportStrategyError` on a bad value. */
export function resolveImportStrategy(url: URL): ImportStrategy {
  const raw = url.searchParams.get('strategy') ?? DEFAULT_IMPORT_STRATEGY
  try {
    return parseValue(ImportStrategySchema, raw)
  } catch {
    throw new InvalidImportStrategyError()
  }
}
