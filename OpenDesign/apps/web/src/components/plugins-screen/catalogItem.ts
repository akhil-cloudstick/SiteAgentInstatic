/**
 * Card view-model for the Plugins screen.
 *
 * The approved MMSBUILD reference (`prototype-reference/src/PluginsScreen.jsx`)
 * draws ONE card shape for every catalogue row: a 46px initials mark, a title
 * with a provenance pill, a two-line description, and an uppercase category.
 * Its fixture hardcodes `initials` and `accent` per item; real catalogue rows
 * carry neither, so both are derived here — deterministically, so a plugin
 * keeps the same mark colour across reloads and between users.
 *
 * Three row sources feed the same shape:
 *   - installed plugin records          (`/api/plugins`)
 *   - marketplace entries not installed  (`/api/marketplaces`)
 *   - skills                             (`/api/skills`)
 *
 * Everything in this file is pure — no React, no fetch — so the mapping is
 * unit-testable on its own.
 */
import type { InstalledPluginRecord } from '@open-design/contracts';
import type { SkillSummary } from '../../types';
import type {
  PluginMarketplace,
  PluginMarketplaceEntry,
} from '../../state/projects';

/** The four mark colours the reference defines (`resource-screens.css:301-304`). */
export const CARD_ACCENTS = ['violet', 'blue', 'green', 'orange'] as const;
export type CardAccent = (typeof CARD_ACCENTS)[number];

/**
 * Which provenance pill the card's `<small>` shows. The reference prints a
 * fixed "OpenDesign official" because its fixture is a single curated list;
 * real rows state where they actually came from.
 */
export type CatalogBadge = 'official' | 'trusted' | 'restricted' | 'personal';

export interface CatalogItem {
  /** React key. Unique across every row source. */
  key: string;
  /** Plugin id, skill id, or marketplace entry name. */
  id: string;
  title: string;
  description: string;
  /** Display label for the uppercase category line. Empty when unknown. */
  category: string;
  /** Facet slug the category row filters on. Empty when unknown. */
  categorySlug: string;
  initials: string;
  accent: CardAccent;
  badge: CatalogBadge;
  /** False only for marketplace entries that are not installed yet. */
  installed: boolean;
  record?: InstalledPluginRecord;
  entry?: AvailableMarketplacePlugin;
  skill?: SkillSummary;
  /** Lower-cased haystack for the search box. */
  searchText: string;
}

export interface AvailableMarketplacePlugin {
  key: string;
  marketplace: PluginMarketplace;
  entry: PluginMarketplaceEntry;
  installedRecord?: InstalledPluginRecord;
  installSource?: string;
}

/* ── Derivations ─────────────────────────────────────────────────────────── */

/**
 * Two-letter mark, matching the reference fixture's hand-written initials
 * ("Code Migration" -> CM, "GSAP" -> GS).
 */
