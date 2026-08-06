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

  // Regression: an OD page shipped `<div class="stat"><strong>84</strong> Max
  // departures per year</div>`. The loose label imported as a no-wrapper
  // base.text (tag:'none'), which owns no DOM element — so in the CMS it could
  // not be clicked on the canvas, drew no selection ring, and could never take a
  // class. The old rule only inspected <h1>-<h6>/<p>, so it passed this clean.
  describe('no bare text', () => {
    const bareTextRule = 'No bare text';

    it('fails on loose text inside a div beside an inline element', () => {
      const html = '<div class="stat"><strong>84</strong> Max departures per year</div>';
      const finding = findingFor(html, bareTextRule);
      expect(finding.status).toBe('fail');
      expect(finding.detail).toContain('Max departures per year');
    });

    it('fails on loose text inside a div with no inline sibling at all', () => {
      expect(findingFor('<div class="loading-text">Travel Explorer</div>', bareTextRule).status).toBe('fail');
    });

    it('fails on loose text inside a list item', () => {
      expect(findingFor('<ul><li>Buy milk</li></ul>', bareTextRule).status).toBe('fail');
    });

    it('fails on a heading whose loose run sits beside a child element', () => {
      const html = '<h1>Powering the AI era with <span class="accent">compute</span> built to last.</h1>';
      expect(findingFor(html, bareTextRule).status).toBe('fail');
    });

    it('fails on a paragraph split by <br> (each line becomes bare text)', () => {
      expect(findingFor('<p>Rua de Sao Bento 124<br>Lisbon</p>', bareTextRule).status).toBe('fail');
    });

    it('passes a pure-text heading, paragraph, link and button', () => {
      const html =
        '<h1 class="hero-title">Just a plain title</h1><p class="lead">Body copy.</p>' +
        '<a class="cta" href="/x">Book</a><button class="btn">Send</button>';
      expect(findingFor(html, bareTextRule).status).toBe('pass');
    });

    it('passes when every run is wrapped in its own element', () => {
      const html =
        '<div class="stat"><span class="stat-value">84</span><span class="stat-label">Max departures</span></div>';
      expect(findingFor(html, bareTextRule).status).toBe('pass');
    });

    it('ignores script, style and svg subtrees', () => {
      const html =
        '<head><style>.a{color:red}</style><script>var x = "hello";</script></head>' +
        '<body><svg><text>icon</text></svg><p class="c">ok</p></body>';
      expect(findingFor(html, bareTextRule).status).toBe('pass');
    });
  });

  // Regression: `.stat-item strong { … }` imports as an AMBIENT rule, so editing
  // it restyles every stat block at once — the tenant cannot customise the one
  // element they selected.
  describe('text styled by its own class', () => {
    const selectorRule = 'descendant selector';

    it('fails when a descendant selector styles a class-less text tag', () => {
      const html = '<style>.stat-item strong { font-size: 22px }</style><div class="stat-item"><strong>84</strong></div>';
      const finding = findingFor(html, selectorRule);
      expect(finding.status).toBe('fail');
      expect(finding.detail).toContain('.stat-item strong');
    });

    it('passes when the text element is styled through its own class', () => {
      const html = '<style>.stat-value { font-size: 22px }</style><div class="stat-item"><strong class="stat-value">84</strong></div>';
      expect(findingFor(html, selectorRule).status).toBe('pass');
    });

    it('does not flag bare element selectors (base typography) or pseudo-classes', () => {
      const html = '<style>h1 { margin: 0 } a:hover { color: red } .hero .title { color: red }</style><h1>t</h1><a href="/x">l</a>';
      expect(findingFor(html, selectorRule).status).toBe('pass');
    });
  });

  // Regression: all four stat labels shared `.about-cover-meta-label`, so
  // recolouring one in the CMS recoloured the whole row. Each text element needs
  // a class of its own (unique first) to be individually restyleable.
  describe('every text element has its own unique class', () => {
    const uniqueRule = 'own unique class';

    it('fails when text elements only share a role class', () => {
      const html =
        '<div class="stat"><span class="stat-label">Founded</span><span class="stat-label">Departures</span></div>';
      const finding = findingFor(html, uniqueRule);
      expect(finding.status).toBe('fail');
      expect(finding.detail).toContain('Departures');
    });

    it('passes when each carries a unique class alongside the shared one', () => {
      const html =
        '<div class="stat">' +
        '<span class="stat-label-1 stat-label">Founded</span>' +
        '<span class="stat-label-2 stat-label">Departures</span>' +
        '</div>';
      expect(findingFor(html, uniqueRule).status).toBe('pass');
    });

    it('fails a text element with no class at all', () => {
      expect(findingFor('<p>Body copy.</p>', uniqueRule).status).toBe('fail');
    });

    it('ignores elements that carry no text', () => {
      const html = '<div class="a"><span class="bar"></span><span class="bar"></span></div>';
      expect(findingFor(html, uniqueRule).status).toBe('pass');
    });
  });

  it('summarizes fail/warn counts', () => {
    // The <style> block is required for the external-stylesheet rule to be a
    // FAIL: with no inline CSS at all it downgrades to a warn ("No <style>
    // block found"), which is the share-time normalizer's job to fix, not a
    // hard block. Keep both violations live so this asserts what it claims.
    const html =
      '<head><style>.a{color:#111}</style><link rel="stylesheet" href="a.css"></head><div class="mb-4"></div>';
    const s = summarizeCompliance(checkPageCompliance(html));
    expect(s.fails).toBeGreaterThanOrEqual(2); // tailwind + external css
    expect(typeof s.warns).toBe('number');
  });
});
