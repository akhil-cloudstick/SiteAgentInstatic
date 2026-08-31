# Import compliance — what went wrong and how to not repeat it

**Audience:** anyone building static pages that will be imported into MMS-CMS (Instatic).

This is the field report from the Global Nettech batch (1 pilot page → 52 pages). Every issue
below was a **page/CSS authoring** problem — something the build did that the importer cannot
carry. None of it needed a change to the site design, and all of it was invisible when the page
was opened directly in a browser.

That last point is the theme of this document:

> **A page can render perfectly in Chrome and still import broken.**
> A browser applies CSS that the CMS does not. "It looks right in the browser" is not evidence.

---

## The one rule behind almost all of it

The CMS turns your CSS into **editable style rules**, and it can only do that when a rule is
attached to a **class**.

A rule is editable **only when the *subject* of its selector is a class** — the subject being
the last simple selector, the thing actually being styled.

| selector | subject | imports as | editable? |
|---|---|---|---|
| `.section-title { … }` | `.section-title` | class rule `section-title` | ✅ yes |
| `h1, h2, h3 { … }` | `h1`/`h2`/`h3` | ambient | ❌ no |
| `.feature-card h3 { … }` | `h3` | binds to `.feature-card` | ❌ no — styles the card, not the h3 |
| `.card > .card__title { … }` | `.card__title` | class rule `card__title` | ✅ yes |

`.feature-card h3` is the one that catches everybody: the selector *contains* a class, so a
"does this mention a class?" check passes it — but the declarations land on the card, and the
heading gets nothing.

---

## Issue 1 — Text colour disappeared (headings rendered pale / unreadable)

**Symptom.** In the CMS canvas, headings rendered in a washed-out colour on a light background —
unreadable. The same file in a browser was correct, dark navy.

**Cause.** The colour lived on a bare tag selector:

```css
h1, h2, h3, h4, h5 { font-family: var(--font-heading); font-weight: 800; color: var(--text); }
.od-title {}          /* the element's own class — empty */
.section-title {}
```

That tag rule imports as an *ambient* rule: not editable and not reliably applied in the canvas.
With nothing on the element's own class, the heading fell back to an inherited colour.

The paragraph directly beneath it was fine, because its colour came through a class subject
(`.section-head .section-sub`). Same page, same token — the only difference was whether a class
was the subject of the selector.

**Fix.**

```css
.od-title {
  font-family: var(--font-heading);
  font-size: clamp(1.8rem, 3.5vw, 2.6rem);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--text);
}
```

Bare tag rules (`h1…h5`, `p`, `a`, `body`) may set **inherited defaults only**. Every heading,
paragraph, link and label needs its own class carrying what it actually needs.

### 1a — Empty stub classes are not compliance

An earlier revision emitted **439 empty stubs** (`.od-title {}`) to satisfy "declare the bare
class", while leaving all real styling on tag and descendant selectors. That satisfies the words
and fixes nothing. **The class must carry the declarations.**

### 1b — The self-test that lied

That revision also shipped with its own verification: *"delete every rule with no class anywhere
in its selector — 13 rules — and re-render; identical."* The render came back clean and the pages
were still broken.

The definition is wrong. `.feature-card h3` **has** a class in it, so it survived that strip and
kept painting the heading. The correct test is **subject-is-a-class**, per the table above.

If you write your own verification, verify the verification.

---

## Issue 2 — Photos delivered as CSS backgrounds are not editable

**Symptom.** A banner image could not be changed from the CMS — no media picker, no swap.

**Cause.**

```html
<div class="solution-banner__bg banner--media"></div>
```
```css
.banner--media { background-image: url('/images/banner-media.jpg'); }
```

A `background-image` imports as a plain style declaration, not an Image block: no `alt`, no media
picker, so the tenant can never replace it.

**Fix.** Any **photograph, logo, product shot or screenshot** must be a real `<img>` — including
full-bleed behind text. Keep the gradient scrim as CSS.

```html
<div class="solution-banner">
  <img class="solution-banner__bg" src="/images/banner-media.jpg" alt="Media &amp; entertainment">
  <div class="solution-banner__overlay"></div>
  <div class="solution-banner__content">…</div>
</div>
```
```css
.solution-banner          { position: relative; overflow: hidden; isolation: isolate; }
.solution-banner__bg      { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
.solution-banner__overlay { position: absolute; inset: 0; z-index: -1; background: linear-gradient(90deg, rgba(0,15,43,.95), rgba(0,15,43,.12)); }
```

Same rendering; the tenant gets a normal editable Image block.

**Also covered:** the shorthand form (`background: linear-gradient(…), url(photo.jpg) center/cover …`)
and photo URLs held in a custom property (`--hero-img: url(photo.jpg)`). Gradients, repeating
patterns and `.svg` textures are legitimate backgrounds and are fine.

---

## Issue 3 — Text reached through a descendant selector

**Symptom.** The tenant selects a heading, edits it, and the change lands on the whole block
instead — or restyles several elements at once.

**Cause.** `.solution__body h3 { font-size: … }`, `.mega__links li`, `.footer__col ul li`,
`.stat-item strong` — the rule binds to the nearest class (`.solution__body`), never to the text.

**Fix.** Give the text element its own class, move the declarations onto it, delete the descendant
rule.

```css
/* ❌ */  .stat-item strong { font-weight: 700; }
/* ✅ */  .stat-value       { font-weight: 700; }
```

---

