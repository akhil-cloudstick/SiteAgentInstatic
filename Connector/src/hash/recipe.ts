/**
 * Release-recipe hash — the "how", where the other hashes cover the "what".
 *
 * Gating the full-site publish on the document hash alone is incomplete: a
 * changed renderer, plugin, publish filter, dependency, runtime or deployment
 * mode alters the baked output while the document stays byte-identical. Skipping
 * the publish in that case ships stale HTML and reports a clean no-op.
 *
 * So a release is a no-op only when document hash AND recipe hash both match the
 * last verified release.
 */

import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical'

export interface ReleaseRecipe {
  /** Instatic fork identity — commit and tree, not just version. */
  instaticCommit: string
  instaticTree: string
  instaticPackageVersion: string
  /** Exact runtime, because output can differ across Bun patch releases. */
  bunVersion: string
  /** Lockfile hashes: a dependency bump changes output without touching source. */
  instaticDependencyLockSha256: string
  connectorDependencyLockSha256: string
  /** Connector identity. */
  connectorVersion: string
  connectorCommit: string
  connectorConfigSha256: string
  /** Anything that changes what the publisher emits. */
  pluginPacks: { id: string; version: string }[]
  publishFilterConfigSha256: string
  importStrategy: 'replace' | 'merge-add' | 'merge-overwrite'
  featureFlags: Record<string, string | boolean>
  deployWebhookMode: 'suppressed-during-connector-release' | 'enabled'
}

export function recipeHash(recipe: ReleaseRecipe): string {
  return createHash('sha256').update(canonicalJson(recipe)).digest('hex')
}
