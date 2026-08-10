/**
 * Presentation maps for the Plugins workspace — status → tone, permission →
 * glyph, permission → short label, risk → chip.
 *
 * The approved MMSBUILD Plugins screen carries this information as seed data
 * on each demo plugin (`icon`, `tone`, a short permission string per row). Real
 * installed plugins carry none of it: the manifest has an optional icon IMAGE
 * and a list of permission IDs, and the host owns lifecycle status. These maps
 * are how the real data reaches the reference's visual vocabulary — every value
 * is derived from something the payload actually contains, never invented.
 *
 * Glyph names are Font Awesome Solid, consumed through `<FaIcon name="…" />`,
 * matching the reference's icon family exactly.
 */
import type { InstalledPlugin, PluginPermission } from '@core/plugin-sdk'
import { permissionRisk, type PluginCapabilityRisk } from '@core/plugin-sdk'

/** The four icon-tile gradients the reference ships. */
export type PluginTone = 'green' | 'slate' | 'red' | 'blue'

/** The status vocabulary the card, the filter and the recovery view share. */
export type PluginStatus = 'active' | 'disabled' | 'error' | 'installed'

export interface PluginStatusBadge {
  label: string
  status: PluginStatus
}

/**
 * Resolve a plugin's display status. `lifecycleStatus` is authoritative; the
 * `enabled` flag is the fallback for rows written before the host tracked a
 * lifecycle state, and it also downgrades an "active" row the operator has
 * since switched off.
 */
export function pluginStatus(plugin: InstalledPlugin): PluginStatusBadge {
  const status = plugin.lifecycleStatus ?? (plugin.enabled ? 'active' : 'disabled')
  if (status === 'error') return { label: 'Error', status: 'error' }
  if (status === 'installed') return { label: 'Installed', status: 'installed' }
  if (status === 'disabled' || !plugin.enabled) return { label: 'Disabled', status: 'disabled' }
  return { label: 'Active', status: 'active' }
}

/**
 * Icon-tile tone. Derived from lifecycle status so the tile colour always
 * states something true about the plugin — the reference hard-codes a tone per
 * demo plugin, but its four tones line up 1:1 with the four statuses.
 */
export function pluginTone(status: PluginStatus): PluginTone {
  if (status === 'error') return 'red'
  if (status === 'disabled') return 'slate'
  if (status === 'installed') return 'blue'
  return 'green'
}

/**
 * Glyph for a plugin's icon tile when the plugin ships no icon image. The
 * reference uses `fa-puzzle-piece` for every plugin installed through the
 * review flow, so that is the honest default for a plugin whose author gave us
 * nothing to draw.
 */
export const PLUGIN_FALLBACK_GLYPH = 'puzzle-piece'

/**
 * Resolve the icon image URL a plugin ships in its manifest, if any. Returns
 * null when the plugin has no icon, in which case the tile draws
 * `PLUGIN_FALLBACK_GLYPH`.
 */
export function pluginIconUrl(plugin: InstalledPlugin): string | null {
  const { icon, assetBasePath } = plugin.manifest
  if (!icon || !assetBasePath) return null
  return `${assetBasePath.replace(/\/+$/, '')}/${icon.replace(/^\/+/, '')}`
}

/**
 * Short, operator-facing permission names for the card's permission line and
 * the review table's row heading.
 *
 * The SDK's `permissionLabel()` returns a full sentence ("Read/write
 * plugin-owned records") because it exists to explain a capability in a consent
 * dialog. The reference draws this line at 10px in a 1fr column, where a
 * sentence per permission would wrap into an unreadable block — so it uses two
 * or three words. These are those words, in the reference's voice, for every
 * permission the catalog defines.
 */
