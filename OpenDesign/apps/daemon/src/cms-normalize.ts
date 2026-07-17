// Deterministic CMS normalizer.
//
// Runs on the built HTML at the "leaving OpenDesign" boundary (Share-to-CMS push
// and ZIP download) and MECHANICALLY fixes the template-rule violations that can
// be fixed without a model, so compliance no longer depends on the LLM getting
// it right every time:
//
//   1. Inline external CSS/JS  — folds `<link rel=stylesheet href=local.css>` and
//      `<script src=local.js>` into the page and drops the now-orphan file
//      (reuses the existing `inlineRelativeAssets` primitive).
//   2. Remove Tailwind/utility classes — converts each known non-variant utility
//      (e.g. `mb-4`, `text-center`, `flex`, `px-6`) into an equivalent inline
//      `style` declaration and strips the class, preserving appearance. Unknown
//      or variant utilities (`md:flex`, exotic colors) are left in place and
//      REPORTED (the strengthened prompt should make those rare).
//   3. Wrap bare text runs — when a heading/paragraph mixes an inline child
//      (`<span>`/`<strong>`/…) with loose text, each loose run is wrapped in its
//      own `<span>` so every part stays editable in the CMS.
//
// It then runs the compliance checker (cms-compliance.ts) on the result and
// returns a per-page report of anything it could NOT auto-fix (missing `:root`
// tokens, images that aren't real `<img>`). Non-blocking — callers log the
// report; nothing is rejected.
import { load } from 'cheerio';
import {
  inlineRelativeAssets,
  InlineAssetsLimitError,
  type AssetHandle,
  type InlineAssetReader,
} from './inline-assets.js';
import { checkPageCompliance, isUtilityClass, type ComplianceFinding } from './cms-compliance.js';

