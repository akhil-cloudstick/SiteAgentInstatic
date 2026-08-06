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

// ---------------------------------------------------------------------------
// Editable-text scanning (rules 8 + 16)
//
// Mirrors HTML_TO_MODULE_RULES / walkAndMap in Instatic's importer:
//   - h1-h6, p, span, small, strong, em, label import as ONE editable text block
//     — but only while they hold no element child. With a child the rule recurses
//     to a container and the loose runs become bare text again.
//   - a, button, option capture their text wholesale and never recurse.
//   - Everything else recurses, so a text node written directly inside it becomes
//     a no-wrapper `base.text` (`tag: 'none'`). It renders, but owns NO DOM
//     element — so it can never be clicked on the canvas, never gets a selection
//     ring, and can never carry a class. That is a dead end for the tenant.
// ---------------------------------------------------------------------------

const TEXT_LEAF_WHEN_CHILDLESS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'small', 'strong', 'em', 'label',
]);
const TEXT_LEAF_ALWAYS = new Set(['a', 'button', 'option']);
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** Subtrees whose text is not tenant-editable page copy. */
const SKIP_SUBTREES = new Set([
  'script', 'style', 'svg', 'math', 'pre', 'code', 'textarea', 'noscript', 'template', 'head', 'title', 'iframe', 'canvas',
]);

export interface BareTextHit {
  /** The container the loose text was written directly inside. */
  tag: string;
  text: string;
}

/** A text run that DOES own an element — the element that carries it. */
export interface TextOwnerHit {
  tag: string;
  text: string;
  classes: string[];
}

interface TagFrame {
  tag: string;
  texts: string[];
  classes: string[];
  hasElementChild: boolean;
}

interface TextScan {
  bare: BareTextHit[];
  owners: TextOwnerHit[];
}

const classesOf = (rawTag: string): string[] => {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(rawTag);
  return (m?.[1] ?? m?.[2] ?? '').split(/\s+/).filter(Boolean);
};

function closeFrame(frame: TagFrame, scan: TextScan): void {
  if (frame.texts.length === 0) return;
  const ownsItsText =
    TEXT_LEAF_ALWAYS.has(frame.tag) ||
    (TEXT_LEAF_WHEN_CHILDLESS.has(frame.tag) && !frame.hasElementChild);
  if (ownsItsText) {
    scan.owners.push({ tag: frame.tag, text: frame.texts.join(' '), classes: frame.classes });
    return;
  }
  for (const text of frame.texts) scan.bare.push({ tag: frame.tag, text });
}

/**
 * Every significant text run that will import WITHOUT an element of its own.
 * Single pass, deterministic, tolerant of unclosed tags.
 */
export function findBareText(html: string): BareTextHit[] {
  return scanText(html).bare;
}

function scanText(html: string): TextScan {
  const scan: TextScan = { bare: [], owners: [] };
  const hits = scan;
  const stack: TagFrame[] = [];
  let skipDepth = 0;
  let cursor = 0;
  const pushText = (raw: string): void => {
    if (skipDepth > 0) return;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    stack[stack.length - 1]?.texts.push(text);
  };

  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!/]?[A-Za-z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(html)) !== null) {
    pushText(html.slice(cursor, m.index));
    cursor = tokens.lastIndex;
    const raw = m[0];
    if (raw.startsWith('<!')) continue; // comment / doctype / CDATA
    const name = /^<\/?\s*([A-Za-z][A-Za-z0-9-]*)/.exec(raw)?.[1]?.toLowerCase();
    if (!name) continue;

    if (raw[1] === '/') {
      if (skipDepth > 0) {
        if (SKIP_SUBTREES.has(name)) skipDepth--;
        continue;
      }
      // Close back to the matching open tag; unclosed tags in between are closed too.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag !== name) continue;
        for (let j = stack.length - 1; j >= i; j--) closeFrame(stack[j]!, hits);
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
    const parent = stack[stack.length - 1];
    if (parent) parent.hasElementChild = true;
    if (selfClosing) continue;
    if (SKIP_SUBTREES.has(name)) {
      skipDepth++;
      continue;
    }
    stack.push({ tag: name, texts: [], classes: classesOf(raw), hasElementChild: false });
  }
  pushText(html.slice(cursor));
  for (let i = stack.length - 1; i >= 0; i--) closeFrame(stack[i]!, hits);
  return scan;
}