const SHORT_LABELS: Record<PluginPermission, string> = {
  'admin.navigation': 'Admin pages',
  'cms.storage': 'Plugin storage',
  'cms.routes': 'Backend routes',
  'cms.routes.public': 'Public routes',
  'cms.hooks': 'CMS events',
  'cms.content.read': 'Read content',
  'cms.content.write': 'Write content',
  'cms.content.publish': 'Publish content',
  'cms.content.delete': 'Delete content',
  'cms.content.tables.manage': 'Manage tables',
  'cms.schedule': 'Scheduled jobs',
  'editor.code': 'Unsandboxed code',
  'editor.toolbar': 'Toolbar buttons',
  'editor.commands': 'Editor commands',
  'editor.canvas': 'Canvas overlays',
  'editor.panels': 'Editor panels',
  'editor.store.read': 'Read editor state',
  'editor.store.write': 'Write editor state',
  'modules.register': 'Register modules',
  'loops.register': 'Loop sources',
  'visualComponents.register': 'Register components',
  'dashboard.widgets.register': 'Dashboard widgets',
  'media.storage.adapter': 'Media storage',
  'media.url.transform': 'Media URLs',
  'media.variant.delegate': 'Media variants',
  'frontend.assets': 'Published-page assets',
  'network.outbound': 'Outbound network',
  'unstable.internals': 'Host internals',
}

export function permissionShortLabel(permission: PluginPermission): string {
  return SHORT_LABELS[permission] ?? permission
}

/**
 * Glyph per permission. Follows the reference's own `permissionIcon()` rules —
 * network → globe, storage → database, route → link, component → cubes,
 * template → image, everything else → user — extended to cover every
 * permission the catalog defines rather than only the seven the demo data uses.
 */
const PERMISSION_GLYPHS: Record<PluginPermission, string> = {
  'admin.navigation': 'window-maximize',
  'cms.storage': 'database',
  'cms.routes': 'link',
  'cms.routes.public': 'link',
  'cms.hooks': 'bolt',
  'cms.content.read': 'file-lines',
  'cms.content.write': 'pen',
  'cms.content.publish': 'arrow-up-from-bracket',
  'cms.content.delete': 'trash',
  'cms.content.tables.manage': 'database',
  'cms.schedule': 'clock',
  'editor.code': 'shield-virus',
  'editor.toolbar': 'window-maximize',
  'editor.commands': 'rectangle-list',
  'editor.canvas': 'image',
  'editor.panels': 'window-restore',
  'editor.store.read': 'file-lines',
  'editor.store.write': 'pen',
  'modules.register': 'cubes',
  'loops.register': 'rectangle-list',
  'visualComponents.register': 'cubes',
  'dashboard.widgets.register': 'table-cells-large',
  'media.storage.adapter': 'image',
  'media.url.transform': 'link',
  'media.variant.delegate': 'image',
  'frontend.assets': 'server',
  'network.outbound': 'globe',
  'unstable.internals': 'shield-virus',
}

export function permissionGlyph(permission: PluginPermission): string {
  return PERMISSION_GLYPHS[permission] ?? 'user'
}

/**
 * Risk chip. The reference styles exactly two chips — `.risk.low` and
 * `.risk.high` — in a FIXED 55px pill, which "Dangerous" would overflow. The
 * catalog's four tiers therefore collapse onto those two, and they collapse
 * UPWARD: only `low` reads as Low, so the chip can never understate what a
 * plugin is asking for.
 */
export type RiskChip = 'low' | 'high'

export function riskChip(permission: PluginPermission): RiskChip {
  return permissionRisk(permission) === 'low' ? 'low' : 'high'
}

export function riskChipLabel(chip: RiskChip): string {
  return chip === 'low' ? 'Low' : 'High'
}

/** Count of non-low permissions — the review panel's "· N high risk" figure. */
export function highRiskCount(permissions: readonly PluginPermission[]): number {
  return permissions.filter((permission) => riskChip(permission) === 'high').length
}

/**
 * Re-exported so callers that need the true four-tier value (audit copy, future
 * detail surfaces) don't have to reach past this module for it.
 */
export type { PluginCapabilityRisk }
export { permissionRisk }
