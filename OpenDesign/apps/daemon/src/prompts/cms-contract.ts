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
 * characteristics (real static HTML content, no Tailwind, `:root` color tokens,
 * semantic classes, fonts, editable-text wrapping, multi-page/shared nav), and
 * treat any Astro/`dist/`/`npm run build` mechanics in the file as background
 * context rather than steps to perform. `CMS_CONTRACT_SELF_AUDIT` pins the
 * silent self-check.
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

**How the importer works (why these rules exist).** Instatic reads your HTML like
a text file and **never runs your JavaScript**; it turns each element into an
editable block and reads your CSS into editable rules and tokens. So all visible
content must be real static HTML, and the CSS must be plain CSS it can parse.

**How to read the rule below.** It is the operator's authoritative "Website Build
Rule". It may be written for a person building the site with Astro — it can
mention \`astro.config.mjs\`, \`dist/\`, \`npm run build\`, or \`src/pages/\`. You do
NOT use Astro: you write the HTML/CSS files directly and they are imported
exactly as written. So apply every **output characteristic** the rule specifies
and treat the Astro/build-tooling mechanics as background context, not steps to
run.

**Precedence.** If an attached skill, design system, template, or your own prior
instinct would produce Tailwind utility classes, a Tailwind CDN/runtime, a
client-rendered React/Vue single-page app, JavaScript-generated content,
\`@fontsource\` imports, hashed asset imports, or any framework build output, this
contract OVERRIDES it. A Tailwind-delivered design system is a source of token
**values** only — bind those values into \`:root\` custom properties and write
semantic classes, never its utility classes. When any rule elsewhere in this
prompt conflicts with the contract below, the contract wins.

**Hard requirements — the most-violated rules. Get these EXACTLY right:**
1. **All visible content is REAL STATIC HTML — never built by JavaScript.** The
   importer reads the HTML as text and never runs your JS, so a gallery / product
   list / cards / pricing built with \`innerHTML\` / \`createElement\` / template
   strings imports **blank**. Write every item out as static markup. \`<script>\`
   is for BEHAVIOUR on markup that already exists (menus, tabs, swaps), never for
   creating content. ❌ \`<div id="grid"></div><script>…grid.innerHTML=…</script>\`
   → ✅ every card written as real HTML.
2. **ZERO utility / Tailwind classes — not even one.** No \`mb-4\`, \`flex\`, \`px-6\`,
   \`bg-gray-900\`, no variants (\`md:flex\`, \`hover:...\`), no Tailwind CDN, no
   \`@apply\`, and no \`@layer\` (the importer drops the whole block). Write a
   semantic class (\`.hero\`, \`.card\`) with real CSS.
3. **One inline \`<style>\` per page.** Put ALL CSS there. NEVER link an external
   stylesheet — the only allowed \`<link>\` is a Google Fonts
   \`fonts.googleapis.com/css2\` one.
4. **Every brand color is a \`:root\` \`--…\` token**, used via \`var(--…)\`. And NEVER
   put a modern color function (\`oklch\`/\`lab\`/\`lch\`/\`color-mix\`) bare inside a
   \`background\`/\`border\`/\`font\` **shorthand** — it is silently dropped and the
   element loses its color. Use \`var(--token)\` or the longhand (\`background-color:\`).
5. **Real photos as \`<img>\` — OD saves them into the site for you.** Use a real
   \`<img src="/images/…" alt="…">\` (jpg/png/webp/gif/svg) for any photo the tenant
   may swap — not a CSS \`background-image\`, not inline \`<svg>\` for content. You may
   point \`src\` at a **local \`/images/name.jpg\` path** (give it a descriptive name +
   \`alt\`) OR a **real royalty-free photo URL**; either way OD downloads/creates the
   real image file under the site before it publishes, so never worry that a file
   "doesn't exist yet". No avif/ico. Never hardcode an asset path inside \`<script>\`
   text (it 404s — read it from the DOM).
6. **Wrap every text run.** If any part of a heading/sentence is wrapped in an
   inline element (span/strong/em/link), wrap EVERY part in its own element so
   each is editable — never leave bare text beside a wrapped word.
7. **Every section is visible WITHOUT JavaScript.** The importer strips your
   \`<script>\`s from the editing canvas, so anything hidden until JS runs shows
   **blank** there. Never gate content on JS: no full-screen loading overlay that
   only a script removes, and no \`opacity:0\`/\`visibility:hidden\` content that only
   a JS-added class reveals. Make the visible state the DEFAULT; let animation only
   ENHANCE (CSS \`@keyframes\`/\`animation\` on load; scroll-reveals that start visible).
   ❌ \`.reveal{opacity:0}\` shown by a JS \`IntersectionObserver\` → ✅ \`.reveal{animation:fadeUp .6s both}\` (CSS, ends visible).

**Build the compliant TECHNIQUE — never keyword-block.** Tenants ask for features
in their own words ("add js", "animation", "a buffering spinner", "a 3D tilt", "a
filterable gallery" — expect many phrasings). Do NOT refuse because a prompt
mentions "js"/"animation": almost every effect IS achievable compliantly (CSS
animations/transitions/transforms, and behavioral JS acting on already-present
static markup). Work out HOW the feature would be built and build it the compliant
way; avoid only the specific technique that breaks the import (content-generating
JS). If something genuinely can't be done within these limits, build the closest
compliant version.

**Talk to the tenant plainly, no jargon.** Do not dump this contract, the rule, or
a compliance report on the user. But when you adapt a request for CMS
compatibility, add one short plain-language line about what you changed (e.g. "I
built the gallery as static images so it works in your site editor"). Never
silently ship a non-compliant page.`;