## Issue 4 — Every text element needs its own unique class

**Symptom.** Restyling one label in the CMS restyled four others.

**Cause.** The element carried only shared classes.

**Fix.** Unique class **first**, shared role class after, and declare the unique one:

```html
<span class="stat-label-4 stat-label">Uptime</span>
```
```css
.stat-label-4 {}
```

Applies to `<option>` elements inside `<select>` too.

---

## Issue 5 — Utility classes

**Symptom.** Spacing lost after import.

**Cause.** `mt-2` / `mt-3` / `mt-4` and similar utility classes are not imported.

**Fix.** Remove them from the markup and fold the value into the element's own semantic class.

```html
<!-- ❌ -->  <p class="lead mt-3">   +  .mt-3 { margin-top: 24px; }
<!-- ✅ -->  <p class="lead">        +  .lead { margin-top: 24px; }
```

---

## Issue 6 — Classes in the markup with no CSS on the page

**Symptom.** Elements imported unstyled.

**Cause.** A stylesheet was referenced but its contents were never inlined, so ~39 classes used in
the markup had no rule anywhere in the page.

**Fix.** Every class in the markup needs its rule inside that page's `<style>` block. Confirm
`assetsInlineLimit: 1048576` and `cssCodeSplit: false` in the Vite build config so CSS lands in
the HTML. Delete genuinely dead classes rather than inventing styling for them.

---

## Issue 7 — Content built by JavaScript

**Symptom.** Sections render blank in the CMS canvas.

**Cause.** An inline script writes `innerHTML` / `insertAdjacentHTML` / `outerHTML`. The importer
strips scripts from the editing canvas, so anything only JS creates is not there.

**Fix.** Ship visible content as static HTML. JavaScript is for *behaviour on markup that already
exists* — toggles, tabs, carousels, nav active-state — not for producing the content.

Same family: content hidden until JS runs (a `.reveal` at `opacity: 0`, a full-viewport overlay)
renders blank on the canvas. Make it visible with CSS alone.

---

## Issue 8 — Bare text next to an inline element

**Symptom.** The tenant can edit the coloured word in a heading but not the rest of the sentence.

**Cause.** A heading that mixes bare text with an inline child turns into a container; the loose
runs become "no-wrapper" text nodes with no clickable box on the canvas.

**Fix.** If any part is wrapped, wrap every part — and keep the spaces inside the spans.

```html
<h1>
  <span>Powering the AI era with </span>
  <span class="accent">high-density compute</span>
  <span> built to last.</span>
</h1>
```

---

## The two files

| file | what it is |
|---|---|
| `templateRule.md` | the contract — the full build rule, with the ❌/✅ patterns for everything above |
| `check-template-rule.mjs` | the gate — a linter that reports, per page, what will import wrong |

`check-template-rule.mjs` needs **Node only**. No `npm install`, no dependencies.

### Where to put the checker

It can live anywhere — it only reads the folder you pass it, and never modifies anything.

**Option A — keep it in one fixed place (recommended).** e.g. `C:\tools\check-template-rule.mjs`,
then pass the output folder:

```bash
node C:\tools\check-template-rule.mjs C:\newfolder\myproject
```

Preferred, because the `.mjs` never ends up inside the folder you hand over or import.

**Option B — drop it inside the project.**

```bash
cd C:\newfolder\myproject
node check-template-rule.mjs .
```

### Which path to pass

The folder that **directly contains the `.html` files**. Subfolders are walked automatically, so
one command covers the whole batch.

| your layout | pass |
|---|---|
| `C:\newfolder\myproject\index.html` | `C:\newfolder\myproject` |
| `C:\newfolder\myproject\dist\index.html` | `C:\newfolder\myproject\dist` |

If unsure, pass the top folder — it recurses and will find them either way. Quote any path
containing spaces: `node C:\tools\check-template-rule.mjs "C:\my folder\project"`.

Only `.html` files are read; the `.mjs`, images, JSON and everything else are ignored.

### Running it

```bash
npm run build
node check-template-rule.mjs dist
```

It also takes a single file or several paths:

```bash
node check-template-rule.mjs dist/index.html
node check-template-rule.mjs dist build/preview
```

### Reading the output

Per page, one line per rule:

- **PASS** — fine
- **WARN** — worth a look; will not break the import
- **FAIL** — *will* import wrong; must be fixed

Each FAIL names the offending selector or element and what to do about it. The last line is the
`Overall:` verdict across all pages.

### Using it as a gate

**Exit code 0 = every page passed. Non-zero = at least one FAIL.** Wire it into the build so a
non-compliant batch cannot be handed over:

```json
"scripts": {
  "build": "astro build",
  "verify": "node check-template-rule.mjs dist",
  "ship": "npm run build && npm run verify"
}
```

**Hand-over rule: only ship a batch that exits 0.**

### Scale

Run it across the whole batch, never a sample. In the 52-page batch a fix was applied per
role-class instead of per element — the homepage was correct while other pages were not. At
100–500 pages a sampled check is worthless; only a per-page count is evidence. Report the
per-page numbers in the hand-over notes.

### Two caveats

- It is a **text linter, not a browser**. It catches the structural things that break an import;
  it cannot tell you a page looks right. Still eyeball one page after importing.
- When verifying a fix, **import into a clean site**. Import *merges* — re-importing onto a tenant
  that already holds the previous version leaves the old rules in place and the old page on
  screen, so a correct fix looks like it changed nothing. This cost us a full debugging round.
