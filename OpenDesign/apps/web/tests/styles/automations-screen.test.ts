// The Automations screen's stylesheet is a transcription of the approved
// MMSBUILD reference (`prototype-reference/src/styles.css`). Two things must
// stay true for it to keep matching in BOTH themes:
//
//   1. Every colour resolves through `--mms-*`. The shared token layer defines
//      that set for `:root` and for `[data-theme="dark"]` with values identical
//      to the reference's own two blocks, so a token-only stylesheet tracks the
//      reference in light and dark automatically. A raw hex or `rgb()` is how a
//      component silently breaks the opposite theme.
//   2. The reference's load-bearing metrics are the ones actually shipped.
//
// The six literals the reference itself hardcodes are allowed, and only those.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/components/AutomationsScreen.module.css', import.meta.url),
  'utf8',
);

const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The reference's own hardcoded values, `styles.css` line refs in brackets:
 *   #fff / #001e2d  primary-button ink, light + dark          [516-518, 4895-4901]
 *   #267c8d         `.is-orbit` template icon                 [6334-6337]
 *   #8f5c22         `.is-live-artifact` template icon          [6339-6342]
 *   rgb(0 18 27 / 70%)      modal backdrop                     [5563]
 *   rgb(8 39 49 / 3%)       row card shadow                    [6063]
 *   rgb(0 11 17 / 38%)      modal card shadow                  [5576]
 *
 * The reference's focus ring — `rgb(243 201 79 / 78%)` [81] — is deliberately
 * NOT on this list. The gold halo was rejected in review 2026-08-13 and now
 * comes from the shared `--mms-focus-ring` token, so a literal reappearing here
 * is a regression and this test should fail on it.
 */
const ALLOWED_LITERALS = [
  '#fff',
  '#001e2d',
  '#267c8d',
  '#8f5c22',
  'rgb(0 18 27 / 70%)',
  'rgb(8 39 49 / 3%)',
  'rgb(0 11 17 / 38%)',
];

describe('AutomationsScreen.module.css', () => {
  it('never hardcodes a colour outside the reference\'s own literals', () => {
    const hexes = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const unexpectedHexes = hexes.filter((hex) => !ALLOWED_LITERALS.includes(hex.toLowerCase()));
    expect(unexpectedHexes).toEqual([]);

    const rgbs = withoutComments.match(/rgba?\([^)]*\)/g) ?? [];
    const unexpectedRgbs = rgbs.filter((value) => !ALLOWED_LITERALS.includes(value));
    expect(unexpectedRgbs).toEqual([]);
  });

  it('uses the shared MMS tokens rather than the app-alias vocabulary', () => {
    // `--bg-*`, `--text*`, `--border*`, `--accent*`, `--radius*` and
    // `--shadow-sm|md|lg` are open-design's own alias layer. The reference does
    // not have them, and mixing the two is what made the old screen drift.
    for (const alias of [
      '--bg-panel',
      '--bg-subtle',
      '--bg-muted',
      '--text-strong',
      '--text-muted',
      '--border-soft',
      '--accent-soft',
      '--radius-pill',
      '--shadow-sm',
      '--shadow-md',
      '--shadow-lg',
    ]) {
      expect(withoutComments).not.toContain(`var(${alias})`);
    }
    // The two shadows the reference DOES define as tokens are still used.
    expect(withoutComments).toContain('var(--shadow-menu)');
    expect(withoutComments).toContain('var(--shadow-frame)');
  });

  it('ships the reference\'s load-bearing metrics', () => {
    const metrics: [string, string][] = [
      ['screen padding', 'padding: 34px max(48px, calc((100vw - 1440px) / 2)) 64px'],
      ['root font size', 'font-size: 13px'],
      ['metrics strip height', 'height: 44px'],
      ['primary action height', 'min-height: 42px'],
      ['row padding', 'padding: 17px'],
      ['row icon box', 'width: 40px'],
      ['row action height', 'min-height: 38px'],
      ['status pill radius', 'border-radius: 12px'],
      ['history bleed', 'margin-top: -3px'],
      ['filter tab height', 'min-height: 42px'],
      ['template grid', 'grid-template-columns: repeat(3, minmax(0, 1fr))'],
      ['template card height', 'min-height: 190px'],
      ['template card columns', 'grid-template-columns: 42px minmax(0, 1fr)'],
      ['modal width', 'width: min(900px, calc(100vw - 48px))'],
      ['modal height', 'max-height: min(860px, calc(100vh - 48px))'],
      ['modal radius', 'border-radius: 12px'],
      ['compose head height', 'min-height: 70px'],
      ['title input size', 'font-size: 20px'],
      ['textarea height', 'min-height: 230px'],
      ['context picker offset', 'top: 92px'],
      ['template picker width', 'width: 390px'],
      ['schedule popover width', 'width: 340px'],
      ['schedule opens upward', 'bottom: calc(100% + 7px)'],
      ['popover width', 'width: 240px'],
    ];

    for (const [label, declaration] of metrics) {
      expect(withoutComments, label).toContain(declaration);
    }
  });

  it('keeps all four reference breakpoints', () => {
    for (const width of [1180, 900, 760, 520]) {
      expect(withoutComments).toContain(`@media (max-width: ${width}px)`);
    }
  });

  it('does not reintroduce a fixed height that content could overflow', () => {
    // Everything that can hold variable-length content is sized with
    // `min-height`. A bare `height:` is only allowed on the reference's fixed
    // boxes, which is the whole list below:
    //   3   active filter-tab underline        [4967]
    //   4   indeterminate loading bar          (loading only)
    //   9   runtime dot / skeleton text line   [6573]
    //   22  filter-tab count chip              [4946]
    //   34  template-picker icon               [6458]
    //   38  skeleton action block              (skeleton only)
    //   40  row / card / kebab icon boxes      [5218, 6082]
    //   44  hero metrics strip                 [5980]
    const fixedHeights = [...withoutComments.matchAll(/(?:^|[;{])\s*height:\s*(\d+)px/g)].map(
      (match) => Number(match[1]),
    );
    expect([...new Set(fixedHeights)].sort((a, b) => a - b)).toEqual([3, 4, 9, 22, 34, 38, 40, 44]);
  });

  it('carries no focus ring, and no UA outline in its place', () => {
    // The reference's gold halo fired on every click into a text field. Both
    // the halo and the outline it replaced are suppressed; the only remaining
    // focus cue is the green border on a focused field.
    expect(withoutComments).not.toContain('--mms-focus-ring');
    expect(withoutComments).not.toContain('243 201 79');
    expect(withoutComments).toMatch(/:focus-visible[\s\S]{0,220}box-shadow:\s*none/);
    expect(withoutComments).toMatch(/textarea:focus[\s\S]{0,120}border-color:\s*var\(--mms-action\)/);
  });

  it('loads with the Projects screen\'s sweeping bar and shimmering rows', () => {
    expect(withoutComments).toContain('@keyframes automations-progress-sweep');
    expect(withoutComments).toContain('@keyframes automations-skeleton-shimmer');
    // Same 1.9s beat on both loops, so they read as one rhythm rather than two
    // loops beating against each other. (Scoped to the `automations-*` loading
    // keyframes — `catalog-spin` on the running-status glyph runs at 0.8s.)
    expect(
      [
        ...withoutComments.matchAll(
          /animation:\s*automations-[a-z-]+\s+(\d+(?:\.\d+)?)s linear infinite/g,
        ),
      ].map((match) => match[1]),
    ).toEqual(['1.9', '1.9']);
    // Composited transform, not `left` — see the block comment in the module.
    expect(withoutComments).toContain('transform: translateX(223%)');
  });
});