/**
 * Text elements that carry no class of their own — i.e. every class they have is
 * shared with another element on the page, so editing that class in the CMS
 * restyles all of them at once and the tenant cannot customise the one they
 * selected. Each text element needs at least one class used exactly once.
 */
export function findTextWithoutUniqueClass(html: string): TextOwnerHit[] {
  const frequency = new Map<string, number>();
  for (const m of html.matchAll(/<[A-Za-z][^>]*?\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const c of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (c) frequency.set(c, (frequency.get(c) ?? 0) + 1);
    }
  }
  return scanText(html).owners.filter(
    (owner) => !owner.classes.some((c) => frequency.get(c) === 1),
  );
}

/** Tags that carry tenant-visible copy — the targets rule 16 cares about. */
const TEXT_BEARING_TAG_RE = /^(?:h[1-6]|p|span|small|strong|em|b|i|a|li|blockquote|figcaption|td|th|dt|dd)$/;

/**
 * Descendant selectors that style a text tag directly (`.card strong`). Those
 * import as AMBIENT rules: they render, but editing one changes every element it
 * matches instead of the single element the tenant selected.
 *
 * Every such selector is reported, with no "does a class-less element exist?"
 * precondition. Deciding that needs a real DOM matcher, which the Operator-side
 * twin of this checker cannot have (no dependencies), and a document-wide regex
 * approximation flags a selector because of an UNRELATED class-less element —
 * leaving a page that stays red no matter what the author fixes. The fix here is
 * always available and always the same: give the matched elements their own
 * class and move the declarations onto it.
 */
export function findDescendantTextSelectors(styleCss: string, html: string): string[] {
  const hits = new Set<string>();
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selectorList = rule[1] ?? '';
    if (selectorList.trim().startsWith('@')) continue;
    for (const rawSelector of selectorList.split(',')) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      // Pseudo-class/element and attribute selectors are ambient by design.
      if (!selector || /[:[]/.test(selector)) continue;
      const parts = selector.replace(/\s*[>+~]\s*/g, ' ').split(' ').filter(Boolean);
      if (parts.length < 2) continue; // a bare element selector is base typography, not a per-node style
      const target = parts[parts.length - 1]!.toLowerCase();
      if (!TEXT_BEARING_TAG_RE.test(target)) continue;
      hits.add(selector);
    }
  }
  return [...hits];
}

/**
 * Severity for rule 16. A `fail` blocks the share and feeds the model a
 * correction; flip to 'warn' if it proves too noisy on real pages (the share
 * handler only acts on `fail`).
 */
const DESCENDANT_TEXT_SELECTOR_STATUS: ComplianceStatus = 'fail';

// ---------------------------------------------------------------------------
// Layer naming (rule 15). GENERIC mirrors deriveNodeLabel in
// Instatic/src/core/htmlImport/nodeLabel.ts. WEAK goes further than the importer
// on purpose: the importer happily displays "Reveal"/"Split" because a hook name
// still beats "Container", but the rule asks OD for a real name.
// Kept in parity with Operator/rules/check-template-rule.mjs.
// ---------------------------------------------------------------------------

const GENERIC_NAMES = new Set([
  'container', 'wrapper', 'wrap', 'inner', 'outer', 'row', 'col', 'column', 'columns', 'grid', 'flex',
  'box', 'block', 'content', 'item', 'items', 'group', 'stack', 'holder', 'section', 'div', 'main',
  'body', 'area', 'panel', 'left', 'right', 'top', 'bottom', 'center', 'centre', 'middle', 'clearfix',
  'active', 'open', 'closed', 'show', 'hide', 'hidden', 'visible', 'small', 'large', 'dark', 'light',
  'full', 'half',
]);
/** Animation / layout hooks: they say how a block moves or stacks, not what it is. */
const WEAK_NAMES = new Set([
  'reveal', 'fade', 'fadein', 'fade-in', 'animate', 'animated', 'parallax', 'sticky', 'split', 'track',
  'slide', 'scroll', 'marquee-track', 'carousel-track', 'overlay', 'media', 'copy', 'text', 'inner-wrap',
  'card-body',
]);
const NAMED_TAGS_RE = /^(?:header|footer|nav|main|aside|section|article|form|figure|figcaption|ul|ol|li|table)$/i;

