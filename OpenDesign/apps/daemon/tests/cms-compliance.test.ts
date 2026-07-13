import { describe, expect, it } from 'vitest';

import {
  checkPageCompliance,
  isUtilityClass,
  summarizeCompliance,
} from '../src/cms-compliance.js';

const findingFor = (html: string, ruleFragment: string) => {
  const f = checkPageCompliance(html).find((x) => x.rule.includes(ruleFragment));
  if (!f) throw new Error(`no finding for "${ruleFragment}"`);
  return f;
};

describe('cms-compliance — isUtilityClass', () => {
  it('recognizes common Tailwind utilities', () => {
    for (const u of ['mb-4', 'text-center', 'flex', 'px-6', 'bg-gray-900', 'items-center', 'md:flex']) {
      expect(isUtilityClass(u), u).toBe(true);
    }
  });
  it('does not flag semantic class names', () => {
    for (const s of ['hero', 'navbar', 'card', 'footer-links', 'hero-title', 'accent']) {
      expect(isUtilityClass(s), s).toBe(false);
    }
  });
});

describe('cms-compliance — checkPageCompliance', () => {
  it('fails on a leftover Tailwind class', () => {
    const html = '<div class="hero mb-4">x</div>';
    expect(findingFor(html, 'Tailwind').status).toBe('fail');
  });

  it('fails on an external (non-Google) stylesheet link', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"><style>.a{}</style></head>';
    expect(findingFor(html, 'CSS inline').status).toBe('fail');
  });

  it('passes CSS-inline when only a Google Fonts link is present', () => {
    const html =
      '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>.a{color:red}</style></head><body><p>hi</p></body>';
    expect(findingFor(html, 'CSS inline').status).toBe('pass');
  });

  it('fails fonts on @fontsource', () => {
    const html = '<style>@import "@fontsource/inter";</style>';
    expect(findingFor(html, 'Fonts').status).toBe('fail');
  });

  it('warns when there are no :root color tokens', () => {
    const html = '<style>.hero{color:#fff}</style>';
    expect(findingFor(html, ':root tokens').status).toBe('warn');
  });

  it('passes :root tokens when custom properties exist', () => {
    const html = '<style>:root{--color-accent:#e11}.hero{color:var(--color-accent)}</style>';
    expect(findingFor(html, ':root tokens').status).toBe('pass');
  });

  it('summarizes fail/warn counts', () => {
    const html = '<div class="mb-4"><head><link rel="stylesheet" href="a.css"></head></div>';
    const s = summarizeCompliance(checkPageCompliance(html));
    expect(s.fails).toBeGreaterThanOrEqual(2); // tailwind + external css
    expect(typeof s.warns).toBe('number');
  });
});
