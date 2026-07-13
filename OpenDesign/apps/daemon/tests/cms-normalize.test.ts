import { describe, expect, it } from 'vitest';

import {
  normalizeSiteFiles,
  normalizeHtmlForCms,
  utilityToDeclarations,
} from '../src/cms-normalize.js';
import type { AssetHandle } from '../src/inline-assets.js';

const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const dec = (b: string) => Buffer.from(b, 'base64').toString('utf8');
const noReader = async (): Promise<AssetHandle | null> => null;

describe('cms-normalize — utilityToDeclarations', () => {
  it('maps spacing, display, flex, text utilities', () => {
    expect(utilityToDeclarations('mb-4')).toEqual(['margin-bottom:1rem']);
    expect(utilityToDeclarations('px-6')).toEqual(['padding-left:1.5rem', 'padding-right:1.5rem']);
    expect(utilityToDeclarations('flex')).toEqual(['display:flex']);
    expect(utilityToDeclarations('items-center')).toEqual(['align-items:center']);
    expect(utilityToDeclarations('text-center')).toEqual(['text-align:center']);
    expect(utilityToDeclarations('font-bold')).toEqual(['font-weight:700']);
  });
  it('returns null for variant / unknown utilities', () => {
    expect(utilityToDeclarations('md:flex')).toBeNull();
    expect(utilityToDeclarations('some-exotic-thing')).toBeNull();
  });
});

describe('cms-normalize — normalizeHtmlForCms', () => {
  it('converts non-variant utilities to inline style and strips them from class', async () => {
    const html = '<div class="wrap flex items-center px-6"><p>x</p></div>';
    const { html: out } = await normalizeHtmlForCms(html, 'index.html', noReader);
    expect(out).toContain('class="wrap"');
    expect(out).not.toMatch(/class="[^"]*\bflex\b/);
    expect(out).toContain('display:flex');
    expect(out).toContain('align-items:center');
    expect(out).toContain('padding-left:1.5rem');
  });

  it('leaves and reports variant utilities it cannot inline', async () => {
    const html = '<div class="card md:flex">x</div>';
    const { html: out, unconverted } = await normalizeHtmlForCms(html, 'index.html', noReader);
    expect(out).toContain('md:flex');
    expect(unconverted).toContain('md:flex');
  });

  it('wraps bare text runs beside an inline element', async () => {
    const html = '<h1>Welcome to <span class="accent">Acme</span> today</h1>';
    const { html: out } = await normalizeHtmlForCms(html, 'index.html', noReader);
    expect(out).toContain('<span>Welcome to </span>');
    expect(out).toContain('<span class="accent">Acme</span>');
    expect(out).toContain('<span> today</span>');
  });

  it('leaves a pure-text heading as a single node', async () => {
    const html = '<h1>Just a plain title</h1>';
    const { html: out } = await normalizeHtmlForCms(html, 'index.html', noReader);
    expect(out).toContain('<h1>Just a plain title</h1>');
  });
});

describe('cms-normalize — normalizeSiteFiles', () => {
  it('inlines a local stylesheet and drops it from the map', async () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><p>hi there</p></body></html>';
    const css = '.hero{color:#e11}';
    const { files, report } = await normalizeSiteFiles({
      'index.html': { base64: enc(html), mimeType: 'text/html' },
      'styles.css': { base64: enc(css), mimeType: 'text/css' },
    });
    const outHtml = dec(files['index.html']!.base64);
    expect(files['styles.css']).toBeUndefined(); // dropped
    expect(report.droppedStylesheets).toContain('styles.css');
    expect(outHtml).toContain('<style');
    expect(outHtml).toContain('.hero{color:#e11}');
    expect(outHtml).not.toMatch(/<link[^>]+href="styles\.css"/);
  });

  it('keeps a Google Fonts link untouched', async () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>.a{}</style></head><body><p>hello world</p></body></html>';
    const { files } = await normalizeSiteFiles({ 'index.html': { base64: enc(html), mimeType: 'text/html' } });
    expect(dec(files['index.html']!.base64)).toContain('fonts.googleapis.com');
  });

  it('produces a page with 0 Tailwind/CSS fails after normalize', async () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body>' +
      '<h1 class="title text-center mb-4">A <span class="accent">B</span> C</h1>' +
      '<p>Enough body text here to satisfy the static-content heuristic comfortably.</p>' +
      '</body></html>';
    const { files, report } = await normalizeSiteFiles({
      'index.html': { base64: enc(html), mimeType: 'text/html' },
      's.css': { base64: enc('.title{font-size:2rem}.accent{color:#e11}'), mimeType: 'text/css' },
    });
    void files;
    const findings = report.pages['index.html']!;
    const tailwind = findings.find((f) => f.rule.includes('Tailwind'))!;
    const cssInline = findings.find((f) => f.rule.includes('CSS inline'))!;
    expect(tailwind.status).toBe('pass');
    expect(cssInline.status).toBe('pass');
  });
});
