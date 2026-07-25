// Cross-page brand/layout consistency checker.
//
// The CMS output contract already asks the agent to keep nav/header/footer
// structurally identical across pages (so Instatic promotes them to one shared
// Visual Component). This module VERIFIES that across a project's actual pages,
// so a page that drifts into its own header/footer — the "every page looks like
// its own separate landing page" failure — is caught and auto-corrected by the
// same post-run gate that enforces templateRule compliance (see server.ts
// `runCmsComplianceGate`).
//
// It intentionally compares only the shared chrome (header / nav / footer), not
// the body — page bodies are supposed to differ. Active-state markers (the one
// legitimate per-page difference on a shared nav) are stripped before comparing,
// mirroring the importer's own global-section detection
// (Instatic/src/core/siteImport/globalSections.ts).

export type ChromePart = 'header' | 'nav' | 'footer';

export interface ConsistencyViolation {
  /** The page whose chrome diverges from the canonical page. */
  path: string;
  /** Which shared region differs. */
  part: ChromePart;
  /** Human-readable detail for the correction message. */
  detail: string;
}

const CHROME_PARTS: ChromePart[] = ['header', 'nav', 'footer'];

// Whole class tokens that legitimately differ per page on an otherwise-shared
// nav (the active link). Stripped before comparing so they don't read as drift.
const ACTIVE_STATE_TOKENS = new Set([
  'active',
  'is-active',
  'current',
  'is-current',
  'selected',
  'aria-selected',
]);

/**
 * Extract the first top-level `<tag>…</tag>` block from `html`, balancing
 * same-tag nesting. Returns the element's outer HTML, or null when absent.
 */
export function extractElement(html: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
  const open = openRe.exec(html);
  if (!open) return null;
  const start = open.index;
  const tokenRe = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}\\s*>`, 'gi');
  tokenRe.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    } else {
      depth++;
    }
  }
  return null; // unbalanced markup — treat as absent rather than guess
}

/**
 * Normalize a chrome fragment for structural comparison: canonicalize
 * same-page anchor links, drop active-state class tokens and `aria-current`,
 * collapse whitespace, lowercase. Two pages whose header/footer differ only by
 * the active link — or by a link written as a same-page anchor on its own page
 * (`#visit`) vs a cross-page link everywhere else (`index.html#visit`) —
 * normalize to the same string.
 *
 * `pageBasename` (e.g. `index.html`) is the file the fragment came from; when
 * given, a same-page anchor `href="#visit"` is rewritten to
 * `href="index.html#visit"` so it matches how other pages link to it. This
 * mirrors the CMS importer's own global-section detection, so what OD treats as
 * "one shared header" is exactly what Instatic will promote to a shared
 * component + everywhere template.
 */
export function normalizeChrome(fragment: string, pageBasename?: string): string {
  let s = fragment;
  if (pageBasename) {
    s = s.replace(
      /href\s*=\s*"#([^"]+)"/gi,
      (_full, frag: string) => `href="${pageBasename}#${frag}"`,
    );
  }
  return s
    .replace(/\s*class\s*=\s*"([^"]*)"/gi, (_full, cls: string) => {
      const kept = cls
        .split(/\s+/)
        .filter((t) => t && !ACTIVE_STATE_TOKENS.has(t.toLowerCase()));
      // Drop the attribute entirely when only active-state tokens remained, so
      // an active link on one page and an inactive one on another normalize
      // identically (an empty `class=""` in a different spot is not a drift).
      return kept.length ? ` class="${kept.join(' ')}"` : '';
    })
    .replace(/\saria-current\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The file part of a web path (`pages/shop.html` → `shop.html`). */
function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Pick the canonical page whose chrome the others must match: index.html if present, else the first. */
function canonicalIndex(pages: { path: string }[]): number {
  const idx = pages.findIndex((p) => /(^|\/)index\.html?$/i.test(p.path));
  return idx >= 0 ? idx : 0;
}

/**
 * Compare every page's shared chrome against the canonical page. Returns one
 * violation per (page, part) that diverges. A part is only compared when BOTH
 * the canonical and the other page have it (a page legitimately without a
 * footer is not a violation — a page with a DIFFERENT footer is).
 */
export function checkCrossPageChromeConsistency(
  pages: { path: string; html: string }[],
): ConsistencyViolation[] {
  if (pages.length < 2) return [];
  const canon = canonicalIndex(pages);
  const canonPage = pages[canon];
  if (!canonPage) return [];
  const canonBase = basename(canonPage.path);
  const canonChrome = new Map<ChromePart, string | null>();
  for (const part of CHROME_PARTS) {
    const el = extractElement(canonPage.html, part);
    canonChrome.set(part, el ? normalizeChrome(el, canonBase) : null);
  }

  const violations: ConsistencyViolation[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i === canon) continue;
    const page = pages[i];
    if (!page) continue;
    for (const part of CHROME_PARTS) {
      const canonNorm = canonChrome.get(part) ?? null;
      if (!canonNorm) continue; // canonical has no such part → nothing to match
      const el = extractElement(page.html, part);
      if (!el) continue; // this page simply omits it — not a drift
      if (normalizeChrome(el, basename(page.path)) !== canonNorm) {
        violations.push({
          path: page.path,
          part,
          detail: `<${part}> differs from ${canonPage.path}; make it structurally identical (same markup and classes) so the site shares one ${part}.`,
        });
      }
    }
  }
  return violations;
}