function isMeaningfulName(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    token.length >= 2 &&
    !GENERIC_NAMES.has(lower) &&
    !WEAK_NAMES.has(lower) &&
    !/^(?:is|has|js|u|no)-/i.test(token) &&
    !/^_/.test(token) &&
    !/\d/.test(token) &&
    !/[:/[\]]/.test(token)
  );
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

  // 2b) Styles actually PRESENT for the markup.
  // Rule 2 only proves "no external link + some <style>" — it cannot tell that
  // the styles themselves survived. An agent asked to fix rule 2 can satisfy it
  // by DELETING the <link> instead of inlining the stylesheet's contents, which
  // silently strips every shared header/nav/footer rule and ships an unstyled
  // page. This catches that: markup classes with no matching selector anywhere
  // in the page's own CSS. Skipped when an external stylesheet is still linked
  // (rule 2 already fails, and we cannot resolve that file's contents here).
  if (styleBlocks.trim() && extCss.length === 0) {
    const used = new Set<string>();
    for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/gi)) {
      for (const cls of (m[1] ?? '').split(/\s+/)) {
        // Ignore state/utility-ish tokens toggled by JS and templating leftovers.
        if (cls && cls.length > 2 && !cls.startsWith('is-') && !cls.includes('{')) used.add(cls);
      }
    }
    const undefinedClasses = [...used].filter((c) => !styleBlocks.includes(`.${c}`));
    // High threshold: a page that merely leans on element/descendant selectors
    // trips a handful at most, while a page that lost a whole stylesheet trips
    // dozens. Only the wholesale-loss case should block a share.
    if (undefinedClasses.length >= 10) {
      add(
        'Styles present for markup',
        'fail',
        `${undefinedClasses.length} classes used in the markup have no CSS in this page ` +
          `(${undefinedClasses.slice(0, 6).join(', ')}…) — a stylesheet was removed without ` +
          `inlining its contents; copy the full CSS into the <style> block`,
      );
    } else {
      add('Styles present for markup', 'pass');
    }
  }

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

  // 8) No bare text — every text run must own an element. Text written directly
  // inside a container (a <div>, <li>, <td>, <b>, or a heading that also holds a
  // child element) imports as a no-wrapper text node: it renders, but owns no DOM
  // element, so the tenant can never select it on the canvas, never gets a
  // selection ring, and can never give it a class to style it. Blocking.
  const bareText = findBareText(html);
  if (bareText.length) {
    const unique = [
      ...new Set(bareText.map((h) => `<${h.tag}> "${h.text.slice(0, 40)}${h.text.length > 40 ? '…' : ''}"`)),
    ];
    const shown = unique.slice(0, 12);
    add(
      'No bare text (every run owns an element)',
      'fail',
      `${bareText.length} text run(s) sit directly inside a container, so they import with NO element of their own — ` +
        `the tenant cannot select, highlight or style them at all. Wrap EVERY one in its own element with its own ` +
        `class, e.g. <span class="stat-label">Founded in Lisbon</span>. Remember a heading/paragraph that contains ` +
        `any child element (even a <br> or <span>) stops being one text block, so its loose runs must be wrapped ` +
        `too. Fix every occurrence on the page, not only the examples listed here` +
        `${unique.length > shown.length ? ` (showing ${shown.length} of ${unique.length})` : ''}: ` +
        `${shown.join(', ')} (see templateRule.md)`,
    );
  } else {
    add('No bare text (every run owns an element)', 'pass');
  }

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

  // 15) Every structural element is named. Instatic names a Layers row from the
  // element's own markup (data-layer → meaningful class → id → aria-label →
  // semantic tag). An element with none of those — or whose only class is layout
  // plumbing (container/wrapper/row/grid) — falls back to the module name, so the
  // Layers panel reads "Container" for the whole page and the AI editor, which
  // addresses blocks by name, cannot tell the hero from the footer.
  // Kept in parity with rule 15 in Operator/rules/check-template-rule.mjs.
  {
    const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html;
    const unnamed: string[] = [];
    for (const m of body.matchAll(/<(div|section|article|aside|header|footer|nav|main)\b([^>]*)>/gi)) {
      const tagName = m[1] ?? '';
      const attrs = m[2] ?? '';
      if (NAMED_TAGS_RE.test(tagName)) continue; // <header>/<section>/… name themselves
      if (/\bdata-layer\s*=|\bid\s*=|\baria-label\s*=/i.test(attrs)) continue;
      const classNames = (attrs.match(/class\s*=\s*"([^"]*)"/i)?.[1] ?? '').split(/\s+/).filter(Boolean);
      if (classNames.some(isMeaningfulName)) continue;
      unnamed.push(`<${tagName}${classNames.length ? ` class="${classNames.join(' ')}"` : ''}>`);
    }
    add(
      'Every block is named (Layers panel)',
      unnamed.length ? 'warn' : 'pass',
      unnamed.length
        ? `${unnamed.length} element(s) have no meaningful name — they import as "Container" and the AI editor ` +
          `can't target them: ${[...new Set(unnamed)].slice(0, 5).join(', ')}. Give each a semantic class ` +
          `(hero, services-grid, service-card) or data-layer="…" (see templateRule.md)`
        : undefined,
    );
  }

  // 16) Text styled through its own class, not a descendant selector. Only a
  // single bare class imports as an editable rule the tenant can change on ONE
  // element; `.stat-item strong` imports as an ambient rule, so editing it
  // restyles every match at once and per-element customisation is impossible.
  const ambientTextSelectors = findDescendantTextSelectors(styleBlocks, html);
  add(
    'Text styled by its own class (not a descendant selector)',
    ambientTextSelectors.length ? DESCENDANT_TEXT_SELECTOR_STATUS : 'pass',
    ambientTextSelectors.length
      ? `${ambientTextSelectors.length} rule(s) style a text element through a descendant selector — these import ` +
        `as AMBIENT rules, so editing one changes every element it matches instead of the one the tenant selected. ` +
        `Give each of those text elements its own class and move the declarations onto that class ` +
        `(\`.stat-value { … }\`, not \`.stat-item strong { … }\`). Fix every one, not only the examples listed here` +
        `${ambientTextSelectors.length > 10 ? ` (showing 10 of ${ambientTextSelectors.length})` : ''}: ` +
        `${ambientTextSelectors.slice(0, 10).join(', ')} (see templateRule.md)`
      : undefined,
  );

  // 17) Every text element owns a unique class. A shared role class
  // (`.stat-label` on all four stats) is correct for the shared design, but on
  // its own it means editing that text in the CMS restyles all four — the tenant
  // cannot customise the one they clicked. So each text element also carries a
  // class used exactly once, giving it a per-element style rule that survives a
  // re-share (a CMS-side inline style does not — a re-share overwrites the page).
  const sharedOnlyText = findTextWithoutUniqueClass(html);
  if (sharedOnlyText.length) {
    const unique = [
      ...new Set(sharedOnlyText.map((h) => `<${h.tag}> "${h.text.slice(0, 40)}${h.text.length > 40 ? '…' : ''}"`)),
    ];
    const shown = unique.slice(0, 12);
    add(
      'Every text element has its own unique class',
      'fail',
      `${sharedOnlyText.length} text element(s) have no class of their own — every class they carry is also used ` +
        `elsewhere, so restyling one in the CMS restyles them all. Give each its OWN class in addition to any ` +
        `shared role class, unique one first: class="stat-label-4 stat-label", and declare it (\`.stat-label-4 {}\`). ` +
        `Fix every occurrence, not only the examples listed here` +
        `${unique.length > shown.length ? ` (showing ${shown.length} of ${unique.length})` : ''}: ` +
        `${shown.join(', ')} (see templateRule.md)`,
    );
  } else {
    add('Every text element has its own unique class', 'pass');
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
