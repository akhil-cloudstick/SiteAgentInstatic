import { describe, expect, it } from 'vitest';

import {
  checkCrossPageChromeConsistency,
  extractElement,
  normalizeChrome,
} from '../src/cms-consistency.js';

const HEADER = '<header class="site-head"><a href="/">Brand</a></header>';
const FOOTER = '<footer class="site-foot"><p>© Brand</p></footer>';
const NAV = (active: string) =>
  `<nav class="nav"><a href="/"${active === 'home' ? ' class="active"' : ''}>Home</a>` +
  `<a href="/blog"${active === 'blog' ? ' class="active"' : ''}>Blog</a></nav>`;

const page = (nav: string, body: string, header = HEADER, footer = FOOTER) =>
  `<!doctype html><html><body>${header}${nav}<main>${body}</main>${footer}</body></html>`;

describe('cms-consistency — extractElement', () => {
  it('extracts a balanced top-level element', () => {
    expect(extractElement('<x><header>a</header></x>', 'header')).toBe('<header>a</header>');
  });
  it('balances same-tag nesting', () => {
    const html = '<nav><nav>inner</nav>outer</nav>tail';
    expect(extractElement(html, 'nav')).toBe('<nav><nav>inner</nav>outer</nav>');
  });
  it('returns null when absent', () => {
    expect(extractElement('<div>no chrome</div>', 'footer')).toBeNull();
  });
});

describe('cms-consistency — normalizeChrome', () => {
  it('ignores active-state class differences', () => {
    expect(normalizeChrome(NAV('home'))).toBe(normalizeChrome(NAV('blog')));
  });
  it('canonicalizes a same-page anchor to page.html#frag (matches cross-page links)', () => {
    const onIndex = '<nav><a href="#visit">Visit</a></nav>';
    const onShop = '<nav><a href="index.html#visit">Visit</a></nav>';
    expect(normalizeChrome(onIndex, 'index.html')).toBe(normalizeChrome(onShop, 'shop.html'));
  });
  it('leaves a bare "#" link untouched (no fragment to canonicalize)', () => {
    expect(normalizeChrome('<a href="#">Top</a>', 'index.html')).toBe(
      normalizeChrome('<a href="#">Top</a>', 'shop.html'),
    );
  });
});

describe('cms-consistency — same-page vs cross-page links', () => {
  const chrome = (visitHref: string, mugsHref: string) =>
    `<header><nav><a href="${visitHref}">Visit</a><a href="${mugsHref}">Mugs</a></nav></header>` +
    `<main>body</main><footer><a href="${mugsHref}">Shop</a></footer>`;
  it('passes when pages differ only by same-page vs cross-page link form', () => {
    const pages = [
      // index.html links to its own #visit and to shop.html#mugs
      { path: 'index.html', html: chrome('#visit', 'shop.html#mugs') },
      // shop.html links to index.html#visit and its own #mugs
      { path: 'shop.html', html: chrome('index.html#visit', '#mugs') },
    ];
    expect(checkCrossPageChromeConsistency(pages)).toEqual([]);
  });
  it('still flags a genuinely different header button', () => {
    const withCta = (cta: string) =>
      `<header><nav><a href="index.html#visit">Visit</a></nav><a class="cta" href="shop.html">${cta}</a></header>` +
      `<main>x</main><footer>f</footer>`;
    const pages = [
      { path: 'index.html', html: withCta('Shop the collection') },
      { path: 'shop.html', html: withCta('Book a class') },
    ];
    const v = checkCrossPageChromeConsistency(pages);
    expect(v.some((x) => x.part === 'header')).toBe(true);
  });
});

describe('cms-consistency — checkCrossPageChromeConsistency', () => {
  it('passes when chrome matches (only active link differs)', () => {
    const pages = [
      { path: 'index.html', html: page(NAV('home'), 'home') },
      { path: 'blog.html', html: page(NAV('blog'), 'blog') },
    ];
    expect(checkCrossPageChromeConsistency(pages)).toEqual([]);
  });

  it('flags a page with a divergent footer', () => {
    const pages = [
      { path: 'index.html', html: page(NAV('home'), 'home') },
      {
        path: 'blog.html',
        html: page(NAV('blog'), 'blog', HEADER, '<footer class="other">different</footer>'),
      },
    ];
    const v = checkCrossPageChromeConsistency(pages);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ path: 'blog.html', part: 'footer' });
  });

  it('does not flag a page that simply omits a part', () => {
    const pages = [
      { path: 'index.html', html: page(NAV('home'), 'home') },
      { path: 'landing.html', html: `<!doctype html><html><body><main>x</main></body></html>` },
    ];
    expect(checkCrossPageChromeConsistency(pages)).toEqual([]);
  });

  it('compares against index.html as canonical regardless of order', () => {
    const pages = [
      { path: 'blog.html', html: page(NAV('blog'), 'blog', '<header class="drift">x</header>') },
      { path: 'index.html', html: page(NAV('home'), 'home') },
    ];
    const v = checkCrossPageChromeConsistency(pages);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ path: 'blog.html', part: 'header' });
  });

  it('is a no-op for a single-page site', () => {
    expect(
      checkCrossPageChromeConsistency([{ path: 'index.html', html: page(NAV('home'), 'x') }]),
    ).toEqual([]);
  });
});