const HTML_EXT_RE = /\.html?$/i;
const STYLESHEET_LINK_RE = /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet\b[^"'>]*["']?[^>]*>/gi;

export interface NormalizedFile {
  bytes: Uint8Array;
  mimeType?: string | undefined;
}

export interface NormalizeReport {
  /** Per-page compliance findings (post-fix). Keyed by file path. */
  pages: Record<string, ComplianceFinding[]>;
  /** Utility classes that could not be auto-converted (kept in place). */
  unconvertedUtilities: string[];
  /** Local stylesheet files that were inlined into pages and dropped. */
  droppedStylesheets: string[];
  /** Total fail/warn counts across all pages (post-fix). */
  fails: number;
  warns: number;
}

// ---------------------------------------------------------------------------
// Tailwind utility → CSS declaration mapping (non-variant utilities only)
// ---------------------------------------------------------------------------

/** Tailwind spacing scale unit → rem. `4` → `1rem`, `0.5` → `0.125rem`, `0` → `0`. */
function spacing(n: string): string | null {
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  return v === 0 ? '0' : `${v * 0.25}rem`;
}

const SIDE_PROPS: Record<string, (edge: string) => string[]> = {
  '': (e) => [e],
  t: (e) => [`${e}-top`],
  r: (e) => [`${e}-right`],
  b: (e) => [`${e}-bottom`],
  l: (e) => [`${e}-left`],
  x: (e) => [`${e}-left`, `${e}-right`],
  y: (e) => [`${e}-top`, `${e}-bottom`],
};

const FONT_SIZE: Record<string, string> = {
  xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem',
  '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem', '5xl': '3rem',
  '6xl': '3.75rem', '7xl': '4.5rem', '8xl': '6rem', '9xl': '8rem',
};
const FONT_WEIGHT: Record<string, string> = {
  thin: '100', extralight: '200', light: '300', normal: '400', medium: '500',
  semibold: '600', bold: '700', extrabold: '800', black: '900',
};
const RADIUS: Record<string, string> = {
  none: '0', sm: '0.125rem', DEFAULT: '0.25rem', md: '0.375rem', lg: '0.5rem',
  xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px',
};
const SHADOW: Record<string, string> = {
  sm: '0 1px 2px 0 rgba(0,0,0,0.05)',
  DEFAULT: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
  md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
  '2xl': '0 25px 50px -12px rgba(0,0,0,0.25)',
  none: 'none',
};
const ALIGN_ITEMS: Record<string, string> = {
  start: 'flex-start', end: 'flex-end', center: 'center', baseline: 'baseline', stretch: 'stretch',
};
const JUSTIFY: Record<string, string> = {
  start: 'flex-start', end: 'flex-end', center: 'center',
  between: 'space-between', around: 'space-around', evenly: 'space-evenly',
};
// Common neutral colors that leak most often. Full palette intentionally not
// exhaustive — brand colors come from the design system, so non-neutral color
// utility leaks are rare and get reported instead.
const COLORS: Record<string, string> = {
  white: '#ffffff', black: '#000000', transparent: 'transparent', current: 'currentColor',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db',
  'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151',
  'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155',
  'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
};

/**
 * Map a single NON-variant Tailwind utility class to CSS declarations
 * (`prop:value` array), or null when it isn't a utility we can safely convert.
 */
export function utilityToDeclarations(cls: string): string[] | null {
  if (cls.includes(':')) return null; // responsive/state variant — can't inline

  // margin / padding: [mp][xytblr]?-N
  let m = cls.match(/^([mp])([xytblr]?)-(\d+(?:\.\d+)?)$/);
  if (m) {
    const val = spacing(m[3] ?? '');
    if (val == null) return null;
    const edge = m[1] === 'm' ? 'margin' : 'padding';
    const sideFn = SIDE_PROPS[m[2] ?? ''];
    return sideFn ? sideFn(edge).map((p: string) => `${p}:${val}`) : null;
  }
  // gap
  m = cls.match(/^gap(-[xy])?-(\d+(?:\.\d+)?)$/);
  if (m) {
    const val = spacing(m[2] ?? '');
    if (val == null) return null;
    if (m[1] === '-x') return [`column-gap:${val}`];
    if (m[1] === '-y') return [`row-gap:${val}`];
    return [`gap:${val}`];
  }
  // width / height
  m = cls.match(/^([wh])-(\d+(?:\.\d+)?)$/);
  if (m) {
    const val = spacing(m[2] ?? '');
    if (val == null) return null;
    return [`${m[1] === 'w' ? 'width' : 'height'}:${val}`];
  }

  switch (cls) {
    // display
    case 'block': case 'inline-block': case 'inline': case 'flex':
    case 'inline-flex': case 'grid': case 'inline-grid': case 'table':
      return [`display:${cls}`];
    case 'hidden': return ['display:none'];
    // position
    case 'relative': case 'absolute': case 'fixed': case 'sticky': case 'static':
      return [`position:${cls}`];
    // flex
    case 'flex-row': return ['flex-direction:row'];
    case 'flex-col': return ['flex-direction:column'];
    case 'flex-wrap': return ['flex-wrap:wrap'];
    case 'flex-nowrap': return ['flex-wrap:nowrap'];
    case 'flex-1': return ['flex:1 1 0%'];
    case 'flex-auto': return ['flex:1 1 auto'];
    case 'flex-none': return ['flex:none'];
    case 'grow': return ['flex-grow:1'];
    case 'shrink': return ['flex-shrink:1'];
    // sizing shortcuts
    case 'w-full': return ['width:100%'];
    case 'h-full': return ['height:100%'];
    case 'w-screen': return ['width:100vw'];
    case 'h-screen': return ['height:100vh'];
    case 'min-h-screen': return ['min-height:100vh'];
    case 'max-w-full': return ['max-width:100%'];
    case 'mx-auto': return ['margin-left:auto', 'margin-right:auto'];
    // text align
    case 'text-left': case 'text-right': case 'text-center': case 'text-justify':
      return [`text-align:${cls.slice(5)}`];
    // text transform / style / decoration
    case 'uppercase': case 'lowercase': case 'capitalize':
      return [`text-transform:${cls}`];
    case 'italic': return ['font-style:italic'];
    case 'not-italic': return ['font-style:normal'];
    case 'underline': return ['text-decoration:underline'];
    case 'line-through': return ['text-decoration:line-through'];
    case 'no-underline': return ['text-decoration:none'];
    case 'rounded': return [`border-radius:${RADIUS.DEFAULT}`];
    case 'shadow': return [`box-shadow:${SHADOW.DEFAULT}`];
    case 'border': return ['border-width:1px', 'border-style:solid'];
    default: break;
  }

  // font-size
  m = cls.match(/^text-(xs|sm|base|lg|xl|\dxl)$/);
  if (m) { const v = FONT_SIZE[m[1] ?? '']; if (v) return [`font-size:${v}`]; }
  // font-weight
  m = cls.match(/^font-(\w+)$/);
  if (m) { const v = FONT_WEIGHT[m[1] ?? '']; if (v) return [`font-weight:${v}`]; }
  // align-items / justify-content / align-self
  m = cls.match(/^items-(\w+)$/);
  if (m) { const v = ALIGN_ITEMS[m[1] ?? '']; if (v) return [`align-items:${v}`]; }
  m = cls.match(/^justify-(\w+)$/);
  if (m) { const v = JUSTIFY[m[1] ?? '']; if (v) return [`justify-content:${v}`]; }
  m = cls.match(/^self-(\w+)$/);
  if (m) { const v = ALIGN_ITEMS[m[1] ?? '']; if (v) return [`align-self:${v}`]; }
  // border-radius variants
  m = cls.match(/^rounded-(\w+)$/);
  if (m) { const v = RADIUS[m[1] ?? '']; if (v) return [`border-radius:${v}`]; }
  // box-shadow variants
  m = cls.match(/^shadow-(\w+)$/);
  if (m) { const v = SHADOW[m[1] ?? '']; if (v) return [`box-shadow:${v}`]; }
  // opacity
  m = cls.match(/^opacity-(\d+)$/);
  if (m) return [`opacity:${Number(m[1] ?? '0') / 100}`];
  // colors: text-* / bg-* / border-*
  m = cls.match(/^(text|bg|border)-(.+)$/);
  if (m) {
    const v = COLORS[m[2] ?? ''];
    if (v) {
      const prop = m[1] === 'text' ? 'color' : m[1] === 'bg' ? 'background-color' : 'border-color';
      return [`${prop}:${v}`];
    }
  }

  return null; // known-utility-shaped but unmapped → report, don't guess
}

// ---------------------------------------------------------------------------
// DOM transforms (cheerio)
// ---------------------------------------------------------------------------

const INLINE_CHILD_SELECTOR = 'span,strong,em,b,i,a';

/** Merge extra `prop:value` decls into an existing inline style string. */
function mergeStyle(existing: string | undefined, decls: string[]): string {
  const base = (existing ?? '').trim().replace(/;\s*$/, '');
  const add = decls.join('; ');
  return base ? `${base}; ${add}` : add;
}

type CheerioRoot = ReturnType<typeof load>;

/**
 * Convert known non-variant Tailwind utilities on every element into inline
 * `style` declarations and strip them from `class`. Returns the utility tokens
 * that could not be converted (left in place for the report).
 */
function convertUtilityClasses($: CheerioRoot): string[] {
  const unconverted = new Set<string>();
  $('[class]').each((_i, el) => {
    const element = el as unknown as { attribs?: Record<string, string> };
    const raw = element.attribs?.class ?? '';
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;

    const keep: string[] = [];
    const decls: string[] = [];
    for (const tok of tokens) {
      if (!isUtilityClass(tok)) { keep.push(tok); continue; }
      const d = utilityToDeclarations(tok);
      if (d) decls.push(...d);
      else { keep.push(tok); unconverted.add(tok); }
    }
    if (decls.length === 0) return; // nothing converted on this element

    const $el = $(el);
    if (keep.length > 0) $el.attr('class', keep.join(' '));
    else $el.removeAttr('class');
    $el.attr('style', mergeStyle($el.attr('style'), decls));
  });
  return [...unconverted];
}

/**
 * Strip serve-time artifacts that OpenDesign's preview `/raw/` endpoint injects
 * and that can get saved back into a project file: the `MutationObserver`
 * asset-rewrite bridge `<script>`, and `public/`-prefixed asset `src`s (the
 * preview rewrites `/x` → `public/x`). Restores the canonical web-root form
 * (`/images/x`) so the CMS importer resolves each asset to its file. A no-op on
 * a clean, template-compliant page — this is a safety net for already-polluted
 * pages; the real fix is loading the editor source untransformed.
 */
function stripServeTimeArtifacts($: CheerioRoot): void {
  // 1. Remove the injected asset-rewrite bridge script (inline, no src). Its
  //    fingerprint — MutationObserver + attributeFilter + the `public/` rewrite —
  //    is specific enough that no authored page script matches.
  $('script:not([src])').each((_i, el) => {
    const code = $(el).text()
    if (code.includes('MutationObserver') && code.includes('attributeFilter') && code.includes('public/')) {
      $(el).remove()
    }
  })
  // 2. Revert `public/`-prefixed src attributes to their web-root form.
  $('[src]').each((_i, el) => {
    const src = ($(el) as unknown as { attr(name: string): string | undefined }).attr('src') ?? ''
    if (src.startsWith('public/')) $(el).attr('src', `/${src.slice('public/'.length)}`)
  })
}

/** Revert `url(public/…)` CSS refs (inline `style` + `<style>`) to web-root form. */
function normalizeWebRootCssUrls(html: string): string {
  return html.replace(/url\(\s*(['"]?)public\//gi, 'url($1/')
}

/** True when a declaration block is a full-viewport opaque overlay (a JS-dismissed loading screen). */
function isOverlayDecls(d: string): boolean {
  if (!/position\s*:\s*(?:fixed|absolute)/.test(d)) return false;
  const fullViewport =
    /inset\s*:\s*0/.test(d) ||
    (/width\s*:\s*100vw/.test(d) && /height\s*:\s*100vh/.test(d)) ||
    (/top\s*:\s*0/.test(d) &&
      /left\s*:\s*0/.test(d) &&
      (/right\s*:\s*0/.test(d) || /width\s*:\s*100(?:vw|%)/.test(d)) &&
      (/bottom\s*:\s*0/.test(d) || /height\s*:\s*100(?:vh|%)/.test(d)));
  if (!fullViewport) return false;
  if (!/z-index\s*:\s*\d/.test(d)) return false;
  const bg = d.match(/background(?:-color)?\s*:\s*([^;]+)/);
  return !!bg && !/transparent|rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(bg[1] ?? '');
}

/**
 * Make a page's content visible with CSS alone — for the CMS-bound copy ONLY.
 * The Instatic importer strips every `<script>` from the editing canvas, so any
 * content hidden until JS runs (a JS-dismissed loading overlay, or `opacity:0`
 * content revealed by a JS-toggled class / entrance animation) renders BLANK in
 * the canvas even though it shows on the published site. This injects a small
 * override `<style>` so the settled, visible state is the DEFAULT:
 *   • a full-viewport opaque loading overlay → `display:none` (it's already
 *     purely a loading flourish; the real content sits underneath);
 *   • in-flow `opacity:0` / `visibility:hidden` content → forced visible.
 * Skips interaction states (`:hover/:focus/:active/:checked/:target`), stacked
 * `position:absolute|fixed` layers (carousel slides, hover overlays — forcing
 * those visible would stack them), and `@keyframes` internals. OD's own source
 * is untouched, so the OD preview keeps its JS loading + scroll animations.
 */
function makeVisibleWithoutJs(html: string): string {
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '').join('\n');
  if (!styleBlocks.trim()) return html;
  // Strip comments (so a `/* … */` doesn't bleed into a captured selector), then
  // drop @keyframes so their internal `0%{opacity:0}` isn't treated as a base rule.
  const css = styleBlocks
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/gi, '');
  const overrides: string[] = [];
  const seen = new Set<string>();

  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim();
    const decls = (m[2] ?? '').toLowerCase();
    if (!selector || selector.startsWith('@')) continue; // skip @media/@supports headers

    if (isOverlayDecls(decls)) {
      if (seen.has(`o:${selector}`)) continue;
      seen.add(`o:${selector}`);
      overrides.push(`${selector}{display:none !important;}`);
      continue;
    }

    const hidden =
      /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)/.test(decls) ||
      /(?:^|;)\s*visibility\s*:\s*hidden/.test(decls);
    if (!hidden) continue;
    if (/:hover|:focus|:active|:checked|:target/i.test(selector)) continue; // interaction state
    if (/position\s*:\s*(?:absolute|fixed)/.test(decls)) continue; // stacked slide / overlay
    if (seen.has(`r:${selector}`)) continue;
    seen.add(`r:${selector}`);
    const resetTransform = /(?:^|;)\s*transform\s*:/.test(decls) ? 'transform:none !important;' : '';
    overrides.push(`${selector}{opacity:1 !important;visibility:visible !important;${resetTransform}}`);
  }

  if (!overrides.length) return html;
  const style = `<style data-od-cms-visible="1">/* OD: content visible without JS for CMS import */\n${overrides.join('\n')}\n</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${style}</body>`);
  return html + style;
}

/**
 * Wrap bare text runs that sit next to an inline element inside a heading or
 * paragraph, so every part stays an editable Text node in the CMS.
 */
function wrapBareText($: CheerioRoot): void {
  $('h1,h2,h3,h4,h5,h6,p').each((_i, el) => {
    const $el = $(el);
    if ($el.children(INLINE_CHILD_SELECTOR).length === 0) return; // pure text → leave
    $el.contents().each((_j, node) => {
      const n = node as unknown as { type?: string; data?: string };
      if (n.type === 'text' && n.data && n.data.trim().length > 0) {
        const span = $('<span></span>');
        span.text(n.data);
        $(node).replaceWith(span);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Page-level normalize
// ---------------------------------------------------------------------------

export interface NormalizeHtmlResult {
  html: string;
  unconverted: string[];
  findings: ComplianceFinding[];
}

/**
 * Normalize one page's HTML: inline local CSS/JS, convert utility classes, wrap
 * bare text, then check compliance. `fileReader` resolves sibling assets for
 * inlining (returns null to skip).
 */
export async function normalizeHtmlForCms(
  html: string,
  ownerFileName: string,
  fileReader: InlineAssetReader,
): Promise<NormalizeHtmlResult> {
  let out = html;
  try {
    out = await inlineRelativeAssets(html, ownerFileName, fileReader);
  } catch (err) {
    // On a size-cap hit, keep the un-inlined HTML rather than fail the export.
    if (!(err instanceof InlineAssetsLimitError)) throw err;
  }

  // Preserve a leading doctype across cheerio round-trip (cheerio keeps it, but
  // guard defensively for exotic inputs).
  const doctype = out.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? '';

  const $ = load(out);
  stripServeTimeArtifacts($);
  const unconverted = convertUtilityClasses($);
  wrapBareText($);
  let result = $.html();
  result = normalizeWebRootCssUrls(result);
  // Make the CMS-bound copy visible without JS (the importer strips scripts from
  // the editing canvas). OD's source is untouched — this only affects the share.
  result = makeVisibleWithoutJs(result);
  if (doctype && !/^\s*<!doctype/i.test(result)) result = `${doctype}\n${result}`;

  const findings = checkPageCompliance(result);
  return { html: result, unconverted, findings };
}

// ---------------------------------------------------------------------------
// File-map normalize (used by both export boundaries)
// ---------------------------------------------------------------------------

function bytesReader(files: Record<string, NormalizedFile>): InlineAssetReader {
  return async (relPath: string): Promise<AssetHandle | null> => {
    const entry = files[relPath];
    if (!entry) return null;
    const buf = Buffer.from(entry.bytes);
    const content = buf.toString('utf8');
    return { size: buf.byteLength, read: async () => content };
  };
}

/** Collect the local stylesheet hrefs referenced by a page (relative only). */
function referencedLocalStylesheets(html: string, ownerFileName: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(STYLESHEET_LINK_RE)) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    if (/^(?:https?:|data:|blob:|\/\/|\/)/i.test(href)) continue; // external / absolute
    // resolve relative to the page directory
    const dir = ownerFileName.includes('/') ? ownerFileName.slice(0, ownerFileName.lastIndexOf('/') + 1) : '';
    try {
      const url = new URL(href, `https://od.local/${dir}`);
      out.push(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    } catch { /* skip unparseable href */ }
  }
  return out;
}

const isHtmlEntry = (path: string, mime?: string) =>
  mime === 'text/html' || HTML_EXT_RE.test(path);

/**
 * Normalize every HTML page in a file map in place: inline local CSS, convert
 * utilities, wrap text, and DROP any local stylesheet that got inlined into all
 * referencing pages. Returns the new map plus a report.
 */
export async function normalizeFileMap(
  files: Record<string, NormalizedFile>,
): Promise<{ files: Record<string, NormalizedFile>; report: NormalizeReport }> {
  const reader = bytesReader(files);
  const out: Record<string, NormalizedFile> = { ...files };
  const report: NormalizeReport = {
    pages: {},
    unconvertedUtilities: [],
    droppedStylesheets: [],
    fails: 0,
    warns: 0,
  };
  const unconverted = new Set<string>();
  const referencedCss = new Set<string>();

  for (const [path, entry] of Object.entries(files)) {
    if (!isHtmlEntry(path, entry.mimeType)) continue;
    const html = Buffer.from(entry.bytes).toString('utf8');
    for (const css of referencedLocalStylesheets(html, path)) referencedCss.add(css);
    const res = await normalizeHtmlForCms(html, path, reader);
    out[path] = { bytes: Buffer.from(res.html, 'utf8'), mimeType: entry.mimeType ?? 'text/html' };
    report.pages[path] = res.findings;
    for (const u of res.unconverted) unconverted.add(u);
    for (const f of res.findings) {
      if (f.status === 'fail') report.fails++;
      else if (f.status === 'warn') report.warns++;
    }
  }

  // Drop stylesheets that were inlined (only when the file is local CSS in the map).
  for (const css of referencedCss) {
    if (out[css] && /\.css$/i.test(css)) {
      delete out[css];
      report.droppedStylesheets.push(css);
    }
  }

  report.unconvertedUtilities = [...unconverted];
  return { files: out, report };
}

/**
 * Push-path adapter: normalize a base64 site-file map (the shape
 * `collectSiteFiles` returns and the Instatic import endpoint expects).
 */
export async function normalizeSiteFiles(
  files: Record<string, { base64: string; mimeType?: string }>,
): Promise<{ files: Record<string, { base64: string; mimeType?: string }>; report: NormalizeReport }> {
  const byteMap: Record<string, NormalizedFile> = {};
  for (const [path, entry] of Object.entries(files)) {
    byteMap[path] = { bytes: Buffer.from(entry.base64, 'base64'), mimeType: entry.mimeType };
  }
  const { files: normalized, report } = await normalizeFileMap(byteMap);
  const outFiles: Record<string, { base64: string; mimeType?: string }> = {};
  for (const [path, entry] of Object.entries(normalized)) {
    const base64 = Buffer.from(entry.bytes).toString('base64');
    outFiles[path] = entry.mimeType === undefined ? { base64 } : { base64, mimeType: entry.mimeType };
  }
  return { files: outFiles, report };
}