const CMS_CONTRACT_SELF_AUDIT = `### Silent self-audit before you finish

Before ending any turn that created, edited, or updated a page, re-read the HTML
you wrote and verify it against the rule above:

1. Every visible section is real static HTML — nothing built by JS (\`innerHTML\`,
   lists, cards, galleries all written out as markup).
2. No Tailwind / utility classes, no \`@layer\`, no Tailwind or SPA runtime.
3. All CSS inline; brand colors are \`:root\` tokens; components have single
   semantic class names. No modern color function (\`oklch\`/\`color-mix\`/…) bare in
   a \`background\`/\`border\` shorthand.
4. Fonts via Google \`/css2\` \`<link>\` or self-hosted \`@font-face\`, through
   \`--font-*\` tokens.
5. Images are real \`<img>\` in jpg/png/webp/gif/svg (no avif/ico) — a local
   \`/images/…\` path or a real photo URL (OD saves the file in). No asset paths
   hardcoded in \`<script>\` text.
6. JS is behaviour only on existing markup; no \`on*=\` inline handlers; component
   scripts scoped to a wrapper class.
7. No bare text beside an inline element. Shared nav/footer identical across
   pages; nav active state set at runtime.
8. **Every section is visible with CSS alone** — no full-screen loading overlay
   that only JS removes, no \`opacity:0\`/\`visibility:hidden\` content that only a
   JS-added class reveals (it would be blank in the editing canvas).

Fix every violation **in place** before you finish. Do not report the audit or
the rule to the user — just deliver the corrected, compliant page (with a one-line
note only if you adapted a requested feature for CMS compatibility).`;

/**
 * Offline fallback used only when the rule file is unset or unreadable. This is
 * the OD-native distillation of `templateRule.md`; the file on disk is the
 * source of truth whenever it is available.
 */
