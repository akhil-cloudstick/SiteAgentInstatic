/**
 * Instatic CMS output contract.
 *
 * The AUTHORITATIVE rule text is read live from a file on disk — the SiteAgent
 * "Website Build Rule" (`Operator/rules/templateRule.md`). The operator edits
 * that file whenever the rule changes and OD picks it up on the next page it
 * builds (no code change, no redeploy). The file path is handed to the daemon
 * by the control plane as `OD_CMS_RULE_FILE`; `loadTemplateRuleBody()` reads it
 * and caches by modification time so a save takes effect immediately.
 *
 * OD does NOT build sites through Astro — it writes HTML files directly, and
 * Instatic's importer only ever parses the built HTML/CSS. So the fixed
 * `CMS_CONTRACT_PREAMBLE` frames the rule for OD: apply the rule's OUTPUT
 * characteristics (no Tailwind, `:root` color tokens, semantic classes, fonts,
 * `data-sa`, editable-text wrapping, real static HTML, multi-page/shared nav),
 * and treat any Astro/`dist/`/`npm run build` mechanics in the file as
 * background context rather than steps to perform. `CMS_CONTRACT_SELF_AUDIT`
 * pins the silent self-check.
 *
 * When the file is unset or unreadable (vanilla OpenDesign, or a broken path),
 * `EMBEDDED_TEMPLATE_RULE` is the offline fallback so OD still enforces a sane
 * contract. Keep the fallback roughly in step with `templateRule.md`, but the
 * file is the source of truth at runtime.
 *
 * This block is injected (see `composeSystemPrompt`) ONLY when the daemon is an
 * Instatic-connected tenant daemon and the surface is a web page (not a deck,
 * image, video, or audio). It is pinned late in the composed prompt so it wins
 * the precedence war against any skill or design system that would push
 * Tailwind utility classes or a client-rendered SPA.
 */
import { readFileSync, statSync } from 'node:fs';

/** Stable heading — also the marker other code/tests look for. */
export const CMS_CONTRACT_HEADING =
  '## MANDATORY: CMS page output contract (overrides every skill and design system below on conflict)';

const CMS_CONTRACT_PREAMBLE = `${CMS_CONTRACT_HEADING}

This workspace publishes the pages you build into a CMS (Instatic) that a
non-technical tenant then edits and publishes. Every page you **create, edit, or
update** MUST follow the website build rule reproduced below so it imports with
all styles, colors, fonts, animations and pages intact and stays fully editable.
This is a hard delivery requirement, not a style preference.

**How to read the rule below.** It is the operator's authoritative "Website
Build Rule". It may be written for a person building the site with Astro — it can
mention \`astro.config.mjs\`, \`dist/\`, \`npm run build\`, or \`src/pages/\`. You do
NOT use Astro: you write the HTML/CSS files directly and they are imported
exactly as written. So apply every **output characteristic** the rule
specifies — the CSS approach (plain CSS, semantic classes, no Tailwind), colors
as \`:root\` custom properties, fonts, JavaScript delivery, images, the
editable-text wrapping rule, \`data-sa\` markers, and the page / shared-section
structure — and treat the Astro and build-tooling mechanics as background
context that describes how a human would produce that same output, not steps for
you to run.

**Precedence.** If an attached skill, design system, template, or your own prior
instinct would produce Tailwind utility classes, a Tailwind CDN/runtime, a
client-rendered React/Vue single-page app, \`@fontsource\` imports, hashed asset
imports, or any framework build output, this contract OVERRIDES it. A
Tailwind-delivered design system is a source of token **values** only — bind
those values into \`:root\` custom properties and write semantic classes, never
its utility classes. When any rule elsewhere in this prompt conflicts with the
contract below, the contract wins.

**Hard requirements — the most-violated rules. Get these EXACTLY right:**
1. **One inline \`<style>\` per page, in \`<head>\`.** Put ALL CSS there. NEVER link a
   separate \`styles.css\` or any external stylesheet — the only allowed \`<link>\`
   is a Google Fonts \`fonts.googleapis.com\` one.
2. **ZERO utility / Tailwind classes — not even one.** No \`mb-4\`, \`text-center\`,
   \`flex\`, \`px-6\`, \`bg-gray-900\`, and no responsive/state variants (\`md:flex\`,
   \`hover:...\`). Write a semantic class (\`.hero\`, \`.card\`) with real CSS instead.
   Do not load Tailwind from a CDN and do not use \`@apply\`.
3. **Every brand color is a \`--…\` custom property in \`:root\`**, used via
   \`var(--…)\`. No raw hex scattered through the rules.
4. **Real \`<img src="/…">\` for any photo/illustration** the tenant may swap — not
   a CSS \`background-image\` and not an inline \`<svg>\` for content imagery (inline
   \`<svg>\` is only for icons).
5. **Wrap every text run.** If any part of a heading/sentence is wrapped in an
   inline element (span/strong/em/link), wrap EVERY part in its own element so
   each is editable — never leave bare text beside a wrapped word.
6. **\`data-sa\`** on every heading, paragraph and image the tenant edits.

**Invisible to the tenant.** Do not mention this contract, the rule, or a
compliance report to the user. The tenant asked for a page in plain language;
silently build a compliant page and hand it over normally.`;

