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

  // 7) data-sa editable markers on content.
  const saCount = (html.match(/\bdata-sa\s*=/gi) || []).length;
  const contentEls = (html.match(/<(h[1-6]|p|img)\b/gi) || []).length;
  if (saCount === 0 && contentEls > 2) add('data-sa editable markers', 'warn', `0 data-sa on ${contentEls} content elements`);
  else add('data-sa editable markers', saCount > 0 ? 'pass' : 'warn', saCount > 0 ? `${saCount} markers` : 'no content');

  // 8) No bare text beside an inline element (best-effort heuristic).
  let bareHits = 0;
  for (const m of html.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2] ?? '';
    if (!/<(span|strong|em|b|i|a)\b/i.test(inner)) continue;
    const stripped = inner.replace(/<(span|strong|em|b|i|a)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    if (stripped.replace(/<[^>]+>/g, '').trim().length > 0) bareHits++;
  }
  add('No bare text beside inline element', bareHits ? 'warn' : 'pass', bareHits ? `${bareHits} block(s) mix a wrapped span with loose text` : undefined);

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