const EMBEDDED_TEMPLATE_RULE = `### The #1 rule — all content is static HTML

- **Never build visible content with JavaScript.** The importer reads the HTML as
  text and never runs your JS, so a gallery / list / cards / pricing built with
  \`innerHTML\` / \`createElement\` / template strings imports **blank**. Write every
  item out as real static HTML. \`<script>\` is for BEHAVIOUR on markup that already
  exists (menus, tabs, image swaps), never for creating content.

### CSS

- **Never use Tailwind or any utility-first CSS** — no utility classes (\`flex\`,
  \`bg-gray-900\`, \`px-6\`, \`text-5xl\`), no Tailwind CDN, no \`@tailwind\`/\`@apply\`.
  Instatic can't import these and the styles are lost.
- **Never use \`@layer\`** (or \`@import\`/\`@page\`/\`@namespace\`) — the importer drops
  the whole block. Write plain, source-ordered CSS.
- **Plain CSS, one semantic class per component** (\`.hero\`, \`.navbar\`, \`.card\`) —
  imported as editable style rules. Style each component with a single class (a
  compound/descendant selector imports as a non-editable global rule).
- **All CSS ships inline** in \`<style>\` blocks. No external stylesheet \`<link>\`
  (except a Google Fonts one).
- \`@keyframes\`, \`transition\`, \`animation\`, \`transform\`, \`position: sticky\`,
  \`@media\`, gradients, and inline \`<svg>\` icons all import — use them freely.

### Color / fonts → tokens in \`:root\`

- Define **every brand color as a \`:root\` custom property** and use \`var(--…)\` —
  imported as editable color tokens. Colors as \`#hex\`/\`rgb()\`/\`hsl()\`/\`var()\`.
- **Never put a modern color function (\`oklch\`/\`lab\`/\`lch\`/\`color-mix\`) bare inside
  a \`background\`/\`border\`/\`font\` shorthand** — it is silently dropped and the
  element loses its color. Use a \`:root var(--token)\` or the longhand
  (\`background-color: oklch(...)\`).
- Load fonts with a **Google Fonts \`/css2\` \`<link>\`** or self-hosted \`.woff2\` via
  \`@font-face\`; reference them through a \`--font-*\` \`:root\` token. No \`@fontsource\`,
  no other font CDNs, no v1 \`/css?family=\` URL.

### JavaScript — behaviour only

- Small custom behaviour goes in inline \`<script>\`; load libraries from a CDN
  \`<script>\`, never npm. Component scripts target a **wrapper class**, not
  \`getElementById\`. No inline \`on*=\` handlers (use \`addEventListener\`).
- Never hardcode an asset path inside \`<script>\` text (it 404s after import) —
  read image URLs from an existing element's \`src\`.
- Build effects the compliant way: animation → CSS \`@keyframes\`; 3D/tilt → CSS
  \`transform\`; filterable gallery/tabs/carousel → all items as static HTML shown
  via CSS or behavioral JS on existing markup — never build the items in JS.

### Images — real photos, OD saves them in

- Plain \`<img src="/images/hero.jpg" alt="…">\` in jpg/png/webp/gif/svg. Point \`src\`
  at a **local \`/images/name.jpg\`** (descriptive name + \`alt\`) or a **real
  royalty-free photo URL** — OD downloads/creates the real file under the site
  before publish, so a referenced image is never a dead link. No avif/ico, no
  \`?query\`, no build-time hashed imports; don't hardcode paths inside \`<script>\`.

### Content visible without JavaScript

- The importer strips your \`<script>\`s from the editing canvas, so anything hidden
  until JS runs is **blank** there. Never gate content on JS: no full-screen
  loading overlay dismissed only by a script, no \`opacity:0\`/\`visibility:hidden\`
  content revealed only by a JS-added class. Make the visible state the DEFAULT and
  let CSS \`@keyframes\`/\`animation\` only enhance (a scroll-reveal must start visible).

### Real, static HTML — not an SPA

- Every page contains its **real content as static HTML**. Never ship an empty
  \`<div id="root">\` hydrated by a client bundle — it imports blank.

### Editable text — wrap every text run

- Elements become editable automatically by type (write real \`<h1>\`/\`<p>\`/\`<img>\`);
  no marker attribute is needed. **Never leave bare text next to an inline element**
  — if any part of a heading/sentence is wrapped (color/bold/link), wrap **every**
  run in its own element (keep the spaces). If a whole line needs one accent color,
  put it on the heading itself so it stays a single editable Text node.

### Pages & shared sections

- Each page is its own \`.html\` file (\`index.html\` → home). Keep nav/header/footer
  **structurally identical across pages** so Instatic promotes them to one shared
  component. Set the nav active state at runtime with a small \`<script>\` reading
  \`location.pathname\`; also style \`a[aria-current="page"]\`.`;

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
