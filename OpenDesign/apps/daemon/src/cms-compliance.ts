// Template-rule compliance checker (TypeScript port of
// Operator/rules/check-template-rule.mjs).
//
// Given a single page's HTML, returns a per-rule finding list. Used after the
// deterministic normalizer (cms-normalize.ts) to REPORT anything that could not
// be auto-fixed (e.g. missing `:root` color tokens, images that aren't real
// `<img>` tags). Non-blocking: this only produces findings; callers log them.
//
// The heuristics mirror the standalone checker so the two agree. Keep them in
// sync when either changes.

export type ComplianceStatus = 'pass' | 'fail' | 'warn';

export interface ComplianceFinding {
  /** Short rule label. */
  rule: string;
  status: ComplianceStatus;
  /** Optional human-readable detail (offending snippet / count). */
  detail?: string;
}

export interface ComplianceSummary {
  fails: number;
  warns: number;
  findings: ComplianceFinding[];
}

// High-signal Tailwind / utility-class detector. Matches a single class token
// that is unambiguously a utility (colored bg/text/border with a palette,
// spacing `[mp][xytblr]?-N`, sizing, flex/grid, text sizes, font weights,
// rounded/shadow), optionally with a responsive/state variant prefix.
const TAILWIND_CLASS_RE =
  /^(?:(?:sm|md|lg|xl|2xl|hover|focus|active|group-hover|dark):)?(?:(?:bg|text|border|from|to|via|ring|divide|placeholder|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?|[mp][xytblr]?-\d+(?:\.\d+)?|-?(?:top|right|bottom|left|inset)-\d+|w-\d+|h-\d+|min-h-screen|min-w-\d+|max-w-\w+|gap(?:-[xy])?-\d+|space-[xy]-\d+|text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify)|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|leading-\d+|tracking-\w+|rounded(?:-\w+)?|shadow(?:-\w+)?|opacity-\d+|flex-(?:row|col|wrap|nowrap|1|auto|none)|items-\w+|justify-\w+|self-\w+|grid-cols-\d+|col-span-\d+|(?:block|flex|grid|hidden|table|inline|inline-block|inline-flex|inline-grid)|(?:relative|absolute|fixed|sticky))$/;

const TAILWIND_RUNTIME_RE = /cdn\.tailwindcss\.com|tailwindcss@|@tailwind\b|@apply\b/i;

/** Extract every class token used in the document. */
function allClassTokens(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class\s*=\s*"([^"]*)"/gi)) {
    for (const tok of (m[1] ?? '').split(/\s+/)) if (tok) out.push(tok);
  }
  return out;
}

/** True when a class token is an unambiguous Tailwind/utility class. */
export function isUtilityClass(token: string): boolean {
  return TAILWIND_CLASS_RE.test(token);
}

const firstLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 100);

