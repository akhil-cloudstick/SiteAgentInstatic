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

  it('fails on a hardcoded image path inside an inline <script> (swap script)', () => {
    const html =
      '<script>var d=[{image:"/images/product-cube.svg"}];document.getElementById("f").src=d[0].image;</script>';
    expect(findingFor(html, 'hardcoded in JavaScript').status).toBe('fail');
  });

  it('passes when a swap script reads src from the DOM (no hardcoded path)', () => {
    const html =
      '<script>var t=row.querySelector(".thumb");document.getElementById("f").src=t.src;</script>';
    expect(findingFor(html, 'hardcoded in JavaScript').status).toBe('pass');
  });

  it('fails on a modern color function inside a background shorthand', () => {
    const html = '<style>.avatar.sky{background:oklch(70% 0.15 230)}</style>';
    expect(findingFor(html, 'modern color function').status).toBe('fail');
  });

  it('fails on color-mix inside a shorthand in an inline style attribute', () => {
    const html = '<span class="avatar" style="background: color-mix(in srgb, #f00, #fff 40%)">SM</span>';
    expect(findingFor(html, 'modern color function').status).toBe('fail');
  });

  it('passes the compliant forms: longhand, :root var token, and plain color', () => {
    const html =
      '<style>:root{--tone-sky:#cfe8ff}.a{background-color:oklch(70% 0.15 230)}.b{background:var(--tone-sky)}.c{color:oklch(20% 0.04 80)}</style>';
    expect(findingFor(html, 'modern color function').status).toBe('pass');
  });

  it('fails on @layer (the whole block is dropped on import)', () => {
    const html = '<style>@layer base { .a{color:red} }</style>';
    expect(findingFor(html, '@layer').status).toBe('fail');
  });

  it('fails on an unsupported image format (avif/ico/…)', () => {
    expect(findingFor('<img src="/images/hero.avif" alt="x">', 'unsupported image').status).toBe('fail');
  });

  it('passes a supported image format (webp)', () => {
    expect(findingFor('<img src="/images/hero.webp" alt="x">', 'unsupported image').status).toBe('pass');
  });

  it('no longer emits a data-sa marker finding (rule retired — importer ignores data-sa)', () => {
    const html = '<h1>hi</h1><p>x</p><img src="/a.jpg">';
    expect(checkPageCompliance(html).some((f) => f.rule.includes('data-sa'))).toBe(false);
  });

  it('summarizes fail/warn counts', () => {
    const html = '<div class="mb-4"><head><link rel="stylesheet" href="a.css"></head></div>';
    const s = summarizeCompliance(checkPageCompliance(html));
    expect(s.fails).toBeGreaterThanOrEqual(2); // tailwind + external css
    expect(typeof s.warns).toBe('number');
  });
});
