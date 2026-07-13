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

  // 7) data-sa editable markers on content.
  const saCount = (html.match(/\bdata-sa\s*=/gi) || []).length;
  const contentEls = (html.match(/<(h[1-6]|p|img)\b/gi) || []).length;
  if (saCount === 0 && contentEls > 2) add('data-sa editable markers', 'WARN', `0 data-sa on ${contentEls} headings/paragraphs/images — tenant edit keys missing`);
  else add('data-sa editable markers', saCount > 0 ? 'PASS' : 'WARN', saCount > 0 ? `${DIM}${saCount} markers${RST}` : 'no content elements');

  // 8) Editable text — bare text next to an inline element (best-effort heuristic).
  const inlineChild = /<(span|strong|em|b|i|a)\b/i;
  let bareTextHits = 0;
  for (const m of html.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2];
    if (!inlineChild.test(inner)) continue; // only lines that mix an inline child
    const bare = inner.replace(/<[^>]+>/g, '').split('').some((t) => t.trim().length > 0 && /\S/.test(t) && !/^\s*$/.test(t));
    // crude: does removing inline tags leave loose non-tag text alongside a child?
    const stripped = inner.replace(/<(span|strong|em|b|i|a)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    if (stripped.replace(/<[^>]+>/g, '').trim().length > 0 && bare) bareTextHits++;
  }
  add('No bare text beside inline element', bareTextHits ? 'WARN' : 'PASS',
    bareTextHits ? `${bareTextHits} heading/paragraph(s) mix a wrapped span with loose text — wrap every run` : '');

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