/** True when a declaration block is a full-viewport opaque overlay (a JS-dismissed loading screen). */
function isOverlayCss(d: string): boolean {
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
 * Check a single page's HTML against the template rule. Deterministic and
 * side-effect free.
 */
export function checkPageCompliance(html: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const add = (rule: string, status: ComplianceStatus, detail?: string) =>
    findings.push(detail ? { rule, status, detail } : { rule, status });

  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1] ?? '')
    .join('\n');
  const classes = allClassTokens(html);

  // 1) No Tailwind / utility classes.
  const twHits = [...new Set(classes.filter(isUtilityClass))];
  const twRuntime = TAILWIND_RUNTIME_RE.test(html);
  if (twHits.length || twRuntime) {
    add(
      'No Tailwind / utility CSS',
      'fail',
      (twRuntime ? 'Tailwind CDN/@apply present. ' : '') +
        (twHits.length
          ? `Utility classes: ${twHits.slice(0, 8).join(', ')}${twHits.length > 8 ? ` (+${twHits.length - 8})` : ''}`
          : ''),
    );
  } else {
    add('No Tailwind / utility CSS', 'pass');
  }

  // 2) CSS inline in <style>, no external CSS bundle (Google Fonts allowed).
  const extCss = [...html.matchAll(/<link[^>]+rel\s*=\s*"stylesheet"[^>]*>/gi)]
    .map((m) => m[0])
    .filter((l) => /href\s*=\s*"([^"]+)"/i.test(l) && !/fonts\.(googleapis|gstatic)\.com/i.test(l));
  if (!styleBlocks.trim()) add('CSS inline in <style>', 'warn', 'No <style> block found');
  else if (extCss.length) add('CSS inline in <style>', 'fail', `External stylesheet: ${firstLine(extCss[0] ?? '')}`);
  else add('CSS inline in <style>', 'pass');

  // 3) Brand colors as :root custom properties.
  const hasRoot = /:root\s*\{[^}]*--[\w-]+\s*:/.test(styleBlocks);
  const rawHex = (styleBlocks.replace(/:root\s*\{[^}]*\}/g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  if (hasRoot) add('Brand colors as :root tokens', rawHex > 12 ? 'warn' : 'pass', rawHex > 12 ? `${rawHex} raw hex outside :root` : undefined);
  else add('Brand colors as :root tokens', 'warn', 'No :root custom properties found');

  // 4) Fonts — no @fontsource, external font links must be Google Fonts.
  const fontLinks = [...html.matchAll(/<link[^>]+href\s*=\s*"([^"]+)"[^>]*>/gi)]
    .map((m) => m[1] ?? '')
    .filter((h) => /fonts?|typekit|font-?source/i.test(h));
  const badFont = fontLinks.find((h) => !/fonts\.(googleapis|gstatic)\.com/i.test(h) && /font/i.test(h));
  if (/@fontsource/i.test(html)) add('Fonts (Google link / self-host)', 'fail', '@fontsource import found');
  else if (badFont) add('Fonts (Google link / self-host)', 'warn', `Non-Google font CDN: ${firstLine(badFont)}`);
  else add('Fonts (Google link / self-host)', 'pass');

  // 5) Real static HTML, not an empty SPA hydration root.
  const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html;
  const bodyText = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const emptyRoot = /<div[^>]+id\s*=\s*"(root|app|__next)"\s*>\s*<\/div>/i.test(html);
  if (emptyRoot && bodyText.length < 200) add('Real static HTML (no SPA root)', 'fail', 'Empty hydration root + little text');
  else if (bodyText.length < 60) add('Real static HTML (no SPA root)', 'warn', `Very little static text (${bodyText.length} chars)`);
  else add('Real static HTML (no SPA root)', 'pass');

  // 6) No hashed / build-time asset imports.
  const hashed = html.match(
    /(?:\/_astro\/|\/assets\/[\w-]+-[0-9a-f]{8})[\w./-]*|import\s+\w+\s+from\s+['"]\.[^'"]+\.(?:jpg|png|svg|webp|css)['"]/i,
  );
  add('No hashed/build asset imports', hashed ? 'fail' : 'pass', hashed ? firstLine(hashed[0] ?? '') : undefined);

  // 7) (retired) `data-sa` markers — the Instatic importer does not read a
  // `data-sa` attribute anywhere; editability comes from the element type
  // (a real <h1>/<p>/<img> becomes an editable block automatically). The old
  // marker rule enforced a no-op convention, so it was removed.

  // 8) No bare text beside an inline element (best-effort heuristic).
  let bareHits = 0;
  for (const m of html.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2] ?? '';
    if (!/<(span|strong|em|b|i|a)\b/i.test(inner)) continue;
    const stripped = inner.replace(/<(span|strong|em|b|i|a)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    if (stripped.replace(/<[^>]+>/g, '').trim().length > 0) bareHits++;
  }
  add('No bare text beside inline element', bareHits ? 'warn' : 'pass', bareHits ? `${bareHits} block(s) mix a wrapped span with loose text` : undefined);

  // 9) No content built by JavaScript at runtime. A <script> without `src`
  // that writes innerHTML/insertAdjacentHTML/outerHTML renders visible
  // content (product lists, cards, dynamic text) after load — the importer
  // only sees the static DOM as delivered, so that content is invisible to
  // it and dropped entirely, not partially imported. Behavioural scripts
  // (menu toggles, the nav active-state pattern) use classList/setAttribute
  // and don't match this.
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? '');
  const CONTENT_INJECTION_RE = /\.innerHTML\s*\+?=|\.insertAdjacentHTML\s*\(|\.outerHTML\s*=/;
  const injectsContent = inlineScripts.some((s) => CONTENT_INJECTION_RE.test(s));
  add(
    'No content built by JavaScript',
    injectsContent ? 'fail' : 'pass',
    injectsContent
      ? 'Inline <script> writes innerHTML/insertAdjacentHTML/outerHTML — visible content must be static HTML, not JS-rendered (see templateRule.md)'
      : undefined,
  );

  // 10) No hardcoded asset paths in JavaScript. On import, static `<img src>`
  // paths are rewritten to the CMS `/uploads/...` path, but the importer never
  // rewrites URLs inside `<script>` text — so a swap/gallery script that
  // assigns a hardcoded `/images/x.svg` to `.src` 404s after import. Any image
  // swap must read the URL from an existing DOM element's already-served `src`
  // instead. Matches a real asset FILE path literal (with extension), so text
  // data and behaviour scripts don't false-trip.
  const JS_ASSET_PATH_RE = /['"`]\/(?:images|assets|img|media|static)\/[^'"`]*\.(?:svg|png|jpe?g|webp|gif|avif)/i;
  const hardcodedAssetInJs = inlineScripts.some((s) => JS_ASSET_PATH_RE.test(s));
  add(
    'No asset paths hardcoded in JavaScript',
    hardcodedAssetInJs ? 'fail' : 'pass',
    hardcodedAssetInJs
      ? 'Inline <script> hardcodes an image path (e.g. /images/x.svg) — it 404s after import (paths are rewritten to /uploads/). Read image URLs from an existing DOM <img> src instead (see templateRule.md)'
      : undefined,
  );

  // 11) No bare modern color function inside a color-bearing shorthand. The
  // importer reads styles back through the browser CSSOM; a modern color
  // function (oklch/oklab/lab/lch/color-mix) inside a `background`/`border`/
  // `outline`/`column-rule` SHORTHAND is dropped during shorthand
  // normalization, so the element loses its color on import (e.g. hero avatar
  // backgrounds vanish). The longhand (`background-color: …`) and `:root` var
  // tokens (`background: var(--token)`) survive. Scans <style> CSS and inline
  // `style="…"` attributes; deliberately does NOT flag the longhand or `color:`
  // (those import correctly).
  const inlineStyleValues = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? '');
  const colorScanCss = [styleBlocks, ...inlineStyleValues].join('\n;\n');
  const MODERN_COLOR_IN_SHORTHAND_RE =
    /(?:^|[;{])\s*(?:background|border(?:-(?:top|right|bottom|left))?|outline|column-rule)\s*:\s*[^;{}]*\b(?:oklch|oklab|lab|lch|color-mix)\s*\(/i;
  const shorthandColorHit = MODERN_COLOR_IN_SHORTHAND_RE.exec(colorScanCss);
  add(
    'No modern color function in a shorthand',
    shorthandColorHit ? 'fail' : 'pass',
    shorthandColorHit
      ? `Modern color function in a shorthand is dropped on import (color lost): ${firstLine(shorthandColorHit[0])} — use a :root var token (background: var(--token)) or the longhand (background-color: …) instead (see templateRule.md)`
      : undefined,
  );

  // 12) No @layer / @page / @namespace. The importer drops the ENTIRE @layer
  // block (and @page/@namespace), so every rule inside is silently lost — a page
  // that relies on @layer (e.g. compiled Tailwind v4) looks different or blank
  // after import.
  const droppedAtRule = /@(?:layer|page|namespace)\b/i.exec(styleBlocks);
  add(
    'No @layer / @page / @namespace',
    droppedAtRule ? 'fail' : 'pass',
    droppedAtRule
      ? `${firstLine(droppedAtRule[0])} is dropped on import — all rules inside a @layer are lost. Write plain, source-ordered CSS (see templateRule.md)`
      : undefined,
  );

  // 13) No unsupported image formats. The importer uploads jpg/png/webp/gif/svg
  // (+ mp4/webm) only; an <img>/<source> pointing at avif/ico/bmp/tiff/heic is
  // not captured and renders broken on the published page.
  const BAD_IMAGE_FMT_RE = /<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*["'][^"']*\.(?:avif|ico|bmp|tiff?|heic)\b/i;
  const badImageFmt = BAD_IMAGE_FMT_RE.exec(html);
  add(
    'No unsupported image formats',
    badImageFmt ? 'fail' : 'pass',
    badImageFmt
      ? `Image uses a format the importer can't upload (avif/ico/bmp/tiff/heic): ${firstLine(badImageFmt[0])} — use jpg/png/webp/gif/svg (see templateRule.md)`
      : undefined,
  );

  // 14) Content visible without JavaScript. The importer strips every <script>
  // from the editing canvas, so content hidden until JS runs — a full-viewport
  // opaque loading overlay, or in-flow opacity:0/visibility:hidden content
  // revealed by a JS-toggled class — renders BLANK in the canvas (fine only on
  // the published site). The share transform (cms-normalize.makeVisibleWithoutJs)
  // normally injects a `data-od-cms-visible` override that neutralizes this;
  // this rule is the net (warn) for anything still hidden after that, and it
  // surfaces the raw pattern when the checker runs on an un-transformed page.
  {
    const overrideBlock = html.match(/<style[^>]*data-od-cms-visible[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? '';
    const cssNoKf = styleBlocks
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/gi, '');
    const stillHidden: string[] = [];
    for (const rm of cssNoKf.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = (rm[1] ?? '').trim();
      const d = (rm[2] ?? '').toLowerCase();
      if (!sel || sel.startsWith('@')) continue;
      const overlay = isOverlayCss(d);
      const revealHidden =
        !overlay &&
        (/(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)/.test(d) || /(?:^|;)\s*visibility\s*:\s*hidden/.test(d)) &&
        !/:hover|:focus|:active|:checked|:target/i.test(sel) &&
        !/position\s*:\s*(?:absolute|fixed)/.test(d);
      if (!overlay && !revealHidden) continue;
      if (overrideBlock.includes(`${sel}{`)) continue; // neutralized by the share transform
      stillHidden.push(sel);
    }
    add(
      'Content visible without JavaScript',
      stillHidden.length ? 'warn' : 'pass',
      stillHidden.length
        ? `Hidden until JS runs → blank in the CMS canvas: ${[...new Set(stillHidden)].slice(0, 5).join(', ')} — content must be visible with CSS alone (see templateRule.md)`
        : undefined,
    );
  }

  return findings;
}

/** Roll up findings into fail/warn counts. */
export function summarizeCompliance(findings: ComplianceFinding[]): ComplianceSummary {
  return {
    fails: findings.filter((f) => f.status === 'fail').length,
    warns: findings.filter((f) => f.status === 'warn').length,
    findings,
  };
}