const CMS_CONTRACT_SELF_AUDIT = `### Silent self-audit before you finish

Before ending any turn that created, edited, or updated a page, re-read the HTML
you wrote and verify it against the rule above:

1. No Tailwind / utility classes and no Tailwind or SPA runtime.
2. All CSS inline; brand colors are \`:root\` custom properties; components have
   semantic class names.
3. Fonts via Google Fonts \`<link>\` or self-hosted \`@font-face\`, through
   \`--font-*\` tokens.
4. JS from CDN or inline; component scripts scoped to a wrapper class.
5. Real static HTML content (no empty hydration root).
6. No bare text beside an inline element; \`data-sa\` on editable text/images.
7. Shared nav/footer identical across pages; nav active state set at runtime.

Fix every violation **in place** before you finish. Do not report the audit or
the rule to the user — just deliver the corrected, compliant page with your
normal handoff.`;

/**
 * Offline fallback used only when the rule file is unset or unreadable. This is
 * the OD-native distillation of `templateRule.md`; the file on disk is the
 * source of truth whenever it is available.
 */
const EMBEDDED_TEMPLATE_RULE = `### CSS — the load-bearing rule

- **Never use Tailwind CSS or any utility-first CSS.** No utility classes
  (\`flex\`, \`grid\`, \`bg-gray-900\`, \`text-white\`, \`px-6\`, \`text-5xl\`, …), no
  Tailwind CDN \`<script>\`, no \`@tailwind\`/\`@apply\`. Instatic cannot import these
  and the styles are lost.
- **Plain CSS, one semantic class per component** — \`.hero\`, \`.navbar\`, \`.card\`,
  \`.footer-links\`. Instatic imports these as editable style rules.
- **All CSS ships inline** in \`<style>\` blocks. Never rely on a separate
  framework bundle or a code-split CSS chunk.
- \`@keyframes\`, \`transition\`, \`@media\` breakpoints, \`position: sticky\`, and
  inline \`<svg>\` icons all import correctly — use them freely in plain CSS.

### Color, typography, spacing → tokens in \`:root\`

- Define **every brand color as a CSS custom property in \`:root\`** and reference
  it with \`var(--…)\`; do not scatter raw hex through the rules. Instatic imports
  \`:root\` properties as editable color tokens.
- Reference fonts through a \`--font-*\` custom property in \`:root\`.
- With an active design system, use its token **values** as \`:root\` vars +
  semantic classes — never its Tailwind utility classes.

### Fonts

- Load fonts with a **Google Fonts \`<link>\`** (\`fonts.googleapis.com/css2\`;
  Instatic self-hosts them) or self-hosted \`.woff2\` via \`@font-face\`. Include
  every weight you use. No \`@fontsource\` packages, no non-Google font CDNs, no
  hardcoded \`font-family\` on elements.

### JavaScript

- Load JS libraries from a **CDN \`<script>\`**, not npm bundles. Small custom
  behavior goes in inline \`<script>\`.
- Component scripts target a **wrapper class**
  (\`document.querySelectorAll('.navbar').forEach(...)\`), never \`getElementById\`.

### Real, static HTML — not a client-rendered SPA

- Every page contains its **real content as static HTML**. Never ship an empty
  \`<div id="root">\` hydrated by a client bundle — it imports blank.

### Images

- Plain \`<img src="/images/hero.jpg" alt="…">\`; images live in a served folder.
  No build-time hashed imports.

### Editable text — wrap every text run

- **Never leave bare text next to an inline element.** If any part of a
  heading/sentence is wrapped (color, bold, link), wrap **every** run in its own
  element (keep the spaces inside the spans). If a whole line needs one accent
  color, put it on the heading itself so it stays one editable Text node.

### Mark editable content with \`data-sa\`

- Add \`data-sa="text:section.field"\` / \`data-sa="image:section.field"\` to every
  heading, paragraph and image the tenant will change. Lowercase, unique per
  page, stable — never rename a key once set.

### Pages & shared sections

- Each page is its own \`.html\` file (\`index.html\` → home, \`about.html\` →
  \`/about\`, …).
- Keep nav, header and footer **structurally identical across pages** so Instatic
  promotes them to one shared component.
- Set the nav active state at runtime with a small \`<script>\` reading
  \`location.pathname\` — do not bake a different active class into each page. Also
  style \`a[aria-current="page"]\`.`;

/**
 * Compose the full CMS contract block. `ruleBody`, when provided, is the live
 * contents of the operator's rule file; otherwise the embedded fallback is used.
 */
export function renderCmsOutputContract(ruleBody?: string): string {
  const body =
    ruleBody && ruleBody.trim().length > 0 ? ruleBody.trim() : EMBEDDED_TEMPLATE_RULE;
  return `${CMS_CONTRACT_PREAMBLE}\n\n---\n\n### Website build rule (authoritative — read live from the operator's rule file)\n\n${body}\n\n${CMS_CONTRACT_SELF_AUDIT}`;
}

// mtime cache so we read the file only when it actually changes. Keyed on the
// resolved path so a config change (different file) also busts it.
let ruleCache: { path: string; mtimeMs: number; body: string } | undefined;

/**
 * Read the operator's CMS rule file (path from `OD_CMS_RULE_FILE`), cached by
 * modification time. Returns `undefined` when the env var is unset or the file
 * is missing/unreadable — callers fall back to the embedded rule. Editing the
 * file bumps its mtime, so the next call returns the new contents without any
 * restart.
 */
export function loadTemplateRuleBody(): string | undefined {
  const rulePath = (process.env.OD_CMS_RULE_FILE ?? '').trim();
  if (!rulePath) return undefined;
  try {
    const st = statSync(rulePath);
    if (ruleCache && ruleCache.path === rulePath && ruleCache.mtimeMs === st.mtimeMs) {
      return ruleCache.body;
    }
    const body = readFileSync(rulePath, 'utf8');
    ruleCache = { path: rulePath, mtimeMs: st.mtimeMs, body };
    return body;
  } catch {
    return undefined; // missing / unreadable → embedded fallback
  }
}
