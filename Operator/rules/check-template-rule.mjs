#!/usr/bin/env node
// Template-rule compliance checker.
//
// Scans generated HTML page(s) and reports whether they follow the SiteAgent
// "Website Build Rule" (templateRule.md) — the same output contract OD is told
// to follow so pages import into Instatic cleanly and stay editable.
//
// Usage:
//   node Operator/rules/check-template-rule.mjs <file-or-dir> [more...]
//
// Examples:
//   node Operator/rules/check-template-rule.mjs ./index.html
//   node Operator/rules/check-template-rule.mjs "C:/…/siteagent-od/akhil/projects/<id>"
//
// Exit code 0 = every page passed (no FAILs); 1 = at least one FAIL.
// This is a heuristic linter, not a browser — WARN means "look at this",
// FAIL means "this will not import correctly".
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', DIM = '\x1b[2m', BLD = '\x1b[1m', RST = '\x1b[0m';
const tag = (s) => s === 'PASS' ? `${GRN}PASS${RST}` : s === 'FAIL' ? `${RED}FAIL${RST}` : s === 'WARN' ? `${YEL}WARN${RST}` : s;

// Collect .html files from a file or directory (skips dot-dirs like .file-versions).
function collectHtml(target) {
  const st = statSync(target);
  if (st.isFile()) return extname(target).toLowerCase().match(/\.html?$/) ? [target] : [];
  const out = [];
  for (const name of readdirSync(target)) {
    if (name.startsWith('.')) continue;
    const p = join(target, name);
    try {
      const s = statSync(p);
      if (s.isDirectory()) out.push(...collectHtml(p));
      else if (extname(name).toLowerCase().match(/\.html?$/) && !name.endsWith('.bak')) out.push(p);
    } catch { /* skip unreadable */ }
  }
  return out;
}

const firstLine = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 100);

// True when a declaration block is a full-viewport opaque overlay (a JS-dismissed loading screen).
function isOverlayCss(d) {
  if (!/position\s*:\s*(?:fixed|absolute)/.test(d)) return false;
  const fullViewport =
    /inset\s*:\s*0/.test(d) ||
    (/width\s*:\s*100vw/.test(d) && /height\s*:\s*100vh/.test(d)) ||
    (/top\s*:\s*0/.test(d) && /left\s*:\s*0/.test(d) &&
      (/right\s*:\s*0/.test(d) || /width\s*:\s*100(?:vw|%)/.test(d)) &&
      (/bottom\s*:\s*0/.test(d) || /height\s*:\s*100(?:vh|%)/.test(d)));
  if (!fullViewport || !/z-index\s*:\s*\d/.test(d)) return false;
  const bg = d.match(/background(?:-color)?\s*:\s*([^;]+)/);
  return !!bg && !/transparent|rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(bg[1] || '');
}

// ---------------------------------------------------------------------------
// Editable-text scanning (rules 8 + 16). Kept in parity with
// OpenDesign/apps/daemon/src/cms-compliance.ts.
//
// Mirrors HTML_TO_MODULE_RULES / walkAndMap in Instatic's importer:
//   - h1-h6, p, span, small, strong, em, label import as ONE editable text block
//     — but only while they hold no element child. With a child the rule recurses
//     to a container and the loose runs become bare text again.
//   - a, button, option capture their text wholesale and never recurse.
//   - Everything else recurses, so a text node written directly inside it becomes
//     a no-wrapper base.text (tag: 'none'). It renders, but owns NO DOM element —
//     so it can never be clicked on the canvas, never gets a selection ring, and
//     can never carry a class.
// ---------------------------------------------------------------------------

const TEXT_LEAF_WHEN_CHILDLESS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'small', 'strong', 'em', 'label']);
const TEXT_LEAF_ALWAYS = new Set(['a', 'button', 'option']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Subtrees whose text is not tenant-editable page copy.
const SKIP_SUBTREES = new Set(['script', 'style', 'svg', 'math', 'pre', 'code', 'textarea', 'noscript', 'template', 'head', 'title', 'iframe', 'canvas']);

const classesOf = (rawTag) => {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(rawTag);
  return (m?.[1] ?? m?.[2] ?? '').split(/\s+/).filter(Boolean);
};

function closeFrame(frame, scan) {
  if (frame.texts.length === 0) return;
  const ownsItsText = TEXT_LEAF_ALWAYS.has(frame.tag) ||
    (TEXT_LEAF_WHEN_CHILDLESS.has(frame.tag) && !frame.hasElementChild);
  if (ownsItsText) {
    scan.owners.push({ tag: frame.tag, text: frame.texts.join(' '), classes: frame.classes });
    return;
  }
  for (const text of frame.texts) scan.bare.push({ tag: frame.tag, text });
}

// Every significant text run that will import WITHOUT an element of its own.
function findBareText(html) {
  return scanText(html).bare;
}

// Text elements whose every class is shared with another element — editing that
// class in the CMS restyles all of them, so the tenant cannot customise one.
function findTextWithoutUniqueClass(html) {
  const frequency = new Map();
  for (const m of html.matchAll(/<[A-Za-z][^>]*?\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const c of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (c) frequency.set(c, (frequency.get(c) ?? 0) + 1);
    }
  }
  return scanText(html).owners.filter((o) => !o.classes.some((c) => frequency.get(c) === 1));
}

function scanText(html) {
  const scan = { bare: [], owners: [] };
  const hits = scan;
  const stack = [];
  let skipDepth = 0;
  let cursor = 0;
  const pushText = (raw) => {
    if (skipDepth > 0) return;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (stack.length) stack[stack.length - 1].texts.push(text);
  };

  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!/]?[A-Za-z][^>]*>/g;
  let m;
  while ((m = tokens.exec(html)) !== null) {
    pushText(html.slice(cursor, m.index));
    cursor = tokens.lastIndex;
    const raw = m[0];
    if (raw.startsWith('<!')) continue; // comment / doctype / CDATA
    const name = (/^<\/?\s*([A-Za-z][A-Za-z0-9-]*)/.exec(raw)?.[1] || '').toLowerCase();
    if (!name) continue;

    if (raw[1] === '/') {
      if (skipDepth > 0) {
        if (SKIP_SUBTREES.has(name)) skipDepth--;
        continue;
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== name) continue;
        for (let j = stack.length - 1; j >= i; j--) closeFrame(stack[j], hits);
        stack.length = i;
        break;
      }
      continue;
    }

    const selfClosing = raw.endsWith('/>') || VOID_TAGS.has(name);
    if (skipDepth > 0) {
      if (SKIP_SUBTREES.has(name) && !selfClosing) skipDepth++;
      continue;
    }
    // Any open tag makes its parent a container rather than a text leaf.
    if (stack.length) stack[stack.length - 1].hasElementChild = true;
    if (selfClosing) continue;
    if (SKIP_SUBTREES.has(name)) { skipDepth++; continue; }
    stack.push({ tag: name, texts: [], classes: classesOf(raw), hasElementChild: false });
  }
  pushText(html.slice(cursor));
  for (let i = stack.length - 1; i >= 0; i--) closeFrame(stack[i], hits);
  return scan;
}

