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

// Descendant selectors that style a text tag directly (`.card strong`). Instatic
// binds a rule to the rightmost CLASS in its selector, so these bind to `.card`
// — the ancestor — and never to the text they style: the tenant's edit lands on
// the whole block instead of the run they selected. Only a TAG target is
// reported; `.card .card-note` binds to `card-note`, the element it actually
// styles, so it stays per-element editable. Every such selector is reported —
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

  // 2b) Styles actually PRESENT for the markup. Rule 2 only proves "no external
  // link + some <style>" — it cannot tell that the styles themselves survived.
  // An agent asked to fix rule 2 can satisfy it by DELETING the <link> instead
  // of inlining the stylesheet's contents, which silently strips every shared
  // header/nav/footer rule and ships an unstyled page. This catches that.
  // Skipped while an external stylesheet is still linked (rule 2 already fails,
  // and we cannot resolve that file's contents here).
  // Kept in parity with rule 2b in OpenDesign/apps/daemon/src/cms-compliance.ts.
  if (styleBlocks.trim() && extCss.length === 0) {
    const used = new Set();
    for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/gi)) {
      for (const cls of (m[1] || '').split(/\s+/)) {
        // Ignore state/utility-ish tokens toggled by JS and templating leftovers.
        if (cls && cls.length > 2 && !cls.startsWith('is-') && !cls.includes('{')) used.add(cls);
      }
    }
    const undefinedClasses = [...used].filter((c) => !styleBlocks.includes(`.${c}`));
    // High threshold: a page that merely leans on element/descendant selectors
    // trips a handful at most, while a page that lost a whole stylesheet trips
    // dozens. Only the wholesale-loss case should block a share.
    if (undefinedClasses.length >= 10) {
      add('Styles present for markup', 'FAIL',
        `${undefinedClasses.length} classes used in the markup have no CSS in this page ` +
        `(${undefinedClasses.slice(0, 6).join(', ')}…) — a stylesheet was removed without ` +
        `inlining its contents; copy the full CSS into the <style> block`);
    } else {
      add('Styles present for markup', 'PASS');
    }
  }

  // 2c) Animation hook classes must actually animate. Rule 2b only proves the
  // selector text appears somewhere in the CSS — `.reveal-up {}` satisfies its
  // `styleBlocks.includes('.reveal-up')` test while declaring nothing at all.
  // That ships a page whose markup is covered in `reveal-up`/`reveal-stagger`
  // hooks with zero motion behind them: every other check passes and the
  // animation is silently lost on import AND on the published site. A hook
  // that looks like an animation name and resolves to no declarations is
  // always a bug, so this is safe to fail on. See templateRule.md §10.
  if (styleBlocks.trim() && extCss.length === 0) {
    const HOOK_RE = /^(?:reveal|animate|anim|fade|slide|zoom|stagger|parallax)(?:[-_][\w-]*)?$|^[\w-]*[-_](?:reveal|stagger|fade-in|fade-up)$/i;
    const hooks = [...new Set(allClasses.filter((c) => HOOK_RE.test(c)))];
    const dead = hooks.filter((cls) => {
      const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Any rule whose selector mentions this class and declares something.
      const ruleRe = new RegExp(`\\.${escaped}(?![\\w-])[^{}]*\\{([^{}]*)\\}`, 'g');
      for (const m of styleBlocks.matchAll(ruleRe)) {
        if (m[1].replace(/[\s;]/g, '')) return false;
      }
      return true;
    });
    if (dead.length) {
      add('Animation hooks actually animate', 'FAIL',
        `${dead.length} animation class${dead.length === 1 ? '' : 'es'} on the markup ${dead.length === 1 ? 'resolves' : 'resolve'} to an ` +
        `empty or missing rule (${dead.slice(0, 6).join(', ')}${dead.length > 6 ? '…' : ''}) — ` +
        `write the animation or remove the class`);
    } else if (hooks.length) {
      add('Animation hooks actually animate', 'PASS', `${DIM}${hooks.length} hook class${hooks.length === 1 ? '' : 'es'} wired${RST}`);
    }
  }

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

  // 11a) Text typography/colour must not live only on a bare TAG selector.
  // A bare `h1, h2, h3 { color: … }` imports as an `ambient` rule, not a class
  // rule: it is not editable and does not reliably apply in the editor canvas,
  // so the heading falls back to an inherited colour and can render unreadable
  // — while the same file opened directly in a browser looks perfect. Emitting
  // `.od-title {}` as an empty stub alongside it satisfies the "declare the bare
  // class" rule on paper and fixes nothing, so the stub is what we detect.
  // A concrete value only — `color: inherit` / `font: inherit` in a reset is
  // exactly the inherited default the rule allows, and must not be flagged.
  const TYPO_PROP_NAMES = new Set(['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']);
  const KEYWORD_VALUES = new Set(['inherit', 'initial', 'unset', 'revert', 'currentcolor']);
  const hasConcreteTypography = (body) => body.split(';').some((decl) => {
    const at = decl.indexOf(':');
    if (at < 0) return false;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim().toLowerCase();
    return TYPO_PROP_NAMES.has(prop) && value.length > 0 && !KEYWORD_VALUES.has(value);
  });
  // NOTE: must NOT anchor on the previous rule's `}` — a `(^|})`-anchored
  // pattern consumes that brace, so the next rule has no `}` left to match and
  // the scan silently reads only every OTHER rule (`.a{}.b{}.c{}.d{}` → a, c).
  // This regex takes the selector as "everything since the last brace", which
  // also picks up rules nested inside `@media` blocks; `@` preludes are
  // filtered out below.
  const allRules = [...styleBlocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] }))
    .filter((r) => r.selector.length > 0 && !r.selector.startsWith('@') && !r.selector.startsWith('/*'));

  // Tags whose typography is supplied by a bare tag rule (ambient on import).
  const TEXT_BLOCK_TAG_RE = /^(?:h[1-6]|p|li|blockquote|figcaption|td|th|dt|dd)$/i;
  const tagsStyledByBareRule = new Set();
  for (const r of allRules) {
    const parts = r.selector.split(',').map((s) => s.trim());
    if (!parts.every((s) => /^[a-z][a-z0-9]*$/i.test(s))) continue;
    if (!hasConcreteTypography(r.body)) continue;
    for (const p of parts) if (TEXT_BLOCK_TAG_RE.test(p)) tagsStyledByBareRule.add(p.toLowerCase());
  }

  // Classes that carry a concrete `color` via their own BARE rule — the only
  // form that survives as an editable class rule the canvas applies.
  const classesWithColor = new Set();
  for (const r of allRules) {
    const bare = /^\.([A-Za-z0-9_-]+)$/.exec(r.selector);
    if (!bare) continue;
    if (r.body.split(';').some((d) => {
      const at = d.indexOf(':');
      if (at < 0) return false;
      return d.slice(0, at).trim().toLowerCase() === 'color'
        && !KEYWORD_VALUES.has(d.slice(at + 1).trim().toLowerCase())
        && d.slice(at + 1).trim().length > 0;
    })) classesWithColor.add(bare[1]);
  }

  // A bare tag rule is fine on its own — what breaks is an element that RELIES
  // on it, because that rule imports as `ambient`: not editable, and not
  // reliably applied in the editor canvas, so the element falls back to an
  // inherited colour and can render unreadable while the same file looks
  // correct in a browser. Flag only elements whose own classes carry no colour.
  const uncoloredTextEls = tagsStyledByBareRule.size === 0 ? [] :
    scanText(html).owners.filter((o) =>
      tagsStyledByBareRule.has(o.tag) && !o.classes.some((c) => classesWithColor.has(c)));
  const emptyStubCount = (styleBlocks.match(/^\s*\.[A-Za-z0-9_-]+\s*\{\s*\}\s*$/gm) || []).length;
  add('Text typography lives on classes, not bare tag selectors',
    uncoloredTextEls.length ? 'FAIL' : 'PASS',
    uncoloredTextEls.length ? `${uncoloredTextEls.length} text element(s) take their colour from a bare tag rule (${[...tagsStyledByBareRule].join(', ')}) with no colour on any of their own classes — that rule imports as ambient, so it is neither editable nor reliably applied in the editor canvas and the text renders with an inherited colour (often unreadable), even though the file looks correct in a browser. Put color/font-* on each element's OWN class${emptyStubCount ? `; ${emptyStubCount} empty stub rule(s) like ".od-title {}" are not compliance — the class must carry the declarations` : ''}. Examples: ${uncoloredTextEls.slice(0, 6).map((o) => `<${o.tag}> "${firstLine(o.text).slice(0, 40)}"`).join(', ')} (see templateRule.md)` : '');

  // 11c) Inline SVG icons must carry their own size. An <svg> with neither
  // width/height attributes NOR a class of its own can only be sized by a
  // descendant rule against an ancestor class. When any link in that chain does
  // not survive the import the icon falls back to its intrinsic size and
  // renders enormous (a 17px tick as a 200px block), while the same file is
  // correct in a browser. An svg WITH its own class binds to a real class rule,
  // and explicit width/height attributes ride through untouched — both are safe.
  const unsizedIcons = [...html.matchAll(/<svg\b([^>]*)>/gi)]
    .map((m) => m[1])
    .filter((attrs) => !/\bwidth\s*=/.test(attrs) && !/\bheight\s*=/.test(attrs) && !/\bclass\s*=/.test(attrs));
  add('Inline SVG icons carry their own size', unsizedIcons.length ? 'FAIL' : 'PASS',
    unsizedIcons.length ? `${unsizedIcons.length} inline <svg> element(s) have no width/height attribute and no class of their own, so their size depends entirely on a descendant rule against an ancestor class — if that chain does not survive the import the icon renders at its intrinsic size (huge) and breaks the layout, even though the file looks correct in a browser. Add width/height attributes (e.g. <svg width="17" height="17" viewBox="0 0 24 24">) or give each icon its own class with a bare sizing rule (see templateRule.md)` : '');

  // 11b) No raster photo delivered as a CSS background. A `background-image`
  // imports as a plain style declaration, NOT an Image block — no alt, no media
  // picker — so the tenant can never swap it. The prose rule ("decorative
  // backgrounds only") lost every argument with a full-bleed banner photo, which
  // reads as decorative and is not, so it is a hard check now. Gradients,
  // patterns and .svg textures are legitimate backgrounds and pass; only a
  // raster photo (jpg/jpeg/png/webp/gif/avif) fails. Covers the shorthand
  // (`background: … url(x.jpg) …`) and custom-property tokens feeding either.
  const PHOTO_BG_RE = /(?:^|[;{])\s*(?:background(?:-image)?|--[\w-]*(?:img|image|bg|photo)[\w-]*)\s*:\s*[^;{}]*url\(\s*['"]?[^'")]+\.(?:jpe?g|png|webp|gif|avif)\b/i;
  const photoBgHit = PHOTO_BG_RE.exec(colorScanCss);
  add('No photo in a CSS background', photoBgHit ? 'FAIL' : 'PASS',
    photoBgHit ? `Photo delivered as a CSS background is not an editable image (no alt, no media picker — the tenant cannot swap it): ${firstLine(photoBgHit[0])} — use <img> filled with position:absolute;inset:0;object-fit:cover and keep only the gradient overlay in CSS (see templateRule.md)` : '');

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

  // 16) Text styled through its own class, not a descendant selector. Instatic
  // binds a rule to the RIGHTMOST CLASS in its selector, so `.stat-item strong`
  // binds to `stat-item` — never to the text it actually styles. The tenant
  // selects the <strong> and their edit lands on the whole stat block instead,
  // making per-element customisation impossible.
  const ambientTextSelectors = findDescendantTextSelectors(styleBlocks, html);
  add('Text styled by its own class (not a descendant selector)',
    ambientTextSelectors.length ? DESCENDANT_TEXT_SELECTOR_STATUS : 'PASS',
    ambientTextSelectors.length
      ? `${ambientTextSelectors.length} rule(s) style a text element through its TAG in a descendant selector — ` +
        `the rule binds to the nearest CLASS in the selector (.stat-item), never to the text itself, so the ` +
        `tenant's edit lands on the whole block instead of the run they selected. ` +
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
      // Two different counts, so say which is which: the headline counts
      // ELEMENTS, the example list is de-duplicated by tag+text and so is
      // usually shorter. "showing 12 of 14" against a headline of 27 reads
      // like a miscount otherwise.
      `Fix every occurrence, not only the examples listed here` +
      `${uniqueList.length > shown.length ? ` (showing ${shown.length} of ${uniqueList.length} distinct texts)` : ''}: ` +
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

  // 19) No non-YouTube <iframe>. A YouTube iframe imports as base.video, which
  // declares the CSP origins the publisher needs, so `frame-src 'none'` is
  // lifted on that page. Every OTHER iframe imports as a plain container: the
  // markup is preserved and it still displays on the CMS canvas, so nothing
  // looks wrong until the site is live — where frame-src blocks it and the
  // section renders BLANK. Host test mirrors Instatic's htmlImport/rules.ts.
  // Kept in parity with rule 19 in OpenDesign/apps/daemon/src/cms-compliance.ts.
  {
    const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be']);
    const blockedEmbeds = [];
    for (const m of html.matchAll(/<iframe\b[^>]*>/gi)) {
      const tag = m[0];
      const srcMatch = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const src = (srcMatch && (srcMatch[1] ?? srcMatch[2])) || '';
      let isYoutube = false;
      try {
        isYoutube = YOUTUBE_HOSTS.has(new URL(src).hostname.toLowerCase().replace(/^www\./, ''));
      } catch {
        // Relative or malformed src — not YouTube, exactly as the importer decides.
      }
      if (!isYoutube) blockedEmbeds.push(firstLine(tag));
    }
    add('No non-YouTube iframe embeds', blockedEmbeds.length ? 'FAIL' : 'PASS',
      blockedEmbeds.length
        ? `${blockedEmbeds.length} iframe(s) are not YouTube, so they render BLANK on the published page ` +
          `(published pages ship frame-src 'none' and only a YouTube video block lifts it — the embed still ` +
          `looks fine on the CMS canvas, which is why this is easy to miss). Use YouTube for video; for a map, ` +
          `booking or chat widget ship a linked image instead. Fix every occurrence, not only the examples ` +
          `listed here: ${[...new Set(blockedEmbeds)].slice(0, 6).join(', ')} (see templateRule.md)`
        : '');
  }

  // 20) A bare declaration exists for every class the CSS styles. Instatic keeps
  // ONE editable rule per class name: a bare `.name { … }` wins the slot, but
  // when none exists a descendant/compound rule (`.card .card-note`, `.btn:hover`)
  // claims it — so the tenant's edits to that name only apply inside the ancestor,
  // or only in the hover state. WARN, not FAIL: the page imports and renders
  // correctly, so this must not block a share. Linter-only (no gate twin).
  {
    const css = styleBlocks.replace(/\/\*[\s\S]*?\*\//g, '');
    const bare = new Set();
    const claimed = new Map();
    for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const selectorList = rule[1] || '';
      if (selectorList.trim().startsWith('@')) continue;
      for (const rawSelector of selectorList.split(',')) {
        const selector = rawSelector.trim().replace(/\s+/g, ' ');
        if (!selector || selector.includes('(')) continue; // :is()/:has() — ambient anyway
        const bareMatch = selector.match(/^\.([A-Za-z_][\w-]*)$/);
        if (bareMatch) { bare.add(bareMatch[1]); continue; }
        const tokens = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((t) => t[1]);
        const binding = tokens[tokens.length - 1];
        if (binding && !claimed.has(binding)) claimed.set(binding, selector);
      }
    }
    const orphans = [...claimed].filter(([name]) => !bare.has(name));
    add('Bare class declared for every styled class', orphans.length ? 'WARN' : 'PASS',
      orphans.length
        ? `${orphans.length} class(es) are styled only through a descendant or compound selector with no bare ` +
          `rule, so that selector claims the editable slot and the tenant's edits apply only in that context. ` +
          `Add a bare declaration (an empty one is enough): ` +
          `${orphans.slice(0, 6).map(([n, s]) => `.${n} {} (claimed by "${s}")`).join(', ')}`
        : '');
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
// ---------------------------------------------------------------------------
// Run-level layout check — collections.
//
// Per-page checks cannot see this: whether posts are separated is a property of
// the BUNDLE, not of any one file. Everything at the top level imports as a
// Page, so a build shipping hundreds of top-level folders hands the tenant one
// flat Pages list with the blog mixed into it. WARN, not FAIL — a site with
// genuinely no collections is valid.
// ---------------------------------------------------------------------------
if (files.length > 1) {
  // Key on the COLLECTION ROOT, not the file's immediate parent.
  //
  // This previously used parts[length - 2], which for the mandated nested layout
  // `blog/<post-slug>/index.html` yields `<post-slug>` — a unique segment per
  // post, count 1 each. The result was inverted: the layout this rule requires
  // scored as "no collections" and printed WARN, while the flat
  // `blog/<post-slug>.html` the rule forbids scored as one big collection and
  // printed PASS. The checker contradicted its own remedy text.
  //
  // For `<root>/<entry>/index.html` the root is the grandparent. A listing page
  // at `<root>/index.html` is excluded, or `blog` would count itself and a
  // single-post blog would look like a collection of two.
  // Two separate tallies, because they answer different questions:
  //   topLevel   — how many `<name>/index.html` pages sit at the root. A large
  //                number with no collections is the flat-build smell.
  //   roots      — how many entries each collection folder holds.
  const roots = new Map();
  const flatEntries = new Map();
  let topLevel = 0;

  for (const f of files) {
    const parts = f.replace(/\\/g, '/').split('/');
    const file = parts[parts.length - 1] ?? '';
    const isIndex = file.toLowerCase() === 'index.html';

    // `blog/<slug>.html` — grouped, but in the form templateRule forbids. Track
    // it so a flat build gets told what is wrong rather than silently scoring
    // as "no collections", which reads like a pass.
    if (!isIndex && parts.length >= 2 && /\.html?$/i.test(file)) {
      const folder = parts[parts.length - 2];
      if (folder) flatEntries.set(folder, (flatEntries.get(folder) ?? 0) + 1);
    }

    // Only the nested form counts as a collection entry:
    //   blog/<slug>/index.html   → collection root `blog`     ✓
    //   blog/<slug>.html         → not a collection entry     ✗
    //
    // The flat form is what templateRule forbids, so it must not earn the PASS.
    // Counting it was the other half of the original inversion.
    if (!isIndex) continue;

    if (parts.length === 2) {
      // `<name>/index.html` — a top-level page, or a collection's own listing
      // page. Either way it is not an entry, so it never counts toward a
      // collection tally; counting it made a one-post blog look like two.
      topLevel++;
      continue;
    }
    if (parts.length < 3) continue;

    const root = parts[parts.length - 3];
    if (root) roots.set(root, (roots.get(root) ?? 0) + 1);
  }
  // A collection folder holds MANY entries under one root.
  const singles = topLevel;
  const collections = [...roots.entries()].filter(([, n]) => n > 1).map(([sg]) => sg);
  const flatGroups = [...flatEntries.entries()].filter(([, n]) => n > 1).map(([sg]) => sg);

  if (collections.length) {
    console.log(`\n   ${tag('PASS')}  Collections (bundle layout)  ${DIM}—${RST} ${collections.length} collection folder(s): ${collections.slice(0, 6).join(', ')}`);
  } else if (flatGroups.length) {
    console.log(`\n   ${tag('WARN')}  Collections (bundle layout)  ${DIM}—${RST} ` +
      `${flatGroups.length} folder(s) hold flat entry files (${flatGroups.slice(0, 6).join(', ')}) rather than nested ` +
      `folders. Entries must be one level deep — blog/<post-slug>/index.html, not blog/<post-slug>.html — with ` +
      `<folder>/index.html as the listing page. Do NOT use posts/ (reserved). (see templateRule.md)`);
  } else if (singles >= 25) {
    console.log(`\n   ${tag('WARN')}  Collections (bundle layout)  ${DIM}—${RST} ` +
      `${singles} top-level page folders and no collection folder. Everything at the top level imports as a Page, ` +
      `so blog posts and guides land in one flat Pages list the tenant cannot manage separately. Nest each set ` +
      `under a folder named for its collection — blog/<post-slug>/index.html — keeping <folder>/index.html as the ` +
      `listing page. Do NOT use posts/ (reserved). (see templateRule.md)`);
  } else {
    // Previously this case printed nothing at all, so a correct small tree was
    // indistinguishable from the check never running — anything grepping for the
    // PASS line saw a missing line rather than a result.
    console.log(`\n   ${tag('PASS')}  Collections (bundle layout)  ${DIM}—${RST} ` +
      `${singles} top-level page folder(s), no collection folders — valid for a site without collections.`);
  }
}

console.log(`\n${BLD}Overall:${RST} ${anyFail ? `${RED}some pages need fixes${RST}` : `${GRN}all pages follow the rule${RST}`}  (${files.length} page${files.length > 1 ? 's' : ''} checked)`);
process.exit(anyFail ? 1 : 0);