export function deriveInitials(title: string): string {
  const words = title.trim().split(/[\s/_-]+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

/**
 * Stable accent per id. The reference assigns accents per item rather than per
 * category — two `App / Web Design` fixtures carry different colours — so a
 * hash reproduces its variety without inventing a taxonomy it does not have.
 * FNV-1a: short, dependency-free, and evenly spread over four buckets.
 */
export function deriveAccent(id: string): CardAccent {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CARD_ACCENTS[hash % CARD_ACCENTS.length]!;
}

/** `image-generation` -> `Image generation`. Skills carry free-form slugs. */
export function humanizeSlug(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function pluginBadge(record: InstalledPluginRecord): CatalogBadge {
  if (record.sourceKind === 'bundled') return 'official';
  if (record.trust === 'official') return 'official';
  if (record.trust === 'trusted') return 'trusted';
  if (record.trust === 'restricted') return 'restricted';
  return 'personal';
}

function marketplaceBadge(marketplace: PluginMarketplace): CatalogBadge {
  if (marketplace.trust === 'official') return 'official';
  if (marketplace.trust === 'restricted') return 'restricted';
  return 'trusted';
}

function haystack(parts: Array<string | undefined | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ').toLowerCase();
}

/* ── Row builders ────────────────────────────────────────────────────────── */

export function pluginToItem(
  record: InstalledPluginRecord,
  copy: { title: string; description: string },
  category: { slug: string; label: string },
): CatalogItem {
  return {
    key: `plugin:${record.id}`,
    id: record.id,
    title: copy.title,
    description: copy.description,
    category: category.label,
    categorySlug: category.slug,
    initials: deriveInitials(copy.title || record.id),
    accent: deriveAccent(record.id),
    badge: pluginBadge(record),
    installed: true,
    record,
    searchText: haystack([
      copy.title,
      record.id,
      copy.description,
      category.label,
      (record.manifest?.tags ?? []).join(' '),
    ]),
  };
}

export function availableToItem(
  plugin: AvailableMarketplacePlugin,
  copy: { title: string; description: string },
): CatalogItem {
  const { entry } = plugin;
  return {
    key: `available:${plugin.key}`,
    id: entry.name,
    title: copy.title,
    description: copy.description,
    category: '',
    categorySlug: '',
    initials: deriveInitials(copy.title || entry.name),
    accent: deriveAccent(entry.name),
    badge: marketplaceBadge(plugin.marketplace),
    installed: false,
    entry: plugin,
    searchText: haystack([
      copy.title,
      entry.name,
      copy.description,
      entry.source,
      entry.version,
      plugin.marketplace.manifest.name,
      (entry.tags ?? []).join(' '),
    ]),
  };
}

export function skillToItem(
  skill: SkillSummary,
  copy: { title: string; description: string },
): CatalogItem {
  const slug = skill.category ?? '';
  const label = slug ? humanizeSlug(slug) : humanizeSlug(skill.mode);
  return {
    key: `skill:${skill.id}`,
    id: skill.id,
    title: copy.title,
    description: copy.description,
    category: label,
    categorySlug: slug || skill.mode,
    initials: deriveInitials(copy.title || skill.name),
    accent: deriveAccent(skill.id),
    badge: skill.source === 'user' ? 'personal' : 'official',
    installed: true,
    skill,
    searchText: haystack([
      copy.title,
      skill.id,
      skill.name,
      copy.description,
      label,
      skill.mode,
      (skill.triggers ?? []).join(' '),
    ]),
  };
}

/* ── Filtering ───────────────────────────────────────────────────────────── */

/**
 * The reference matches `title + id + description + category` case-insensitively
 * (`PluginsScreen.jsx:207`); `searchText` is that haystack, and every term must
 * hit so a phrase like "design slides" does not surface unrelated rows.
 */
export function filterItems(items: CatalogItem[], query: string): CatalogItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => terms.every((term) => item.searchText.includes(term)));
}

/** `["All", ...new Set(items.map(i => i.category))]` — reference line 197-200. */
export function buildCategoryOptions(items: CatalogItem[]): Array<{ slug: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.categorySlug || !item.category) continue;
    if (!seen.has(item.categorySlug)) seen.set(item.categorySlug, item.category);
  }
  return Array.from(seen, ([slug, label]) => ({ slug, label }));
}

/* ── Marketplace catalogue ───────────────────────────────────────────────────
 * Moved verbatim from the superseded `PluginsView.tsx`; it is what turns the
 * registered catalogues into "available to install" rows, and the build kit
 * (§3 "use upstream-native catalogs") requires that path to keep working even
 * though the Sources management panel is gone from the UI.
 */
export function buildAvailablePlugins(
  marketplaces: PluginMarketplace[],
  installed: InstalledPluginRecord[],
): AvailableMarketplacePlugin[] {
  const installedByName = new Map<string, InstalledPluginRecord>();
  for (const plugin of installed) {
    for (const key of pluginLookupKeys(plugin)) {
      installedByName.set(key, plugin);
    }
  }
  return marketplaces.flatMap((marketplace) => {
    const entries = marketplace.manifest.plugins ?? [];
    return entries.flatMap((entry) => {
      const installedPlugin = installedByName.get(normalizePluginName(entry.name)) ?? null;
      if (installedPlugin && installedPlugin.sourceKind !== 'bundled') return [];
      const installedRecord = installedPlugin && bundledPluginMatchesMarketplaceEntry(
        installedPlugin,
        marketplace,
        entry,
      )
        ? installedPlugin
        : null;
      return [{
        key: `${marketplace.id}:${entry.name}:${entry.version ?? ''}`,
        marketplace,
        entry,
        ...(installedRecord ? { installedRecord } : {}),
      }];
    });
  });
}

function bundledPluginMatchesMarketplaceEntry(
  plugin: InstalledPluginRecord,
  marketplace: PluginMarketplace,
  entry: PluginMarketplaceEntry,
): boolean {
  return plugin.sourceKind === 'bundled'
    && plugin.sourceMarketplaceId === marketplace.id
    && normalizePluginName(plugin.sourceMarketplaceEntryName ?? '') === normalizePluginName(entry.name);
}

function pluginLookupKeys(plugin: InstalledPluginRecord): string[] {
  const keys = new Set<string>();
  keys.add(normalizePluginName(plugin.id));
  if (plugin.manifest?.name) keys.add(normalizePluginName(plugin.manifest.name));
  if (plugin.sourceMarketplaceEntryName) {
    keys.add(normalizePluginName(plugin.sourceMarketplaceEntryName));
  }
  return Array.from(keys);
}

function normalizePluginName(name: string): string {
  return name.trim().toLowerCase();
}