// Tags that carry tenant-visible copy — the targets rule 16 cares about.
const TEXT_BEARING_TAG_RE = /^(?:h[1-6]|p|span|small|strong|em|b|i|a|li|blockquote|figcaption|td|th|dt|dd)$/;

// Descendant selectors that style a text tag directly (`.card strong`). Those
// import as AMBIENT rules: editing one changes every element it matches instead
// of the single element the tenant selected. Every such selector is reported —
// deciding "does this reach a class-less element?" needs a real DOM matcher we
// don't have here, and a document-wide regex approximation flags a selector
// because of an UNRELATED class-less element, leaving a page that stays red no
// matter what the author fixes. The fix is always the same: give the matched
// elements their own class and move the declarations onto it.
function findDescendantTextSelectors(styleCss, html) {
  const hits = new Set();
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selectorList = rule[1] || '';
    if (selectorList.trim().startsWith('@')) continue;
    for (const rawSelector of selectorList.split(',')) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      // Pseudo-class/element and attribute selectors are ambient by design.
      if (!selector || /[:[]/.test(selector)) continue;
      const parts = selector.replace(/\s*[>+~]\s*/g, ' ').split(' ').filter(Boolean);
      if (parts.length < 2) continue; // a bare element selector is base typography
      const target = parts[parts.length - 1].toLowerCase();
      if (!TEXT_BEARING_TAG_RE.test(target)) continue;
      hits.add(selector);
    }
  }
  return [...hits];
}

