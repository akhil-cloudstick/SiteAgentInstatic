/**
 * The card view-model adapters. The reference fixture hardcodes an `initials`
 * pair and an `accent` per row; real catalogue rows carry neither, so these are
 * derived — and the derivation has to be stable, or a plugin's mark colour would
 * change between renders.
 */
import { describe, expect, it } from 'vitest';

import {
  CARD_ACCENTS,
  buildCategoryOptions,
  deriveAccent,
  deriveInitials,
  filterItems,
  humanizeSlug,
  type CatalogItem,
} from '../../src/components/plugins-screen/catalogItem';

function item(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    key: 'k',
    id: 'id',
    title: 'Title',
    description: '',
    category: '',
    categorySlug: '',
    initials: 'TI',
    accent: 'violet',
    badge: 'official',
    installed: true,
    searchText: 'title',
    ...overrides,
  };
}

describe('deriveInitials', () => {
  it('reproduces the reference fixture marks', () => {
    expect(deriveInitials('Code Migration')).toBe('CM');
    expect(deriveInitials('Figma Migration')).toBe('FM');
    expect(deriveInitials('GSAP')).toBe('GS');
    expect(deriveInitials('Research Decision Room')).toBe('RD');
  });

  it('handles slug-ish and empty titles without throwing', () => {
    expect(deriveInitials('code-migration')).toBe('CM');
    expect(deriveInitials('a')).toBe('A');
    expect(deriveInitials('   ')).toBe('··');
  });
});

describe('deriveAccent', () => {
  it('always returns one of the four reference accents', () => {
    for (const id of ['a', 'gsap', 'od-code-migration', 'x'.repeat(120)]) {
      expect(CARD_ACCENTS).toContain(deriveAccent(id));
    }
  });

  it('is stable for the same id and spread over the four buckets', () => {
    expect(deriveAccent('gsap')).toBe(deriveAccent('gsap'));
    const seen = new Set(
      Array.from({ length: 60 }, (_, index) => deriveAccent(`plugin-${index}`)),
    );
    expect(seen.size).toBe(4);
  });
});

describe('humanizeSlug', () => {
  it('turns a free-form skill category into a label', () => {
    expect(humanizeSlug('image-generation')).toBe('Image generation');
    expect(humanizeSlug('design_systems')).toBe('Design systems');
    expect(humanizeSlug('')).toBe('');
  });
});

describe('filterItems', () => {
  const items = [
    item({ id: 'a', searchText: 'gsap production-grade web animation creative tools' }),
    item({ id: 'b', searchText: 'code migration app / web design' }),
  ];

  it('requires every term to match somewhere', () => {
    expect(filterItems(items, 'web animation').map((entry) => entry.id)).toEqual(['a']);
    expect(filterItems(items, 'web').map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(filterItems(items, '  ').map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(filterItems(items, 'nope')).toEqual([]);
  });
});

describe('buildCategoryOptions', () => {
  it('lists each category once, in first-seen order, ignoring rows without one', () => {
    expect(
      buildCategoryOptions([
        item({ categorySlug: 'deck', category: 'Slides' }),
        item({ categorySlug: 'prototype', category: 'Prototype' }),
        item({ categorySlug: 'deck', category: 'Slides' }),
        item({ categorySlug: '', category: '' }),
      ]),
    ).toEqual([
      { slug: 'deck', label: 'Slides' },
      { slug: 'prototype', label: 'Prototype' },
    ]);
  });
});