// Severity for rule 16 — keep in parity with DESCENDANT_TEXT_SELECTOR_STATUS in
// cms-compliance.ts. Flip to 'WARN' if it proves too noisy on real pages.
const DESCENDANT_TEXT_SELECTOR_STATUS = 'FAIL';

// A page result: [ { rule, status, detail } ]
function checkPage(html) {
  const results = [];
  const add = (rule, status, detail = '') => results.push({ rule, status, detail });

  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const classAttrs = [...html.matchAll(/class\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  const allClasses = classAttrs.flatMap((c) => c.split(/\s+/)).filter(Boolean);

  // 1) No Tailwind — high-signal utility tokens, CDN, or @tailwind/@apply.
  const TW = /^(?:(?:sm|md|lg|xl|2xl|hover|focus|dark):)?(?:bg|text|border|from|to|via)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?$|^(?:(?:sm|md|lg|xl|2xl):)?(?:[mp][xytblr]?-\d|w-\d|h-\d|min-h-screen|max-w-\w+|gap-\d|space-[xy]-\d|text-(?:xs|sm|base|lg|xl|\dxl)|font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)|rounded(?:-\w+)?|shadow(?:-\w+)?|flex-(?:col|row|wrap|nowrap)|items-\w+|justify-\w+|self-\w+|grid-cols-\d|(?:block|flex|grid|hidden|table|inline-block|inline-flex|inline-grid)|(?:relative|absolute|fixed|sticky))$/;
  const twHits = [...new Set(allClasses.filter((c) => TW.test(c)))];
  const twCdn = /cdn\.tailwindcss\.com|tailwindcss@|@tailwind\b|@apply\b/i.test(html);
  if (twHits.length || twCdn) {
    add('No Tailwind / utility CSS', 'FAIL',
      (twCdn ? 'Tailwind CDN/@apply present. ' : '') +
      (twHits.length ? `Utility classes: ${twHits.slice(0, 8).join(', ')}${twHits.length > 8 ? ` …(+${twHits.length - 8})` : ''}` : ''));
  } else {
    add('No Tailwind / utility CSS', 'PASS');
  }

  // 2) Inline CSS, no external CSS bundle (Google Fonts link is allowed).
  const extCss = [...html.matchAll(/<link[^>]+rel\s*=\s*"stylesheet"[^>]*>/gi)].map((m) => m[0])
    .filter((l) => /href\s*=\s*"([^"]+)"/i.test(l) && !/fonts\.(googleapis|gstatic)\.com/i.test(l));
  if (!styleBlocks.trim()) add('CSS inline in <style>', 'WARN', 'No <style> block found — is the CSS inline?');
  else if (extCss.length) add('CSS inline in <style>', 'FAIL', `External stylesheet bundle: ${firstLine(extCss[0])}`);
  else add('CSS inline in <style>', 'PASS');

  // 3) Colors as :root custom properties.
  const hasRoot = /:root\s*\{[^}]*--[\w-]+\s*:/.test(styleBlocks);
  const rawHexInRules = (styleBlocks.replace(/:root\s*\{[^}]*\}/g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  if (hasRoot) add('Brand colors as :root tokens', rawHexInRules > 12 ? 'WARN' : 'PASS',
    rawHexInRules > 12 ? `${rawHexInRules} raw hex colors outside :root — prefer var(--…)` : '');
  else add('Brand colors as :root tokens', 'WARN', 'No :root custom properties found — colors won\'t import as editable tokens');

  // 4) Fonts — no @fontsource, external font links must be Google Fonts.
  const fontLinks = [...html.matchAll(/<link[^>]+href\s*=\s*"([^"]+)"[^>]*>/gi)].map((m) => m[1])
    .filter((h) => /fonts?|typekit|font-?source/i.test(h));
  const badFont = fontLinks.find((h) => !/fonts\.(googleapis|gstatic)\.com/i.test(h) && /font/i.test(h));
  if (/@fontsource/i.test(html)) add('Fonts (Google link / self-host)', 'FAIL', '@fontsource import found — bundled fonts are lost on import');
  else if (badFont) add('Fonts (Google link / self-host)', 'WARN', `Non-Google font CDN: ${firstLine(badFont)}`);
  else add('Fonts (Google link / self-host)', 'PASS');

  // 5) Real static HTML, not an empty SPA hydration root.
  const bodyText = (html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html)
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const emptyRoot = /<div[^>]+id\s*=\s*"(root|app|__next)"\s*>\s*<\/div>/i.test(html);
  if (emptyRoot && bodyText.length < 200) add('Real static HTML (no SPA root)', 'FAIL', 'Empty hydration root + little static text — imports blank');
  else if (bodyText.length < 60) add('Real static HTML (no SPA root)', 'WARN', `Very little static text (${bodyText.length} chars)`);
  else add('Real static HTML (no SPA root)', 'PASS', `${DIM}${bodyText.length} chars of static text${RST}`);

  // 6) No hashed / build-time asset imports.
  const hashed = html.match(/(?:\/_astro\/|\/assets\/[\w-]+\-[0-9a-f]{8})[\w./-]*|import\s+\w+\s+from\s+['"]\.[^'"]+\.(?:jpg|png|svg|webp|css)['"]/i);
  add('No hashed/build asset imports', hashed ? 'FAIL' : 'PASS', hashed ? firstLine(hashed[0]) : '');

  // 7) (retired) data-sa markers — the Instatic importer never reads a data-sa
  // attribute; editability comes from the element type (a real <h1>/<p>/<img>
  // becomes an editable block automatically). The old marker rule enforced a
  // no-op convention, so it was removed.

  // 8) No bare text — every text run must own an element. Text written directly
  // inside a container (a <div>, <li>, <td>, <b>, or a heading that also holds a
  // child element) imports as a no-wrapper text node: it renders, but owns no DOM
  // element, so the tenant can never select it on the canvas, never gets a
  // selection ring, and can never give it a class to style it. Blocking.
  const bareText = findBareText(html);
  if (bareText.length) {
    const unique = [...new Set(bareText.map((h) => `<${h.tag}> "${h.text.slice(0, 40)}${h.text.length > 40 ? '…' : ''}"`))];
    const shown = unique.slice(0, 12);
    add('No bare text (every run owns an element)', 'FAIL',
      `${bareText.length} text run(s) sit directly inside a container, so they import with NO element of their own — ` +
      `the tenant cannot select, highlight or style them at all. Wrap EVERY one in its own element with its own ` +
      `class, e.g. <span class="stat-label">Founded in Lisbon</span>. Remember a heading/paragraph that contains ` +
      `any child element (even a <br> or <span>) stops being one text block, so its loose runs must be wrapped ` +
      `too. Fix every occurrence on the page, not only the examples listed here` +
      `${unique.length > shown.length ? ` (showing ${shown.length} of ${unique.length})` : ''}: ` +
      `${shown.join(', ')} (see templateRule.md)`);
  } else {
    add('No bare text (every run owns an element)', 'PASS');
  }

  // 9) No content built by JavaScript at runtime. A <script> without `src`
  // that writes innerHTML/insertAdjacentHTML/outerHTML renders visible
  // content (product lists, cards, dynamic text) after load — the importer
  // only sees the static DOM as delivered, so that content is invisible to
  // it and dropped entirely, not partially imported. Behavioural scripts
  // (menu toggles, the nav active-state pattern) use classList/setAttribute
  // and don't match this.
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const CONTENT_INJECTION_RE = /\.innerHTML\s*\+?=|\.insertAdjacentHTML\s*\(|\.outerHTML\s*=/;
  const injectsContent = inlineScripts.some((s) => CONTENT_INJECTION_RE.test(s));
  add('No content built by JavaScript', injectsContent ? 'FAIL' : 'PASS',
    injectsContent ? 'Inline <script> writes innerHTML/insertAdjacentHTML/outerHTML — visible content must be static HTML, not JS-rendered (see templateRule.md)' : '');

  // 10) No hardcoded asset paths in JS. Static `<img src>` paths are rewritten
  // to `/uploads/...` on import, but URLs inside `<script>` text are NOT — so a
  // swap script that assigns a hardcoded `/images/x.svg` to `.src` 404s after
  // import. Read image URLs from an existing DOM element's src instead.
  const JS_ASSET_PATH_RE = /['"`]\/(?:images|assets|img|media|static)\/[^'"`]*\.(?:svg|png|jpe?g|webp|gif|avif)/i;
  const hardcodedAssetInJs = inlineScripts.some((s) => JS_ASSET_PATH_RE.test(s));
  add('No asset paths hardcoded in JavaScript', hardcodedAssetInJs ? 'FAIL' : 'PASS',
    hardcodedAssetInJs ? 'Inline <script> hardcodes an image path (e.g. /images/x.svg) — it 404s after import (paths rewrite to /uploads/). Read image URLs from an existing DOM <img> src instead (see templateRule.md)' : '');

  // 11) No bare modern color function inside a color-bearing shorthand. On
  // import the browser CSSOM drops a modern color function (oklch/oklab/lab/lch/
  // color-mix) inside a `background`/`border`/`outline`/`column-rule` SHORTHAND
  // during shorthand normalization, so the element loses its color (e.g. hero
  // avatar backgrounds vanish). The longhand (`background-color: …`) and `:root`
  // var tokens (`background: var(--token)`) survive. Scans <style> CSS + inline
  // `style="…"`; does NOT flag the longhand or `color:` (those import fine).
  const inlineStyleValues = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  const colorScanCss = [styleBlocks, ...inlineStyleValues].join('\n;\n');
  const MODERN_COLOR_IN_SHORTHAND_RE = /(?:^|[;{])\s*(?:background|border(?:-(?:top|right|bottom|left))?|outline|column-rule)\s*:\s*[^;{}]*\b(?:oklch|oklab|lab|lch|color-mix)\s*\(/i;
  const shorthandColorHit = MODERN_COLOR_IN_SHORTHAND_RE.exec(colorScanCss);
  add('No modern color function in a shorthand', shorthandColorHit ? 'FAIL' : 'PASS',
    shorthandColorHit ? `Modern color function in a shorthand is dropped on import (color lost): ${firstLine(shorthandColorHit[0])} — use a :root var token (background: var(--token)) or the longhand (background-color: …) instead (see templateRule.md)` : '');

  // 12) No @layer / @page / @namespace. The importer drops the ENTIRE @layer block
  // (and @page/@namespace) — every rule inside is silently lost (e.g. compiled
  // Tailwind v4). Write plain, source-ordered CSS.
  const droppedAtRule = /@(?:layer|page|namespace)\b/i.exec(styleBlocks);
  add('No @layer / @page / @namespace', droppedAtRule ? 'FAIL' : 'PASS',
    droppedAtRule ? `${firstLine(droppedAtRule[0])} is dropped on import — all rules inside a @layer are lost. Write plain, source-ordered CSS (see templateRule.md)` : '');

  // 13) No unsupported image formats. The importer uploads jpg/png/webp/gif/svg
  // (+ mp4/webm) only; an <img>/<source> pointing at avif/ico/bmp/tiff/heic is not
  // captured and renders broken.
  const BAD_IMAGE_FMT_RE = /<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*["'][^"']*\.(?:avif|ico|bmp|tiff?|heic)\b/i;
  const badImageFmt = BAD_IMAGE_FMT_RE.exec(html);
  add('No unsupported image formats', badImageFmt ? 'FAIL' : 'PASS',
    badImageFmt ? `Image uses a format the importer can't upload (avif/ico/bmp/tiff/heic): ${firstLine(badImageFmt[0])} — use jpg/png/webp/gif/svg (see templateRule.md)` : '');

  // 14) Content visible without JavaScript. The importer strips every <script>
  // from the editing canvas, so content hidden until JS runs — a full-viewport
  // opaque loading overlay, or in-flow opacity:0/visibility:hidden content
  // revealed by a JS-toggled class — renders BLANK in the canvas (fine only on
  // the published site). The share transform (makeVisibleWithoutJs) injects a
  // `data-od-cms-visible` override that neutralizes this; this rule is the net
  // that surfaces anything still hidden (and flags the raw pattern here).
  {
    const overrideBlock = html.match(/<style[^>]*data-od-cms-visible[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';
    const cssNoKf = styleBlocks
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/gi, '');
    const stillHidden = [];
    for (const rm of cssNoKf.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = (rm[1] || '').trim();
      const d = (rm[2] || '').toLowerCase();
      if (!sel || sel.startsWith('@')) continue;
      const overlay = isOverlayCss(d);
      const revealHidden = !overlay &&
        (/(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)/.test(d) || /(?:^|;)\s*visibility\s*:\s*hidden/.test(d)) &&
        !/:hover|:focus|:active|:checked|:target/i.test(sel) &&
        !/position\s*:\s*(?:absolute|fixed)/.test(d);
      if (!overlay && !revealHidden) continue;
      if (overrideBlock.includes(`${sel}{`)) continue;
      stillHidden.push(sel);
    }
    add('Content visible without JavaScript', stillHidden.length ? 'WARN' : 'PASS',
      stillHidden.length ? `Hidden until JS runs → blank in the CMS canvas: ${[...new Set(stillHidden)].slice(0, 5).join(', ')} — content must be visible with CSS alone (see templateRule.md). The share auto-fix normally rewrites this.` : '');
  }

  // 15) Every structural element is named. Instatic names a Layers row from the
  // element's own markup (data-layer → meaningful class → id → aria-label →
  // semantic tag). An element with none of those — or whose only class is layout
  // plumbing (container/wrapper/row/grid) — falls back to the module name, so the
  // tenant's Layers panel reads "Container" for the whole page and the AI editor,
  // which addresses blocks by name, cannot tell the hero from the footer.
  //
  // GENERIC mirrors deriveNodeLabel in Instatic/src/core/htmlImport/nodeLabel.ts.
  // WEAK goes further than the importer does on purpose: the importer will happily
  // display "Reveal"/"Split" because a hook name still beats "Container", but the
  // rule asks OD for a real name, so the checker flags them.
  {
    const GENERIC = new Set(['container', 'wrapper', 'wrap', 'inner', 'outer', 'row', 'col', 'column',
      'columns', 'grid', 'flex', 'box', 'block', 'content', 'item', 'items', 'group', 'stack', 'holder',
      'section', 'div', 'main', 'body', 'area', 'panel', 'left', 'right', 'top', 'bottom', 'center',
      'centre', 'middle', 'clearfix', 'active', 'open', 'closed', 'show', 'hide', 'hidden', 'visible',
      'small', 'large', 'dark', 'light', 'full', 'half']);
    // Animation / layout hooks: they say how a block moves or stacks, not what it is.
    const WEAK = new Set(['reveal', 'fade', 'fadein', 'fade-in', 'animate', 'animated', 'parallax',
      'sticky', 'split', 'track', 'slide', 'scroll', 'marquee-track', 'carousel-track', 'overlay',
      'media', 'copy', 'text', 'inner-wrap', 'card-body']);
    const NAMED_TAGS = /^(?:header|footer|nav|main|aside|section|article|form|figure|figcaption|ul|ol|li|table)$/i;
    const isName = (c) => c.length >= 2 && !GENERIC.has(c.toLowerCase()) && !WEAK.has(c.toLowerCase()) &&
      !/^(?:is|has|js|u|no)-/i.test(c) && !/^_/.test(c) && !/\d/.test(c) && !/[:/[\]]/.test(c);

    const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html;
    const unnamed = [];
    for (const m of body.matchAll(/<(div|section|article|aside|header|footer|nav|main)\b([^>]*)>/gi)) {
      const [, tagName, attrs] = m;
      if (NAMED_TAGS.test(tagName)) continue; // <header>/<section>/… name themselves
      if (/\bdata-layer\s*=|\bid\s*=|\baria-label\s*=/i.test(attrs)) continue;
      const classes = (attrs.match(/class\s*=\s*"([^"]*)"/i)?.[1] || '').split(/\s+/).filter(Boolean);
      if (classes.some(isName)) continue;
      unnamed.push(`<${tagName}${classes.length ? ` class="${classes.join(' ')}"` : ''}>`);
    }
    add('Every block is named (Layers panel)', unnamed.length ? 'WARN' : 'PASS',
      unnamed.length
        ? `${unnamed.length} element(s) have no meaningful name — they import as "Container" and the AI editor can't target them: ${[...new Set(unnamed)].slice(0, 5).join(', ')}. Give each a semantic class (hero, services-grid, service-card) or data-layer="…" (see templateRule.md)`
        : '');
  }

  // 16) Text styled through its own class, not a descendant selector. Only a
  // single bare class imports as an editable rule the tenant can change on ONE
  // element; `.stat-item strong` imports as an ambient rule, so editing it
  // restyles every match at once and per-element customisation is impossible.
  const ambientTextSelectors = findDescendantTextSelectors(styleBlocks, html);
  add('Text styled by its own class (not a descendant selector)',
    ambientTextSelectors.length ? DESCENDANT_TEXT_SELECTOR_STATUS : 'PASS',
    ambientTextSelectors.length
      ? `${ambientTextSelectors.length} rule(s) style a text element through a descendant selector — these import ` +
        `as AMBIENT rules, so editing one changes every element it matches instead of the one the tenant selected. ` +
        `Give each of those text elements its own class and move the declarations onto that class ` +
        `(.stat-value { … }, not .stat-item strong { … }). Fix every one, not only the examples listed here` +
        `${ambientTextSelectors.length > 10 ? ` (showing 10 of ${ambientTextSelectors.length})` : ''}: ` +
        `${ambientTextSelectors.slice(0, 10).join(', ')} (see templateRule.md)`
      : '');

  // 17) Every text element owns a unique class. A shared role class
  // (`.stat-label` on all four stats) is correct for the shared design, but on
  // its own it means editing that text in the CMS restyles all four — the tenant
  // cannot customise the one they clicked. So each text element also carries a
  // class used exactly once, giving it a per-element style rule that survives a
  // re-share (a CMS-side inline style does not — a re-share overwrites the page).
  const sharedOnlyText = findTextWithoutUniqueClass(html);
  if (sharedOnlyText.length) {
    const uniqueList = [...new Set(sharedOnlyText.map((h) => `<${h.tag}> "${h.text.slice(0, 40)}${h.text.length > 40 ? '…' : ''}"`))];
    const shown = uniqueList.slice(0, 12);
    add('Every text element has its own unique class', 'FAIL',
      `${sharedOnlyText.length} text element(s) have no class of their own — every class they carry is also used ` +
      `elsewhere, so restyling one in the CMS restyles them all. Give each its OWN class in addition to any ` +
      `shared role class, unique one first: class="stat-label-4 stat-label", and declare it (.stat-label-4 {}). ` +
      `Fix every occurrence, not only the examples listed here` +
      `${uniqueList.length > shown.length ? ` (showing ${shown.length} of ${uniqueList.length})` : ''}: ` +
      `${shown.join(', ')} (see templateRule.md)`);
  } else {
    add('Every text element has its own unique class', 'PASS');
  }

  // 18) Interactive controls ship their visible content in the HTML. The
  // importer strips every <script>, so a control whose icon or label is injected
  // at runtime arrives EMPTY — the tenant sees the control's border with nothing
  // inside it. JS may SWAP an icon; it must never create it. Only a control with
  // no children at all is flagged: one drawn purely by CSS (`<button
  // class="hamburger"><span></span><span></span></button>`) renders fine.
  // Kept in parity with rule 18 in OpenDesign/apps/daemon/src/cms-compliance.ts.
  {
    const emptyControls = [];
    for (const m of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const tag = (m[1] || '').toLowerCase();
      const attrs = m[2] || '';
      const inner = m[3] || '';
      if (inner.replace(/<!--[\s\S]*?-->/g, '').trim()) continue;
      if (tag === 'a' && !/\bhref\s*=/i.test(attrs)) continue; // scroll target, not a control
      const label = (attrs.match(/class\s*=\s*"([^"]*)"/i)
        || attrs.match(/aria-label\s*=\s*"([^"]*)"/i)
        || [])[1] || '';
      emptyControls.push(`<${tag}${label ? ` "${label}"` : ''}>`);
    }
    if (emptyControls.length) {
      const shown = [...new Set(emptyControls)].slice(0, 8);
      add('Interactive controls have visible content in the HTML', 'FAIL',
        `${emptyControls.length} control(s) are empty in the markup, so they import as a blank box — the tenant ` +
        `sees the border with no icon. Put the icon or label IN the HTML (inline <svg>, <img>, or text); ` +
        `let JS swap it, not create it. Fix every occurrence, not only the examples listed here: ` +
        `${shown.join(', ')} (see templateRule.md)`);
    } else {
      add('Interactive controls have visible content in the HTML', 'PASS');
    }
  }

  return results;
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node Operator/rules/check-template-rule.mjs <file-or-dir> [more...]');
  process.exit(2);
}

const files = [...new Set(args.flatMap((a) => { try { return collectHtml(a); } catch (e) { console.error(`skip ${a}: ${e.message}`); return []; } }))];
if (!files.length) { console.error('No .html files found.'); process.exit(2); }

let anyFail = false;
for (const f of files) {
  let html; try { html = readFileSync(f, 'utf8'); } catch (e) { console.log(`\n${BLD}${f}${RST}\n  cannot read: ${e.message}`); continue; }
  const results = checkPage(html);
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  anyFail = anyFail || fails > 0;
  const verdict = fails ? `${RED}NON-COMPLIANT${RST}` : warns ? `${YEL}PASS (with warnings)${RST}` : `${GRN}COMPLIANT${RST}`;
  console.log(`\n${BLD}${basename(f)}${RST}  ${DIM}${f}${RST}\n  ${verdict}  —  ${fails} fail, ${warns} warn`);
  for (const r of results) {
    console.log(`   ${tag(r.status)}  ${r.rule}${r.detail ? `  ${DIM}—${RST} ${r.detail}` : ''}`);
  }
}
console.log(`\n${BLD}Overall:${RST} ${anyFail ? `${RED}some pages need fixes${RST}` : `${GRN}all pages follow the rule${RST}`}  (${files.length} page${files.length > 1 ? 's' : ''} checked)`);
process.exit(anyFail ? 1 : 0);
