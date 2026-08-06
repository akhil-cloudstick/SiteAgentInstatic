# SiteAgent — Website Build Rule (exactly what Instatic's "Import Site" accepts)

This is the authoritative contract for building a website so it imports into **Instatic** perfectly — every style, color, font, animation, image, and page intact — and stays **fully editable** for the tenant (the editor shows the correct design; publishing to Cloudflare looks identical).

Build to this rule and a page imports pixel-perfect with no manual fixes. Break it and the importer silently drops or blanks part of the page.

---

## The one thing to understand first (why these rules exist)

**Instatic's importer reads your HTML like a text file — it NEVER runs your JavaScript.** It walks the static HTML you delivered and turns each element into an **editable block** (a heading, an image, a text run, a button…). Then it reads your CSS into **editable style rules and color/font tokens**.

Two consequences drive everything below:

1. **All visible content must already exist as real, static HTML in the page source.** If JavaScript builds content after the page loads (a gallery, a product list, cards), the importer sees an empty container → that content imports **blank**.
2. **Styles must be plain CSS the importer can read.** Utility frameworks, `@layer`, and modern color functions in shorthands are silently dropped.

> **Compliance is about the TECHNIQUE, not the feature.** Animations, 3D effects, loading spinners, filterable galleries, carousels, tabs — **all of these are welcome**. You just build them with a *compliant technique* (CSS + behavioral JavaScript acting on already-present static markup), never with JavaScript that *generates content*. Never refuse a request because it "sounds like JS"; figure out the compliant way to build it and do that.

---

## ❌ These break the import — never output them

Each item: why it breaks, and the ✅ compliant way instead.

### 1. Content built by JavaScript at runtime — THE #1 rule
Galleries, product/blog lists, cards, pricing tables, testimonials, menus of items — any visible markup inserted by JS (`innerHTML`, `insertAdjacentHTML`, `document.createElement`, template strings, or a framework hydrating a root). The importer never runs JS, so it sees nothing → the section imports **blank**.

```html
<!-- ❌ WRONG — imports blank (the <div> is empty in the HTML) -->
<div id="gallery"></div>
<script>
  const items = [{img:'/images/a.jpg'}, {img:'/images/b.jpg'}];
  items.forEach(i => gallery.innerHTML += `<img src="${i.img}">`);
</script>
```
```html
<!-- ✅ CORRECT — every item is real static HTML -->
<div class="gallery">
  <img class="shot" src="/images/a.jpg" alt="Mountain trip">
  <img class="shot" src="/images/b.jpg" alt="Coast trip">
</div>
```
Write **every** item out as static HTML. (Filtering/sorting is still fine — see the effect cookbook — as long as the items themselves are in the HTML.)

### 2. Tailwind / utility-first CSS
Utility classes (`mb-4`, `flex`, `bg-gray-900`, `text-5xl`, variants like `md:flex`/`hover:…`), the Tailwind CDN `<script>`, and `@apply`. The class names survive on the element but **the styles are lost** — Instatic can't import utility classes as editable rules.

```html
<!-- ❌ WRONG — styles lost -->
<div class="bg-gray-900 text-white flex px-6 py-20">
  <h1 class="text-5xl font-bold text-red-500 mb-4">Welcome</h1>
</div>
```
```html
<!-- ✅ CORRECT — semantic classes + plain CSS -->
<section class="hero"><h1 class="hero-title">Welcome</h1></section>
<style>
  :root { --color-bg:#0d0d0d; --color-text:#fff; --color-accent:#ff3b30; }
  .hero { background: var(--color-bg); color: var(--color-text); display:flex; padding: 80px 24px; }
  .hero-title { font-size: 3rem; font-weight: 800; color: var(--color-accent); }
</style>
```

### 3. `@layer` (and `@import` / `@page` / `@namespace`)
The importer **drops the entire `@layer` block** — everything inside is lost (this is also why compiled Tailwind v4 output vanishes). Conditional/external `@import`, `@page`, and `@namespace` are dropped too. Write plain, source-ordered CSS.

### 4. Modern color functions inside a CSS *shorthand*
`oklch()`, `oklab()`, `lab()`, `lch()`, `color-mix()`, `color()` used **bare inside a shorthand** (`background:`, `border:`, `font:`) make the CSS parser drop the **whole declaration** — the element loses that color, silently.

```css
/* ❌ WRONG — the whole background is dropped */
.avatar { background: color-mix(in srgb, #f00, #fff 40%); }
.tag    { background: oklch(70% 0.15 230); }
```
```css
/* ✅ CORRECT — use a :root token, or the longhand (both survive) */
:root { --tone-sky: #cfe8ff; }
.avatar { background: var(--tone-sky); }
.tag    { background-color: oklch(70% 0.15 230); }   /* longhand is fine */
```
`#hex`, `rgb()`, `hsl()`, and `var(--token)` are always safe anywhere.

### 5. External stylesheets & wrong-source fonts
- ❌ External `<link rel="stylesheet">` to a CDN (only local stylesheets and Google Fonts links are read). Put your CSS in an inline `<style>`.
- ❌ `@fontsource` npm packages, non-Google font CDNs (Adobe/Typekit/Bunny/Fontshare), the **v1** Google Fonts URL (`/css?family=`), `gstatic` links, `.eot` fonts, and `local()`-only `@font-face`. → see **Fonts** for the ✅ ways.

### 6. Build-tool artifacts & SPA hydration roots
❌ `/_astro/…`, hashed `/assets/name-<hash>.js` chunks, ESM `import` of assets, and `<div id="root"></div>` + a client bundle. These render nothing at import (no JS is run) → blank page, and the bundle fails to process. Deliver server-rendered/static HTML.

### 7. Unsupported / unreachable images
- ❌ Formats the importer can't upload: **avif, ico, bmp, tiff, heic** → the `<img>` breaks. Use **jpg, png, webp, gif, svg** (video: mp4/webm).
- ✅ **Real photos are saved in for you.** Point `<img src>` at a **local `/images/name.jpg`** (give it a descriptive name + `alt`) OR a **real royalty-free photo URL** — OD downloads/creates the actual file under the site's `public/images/` and rewrites the ref before publish, so a referenced image is never a dead link. (Behind the scenes it captures the URL, or fetches a real photo for a bare local path, or writes an SVG placeholder if offline.)
- ❌ Still avoid: `data:` URIs and any path with a **`?query` or `#fragment`** (`/images/x.jpg?v=2`) → not uploaded.

### 8. Asset paths hardcoded inside `<script>` text
On import, HTML `src`/`srcset`/`href` and CSS `url()` are rewritten to the CMS `/uploads/…` path — but **URLs inside `<script>` text are NOT**. A hardcoded `/images/x.svg` in JS **404s** after import. Read the URL from an element's already-served `src` instead.

```html
<!-- ✅ swap reads the URL from the clicked item's own <img> (already rewritten to /uploads/) -->
<button class="row" data-id="cube"><img class="thumb" src="/images/cube.svg" alt="Cube"></button>
<img id="featured" src="/images/cube.svg" alt="">
<script>
  document.querySelectorAll('.row').forEach(function (row) {
    row.addEventListener('click', function () {
      var t = row.querySelector('.thumb');
      var f = document.getElementById('featured');
      f.src = t.src; f.alt = t.alt;      // resolves to /uploads/… after import
    });
  });
</script>
```

### 9. Inline event handlers
❌ `onclick="…"` / any `on*=` attribute is stripped on import. Attach behavior with `addEventListener` in a `<script>` instead.

### 9b. Empty controls whose icon is injected by JavaScript

A control that JS fills at runtime arrives at the CMS **empty** — the tenant sees the button's own border with nothing inside it, both on the canvas and on the published page's first paint. The icon was never in the markup, so there is nothing to import.

**JS may SWAP an icon; it must never CREATE it.** Ship the initial icon (or label) in the HTML and let the script change it.

```html
<!-- ❌ WRONG — imports as an empty bordered box -->
<button class="theme-toggle" aria-label="Toggle theme"></button>
<script>btn.innerHTML = isDark ? moonSvg : sunSvg</script>

<!-- ✅ RIGHT — the icon exists; JS only swaps which one shows -->
<button class="theme-toggle" aria-label="Toggle theme">
  <svg class="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>
  <svg class="icon-moon" viewBox="0 0 24 24" hidden><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z"/></svg>
</button>
<script>/* toggles [hidden] between the two — both already in the DOM */</script>
```

A control drawn purely by CSS is fine — `<button class="hamburger"><span></span><span></span></button>` has elements to style, so it renders. Only a control with **nothing at all** inside it is blocked.

### 10. Content hidden until JavaScript runs
The importer strips your `<script>`s from the **editing canvas**, so any content that only becomes visible once JS runs is **blank** there (it appears only on the published site). ❌ A full-screen loading overlay that a script removes; ❌ `opacity:0`/`visibility:hidden` content revealed only by a JS-added class (e.g. `IntersectionObserver` scroll reveals), or a hero whose words start `opacity:0`. Make the visible state the **default** and let CSS animate it in.

```html
<!-- ❌ WRONG — blank in the editor until JS adds .is-visible -->
<style>.reveal{opacity:0;transform:translateY(20px)} .reveal.is-visible{opacity:1;transform:none}</style>
<!-- ✅ RIGHT — visible by default; CSS animates it in on load (no JS needed) -->
<style>.reveal{animation:fadeUp .6s ease both} @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}</style>
```

---

## ✅ What imports perfectly (use freely)

**CSS**
- One or more inline `<style>` blocks (in `<head>` or `<body>`) → editable **style rules**.
- Inline `style="…"` on an element → kept on that element.
- `:root { --name: <color> }` → editable **color token** (any name). `#hex`/`rgb()`/`hsl()`/`var()` colors.
- `@media` (site breakpoints become responsive overrides; other queries become reusable conditions), `@supports`, `@container`, `@keyframes`.
- `transition`, `animation`, `transform`, `position: sticky`, `display:grid`/`flex`, gradients, `url()` backgrounds, pseudo-classes/elements, `:has()`.

**Selectors — style each component with a single semantic class.** Only a **single bare class** (`.hero`) becomes an editable/bindable rule the tenant can tweak per element. Compound/descendant/pseudo/element selectors (`.hero .title`, `h1`, `a:hover`) still apply visually but import as **ambient** (global) rules — not per-node editable. **Give every text element its own class and style it through that class** — never reach it with a descendant selector (see "Editability is automatic" below; this is checked and blocks the share).

**HTML content** — real semantic elements each become an editable block: `h1`–`h6`, `p`, `a`, `img`, `button`, `ul/ol/li`, `section/div/article/main/header/footer/nav/aside`, inline `svg` (icons), forms & inputs, tables. `id`, `data-*`, `aria-*`, and `role` are preserved (so behavioral scripts keep working).

**Behavioral JavaScript survives and re-runs on the published page.** Use it freely for *behavior on markup that already exists*: menu toggles, tabs, accordions, carousels, nav active-state, counters, image swaps that read from the DOM. Use `classList` / `setAttribute` / `aria-*` / `addEventListener`. Prefer plain (classic) `<script>` over ES modules. Load libraries (GSAP, Swiper, Alpine…) from a **CDN `<script>`**, never npm.

**Structure** — each `.html` file is a page (`index.html` → home `/`). Identical top-level `<nav>`/`<header>`/`<footer>` across pages are auto-promoted to one shared, edit-once component. (For active-state, set it at runtime — see below — don't bake a different class into each page.)

---

## Build any effect the compliant way (cookbook)

Whatever the tenant asks — in whatever words — build it like this. **Effects are never blocked; only content-generating JS is.**

| Tenant asks for… | Build it with… |
|---|---|
| animation, motion, "make it move", loading / buffering spinner | CSS `@keyframes` + `transition`/`animation` |
| 3D, tilt, parallax, hover effects | CSS `transform` / `perspective` (+ behavioral JS that only updates the *style* of existing elements) |
| filterable / sortable gallery, tabs, accordion, carousel, slider | ALL items as **static HTML**, then show/switch with CSS (`:has()`, `:target`, scroll-snap) or behavioral JS (`classList` on existing markup). Never build the items in JS. |
| counters, progress bars, "count up" | behavioral JS updating the **text/attributes of existing elements** |
| modal, dropdown, mobile menu | static markup + behavioral JS toggling a class |
| image swap / lightbox | static `<img>`s; swap by reading another element's `src` (never a hardcoded path) |

If a request *genuinely* can't be done inside these limits, build the **closest compliant version** and briefly tell the tenant what you adjusted and why — never ship the broken version, and never refuse just because a prompt mentioned "js" or "animation."

---

## Colors, fonts, images, editability — details

### Colors → `:root` tokens
Define every brand color as a `:root` custom property and use it via `var(--…)`. Instatic imports these as editable **color tokens** (change once, updates everywhere). Keep raw hex out of the rules where you can.

### Fonts
- **Google Fonts:** a `<link href="https://fonts.googleapis.com/css2?family=…&display=swap" rel="stylesheet">` (the **`/css2`** format only) — Instatic self-hosts it. Include every weight you use.
- **Self-hosted:** `@font-face` pointing at a bundled `.woff2` (or woff/ttf/otf).
- Reference fonts through a **`--font-*`** `:root` token (`--font-sans: "Inter", system-ui, sans-serif;` then `font-family: var(--font-sans)`) → editable **font token**. The token name must start with `--font-` and the value must be a quoted family / stack / include a generic keyword.
- ❌ Not: `@fontsource`, other font CDNs, the v1 `/css?family=` URL, `.eot`, `local()`-only faces, or a `font-family` for a family you never actually installed (it silently falls back).

### Images
- Use real `<img src="/images/x.jpg" alt="…">` (and `srcset`) for anything the tenant should see or swap → editable **Image block**, uploaded to `/uploads/…`. Byte-identical images are de-duplicated on re-share (no duplicate uploads).
- `background-image: url(/images/x.jpg)` works and is self-hosted, but is **not** an editable image (no alt, no media picker). Use it for decorative backgrounds; use `<img>` for content.
- Allowed: **jpg, png, webp, gif, svg** (+ mp4/webm), at a clean web-root path (`/images/…`) with **no** `?query`/`#fragment`, not `data:`. A **real photo URL is fine** — OD saves it into `public/images/` and rewrites the ref before publish (see ❌ §7).

### Layer naming — every block must say what it is

Instatic names each imported block from the element's own markup and shows that name in the **Layers** panel. It reads, in order: **`data-layer`** → first **meaningful class** → **`id`** → **`aria-label`** → the semantic tag. If an element offers none of those, the panel falls back to the module name and the tenant sees a wall of rows all called **"Container"** — unusable to scan, and the AI editor (which addresses blocks by name) then edits the wrong section.

**So: every structural element gets a meaningful class — outer sections *and* the blocks nested inside them.**

```html
<!-- ❌ WRONG — every row in the Layers panel reads "Container" -->
<section>
  <div class="container">
    <div class="wrapper"><h2>Our services</h2></div>
    <div><div></div><div></div></div>
  </div>
</section>
```
```html
<!-- ✅ CORRECT — Layers reads Services › Services Header › Services Grid › Service Card -->
<section class="services">
  <div class="services-header"><h2 class="services-title">Our services</h2></div>
  <div class="services-grid">
    <article class="service-card">
      <h3 class="service-card-title">Colour</h3>
      <p class="service-card-copy">Full colour and gloss.</p>
    </article>
  </div>
</section>
```

Naming rules:

- **Name the thing, not the layout.** `hero`, `services`, `pricing-table`, `testimonials`, `site-footer` — not `container`, `wrapper`, `row`, `col`, `grid`, `box`, `inner`, `content`, `item`, `block`. Those words are **ignored** when Instatic picks the name, so an element whose only class is one of them is unnamed.
- **Prefix children with their section** — `hero-title`, `hero-actions`, `service-card-title`. Reads as a path in the Layers tree and keeps names unique.
- **A layout wrapper is fine — name it too.** `class="services-grid"`, not `class="grid"`.
- **State and behaviour hooks don't count as names** (`is-open`, `has-error`, `js-toggle`, `u-hidden`) and neither does anything with a digit in it (`mt-4`, `col-6`). Put a real name alongside: `class="nav-drawer is-open"`.
- **Animation and layout hooks are not names either.** `reveal`, `fade`, `parallax`, `sticky`, `split`, `track` describe *how it moves or stacks*, not what it is — they read as "Reveal / Reveal / Split" in the Layers panel, which is no better than "Container". Keep the hook for your CSS and add the real name first: `class="why-us-media reveal"`, `class="why-us-split"`.
- **The name must match what the section visibly says.** If the block reads "How we travel", don't label it `aria-label="Why Travel Explorer"` — the tenant selects a layer and lands on copy that says something else, and the AI editor asked to "change the How we travel section" can't find it. Keep the class, the `aria-label` and the on-screen heading telling the same story.

```html
<!-- ❌ WRONG — Layers reads "Why Travel Explorer › Split › Reveal › Reveal" -->
<section class="section" aria-label="Why Travel Explorer">
  <div class="container split">
    <div class="reveal"><div class="split-image"><img …></div></div>
    <div class="reveal"><span class="eyebrow">How we travel</span><h2>Slow, small…</h2></div>
```
```html
<!-- ✅ CORRECT — Layers reads "How We Travel › How We Travel Split › How We Travel Media / Copy" -->
<section class="how-we-travel" aria-label="How we travel">
  <div class="how-we-travel-split container">
    <div class="how-we-travel-media reveal"><img …></div>
    <div class="how-we-travel-copy reveal"><span class="eyebrow">How we travel</span><h2>Slow, small…</h2></div>
```
- **`kebab-case`, `snake_case`, `BEM` and `camelCase` all work** — `hero__title`, `hero-title` and `heroTitle` all display as "Hero Title".
- **Escape hatch:** when the class must stay generic, set the name explicitly — `<div class="container" data-layer="Hero">` displays as "Hero". `data-*` attributes are preserved on import.
- Names are capped at 40 characters in the panel — keep them short.

This costs nothing (you already write one semantic class per component for styling — see **Selectors** above) and it is what makes the tenant's Layers panel, the AI editor, and the section icons all address the right block.

### Editability is automatic — no marker attribute needed
Instatic makes an element editable **by its type** — write a real `<h1>`, `<p>`, `<img>`, `<button>`, and it becomes an editable block automatically. **You do NOT need a `data-sa` (or any) marker attribute** — the importer doesn't use one; clean semantic HTML is enough.

**The goal: every single piece of text on the page must be individually selectable in the canvas and individually restyleable (its own colour, size, font, spacing).** Three hard rules get you there. All three are checked, and a page that breaks any of them is rejected at Share to CMS.

#### 1. Never leave bare text — every text run gets its own element

Text written **directly inside a container** has no element of its own. The importer keeps it as a no-wrapper text node, which means it **cannot be clicked in the canvas, cannot be highlighted, and can never be styled** — a dead end for the tenant. This applies to **every** container, not just headings: `<div>`, `<li>`, `<td>`, `<blockquote>`, `<figcaption>`, `<b>`, `<i>` — all of them.

```html
<!-- ❌ "Founded in Lisbon" has no element — un-selectable, un-styleable -->
<div class="stat-item">
  <strong>2011</strong>
  Founded in Lisbon
</div>
<!-- ✅ every run wrapped AND named -->
<div class="stat-item">
  <span class="stat-value">2011</span>
  <span class="stat-label">Founded in Lisbon</span>
</div>
```

The same trap closes on a heading the moment it contains **any** child element — the heading stops being a single text block and its loose runs become bare text:

```html
<!-- ❌ the plain white text isn't editable -->
<h1>Powering the AI era with <span class="accent">high-density compute</span> built to last.</h1>
<!-- ✅ every run wrapped (keep the spaces) -->
<h1><span>Powering the AI era with </span><span class="accent">high-density compute</span><span> built to last.</span></h1>
```
If the whole line uses one accent colour, put the colour on the heading itself (no inner span) so it stays a single editable node.

Also bare: `<li>Buy milk</li>` → `<li><span class="list-item-text">Buy milk</span></li>`.

**Safe parents** (their text becomes one editable block): `<h1>`–`<h6>`, `<p>`, `<span>`, `<small>`, `<strong>`, `<em>`, `<label>` — *only while they contain no child element* — plus `<a>` and `<button>`, which always keep their text.

#### 2. Every text element carries its own single, meaningful class

A class is what makes an element **individually** styleable. Without one, the tenant selects the text and the editor can only offer "add a class first" — colour, font and size stay locked.

```html
<!-- ❌ styleable only as a group -->
<h2>Our services</h2><p>Full colour and gloss.</p>
<!-- ✅ each one addressable on its own -->
<h2 class="services-title">Our services</h2>
<p class="services-copy">Full colour and gloss.</p>
```

#### 3. Give every text element its OWN unique class as well — unique first

A shared role class is right for the shared design, but on its own it means the tenant selects one label, changes its colour, and **all four change**. So every text element carries **two** classes: its own unique one **first**, then the shared role class. The CMS edits the first class by default, so a click-and-restyle affects exactly that element; switching to the shared pill restyles the whole set on purpose.

Declare the unique class even when it is empty — that is what makes it an editable style rule in the CMS.

```html
<!-- ❌ all four labels move together, and only together -->
<span class="stat-label">Founded in Lisbon</span>
<span class="stat-label">Max departures per year</span>
<!-- ✅ unique first, shared second -->
<span class="stat-label-1 stat-label">Founded in Lisbon</span>
<span class="stat-label-4 stat-label">Max departures per year</span>
```
```css
.stat-label   { font-size: 12px; letter-spacing: 0.14em; }  /* the whole set */
.stat-label-1 {}                                            /* just this one */
.stat-label-4 {}
```

Prefer a meaningful unique name where one exists (`.stat-label-departures`); a numeric suffix is fine otherwise. A CMS-side inline style is **not** a substitute — a re-share overwrites the page and wipes it.

> **Inside the shared `<header>`/`<nav>`/`<footer>`, the unique class must be the SAME on every page.** Those blocks are promoted to one shared component only while they are byte-identical across pages, so a per-page name (`nav-link-2` on one page, nothing on another) silently splits them into a separate copy per page — and editing the nav stops updating the other pages. Give chrome text elements reserved, page-independent names (`site-chrome-h1`, `site-chrome-f3`) and copy the block verbatim into every page. Only the active-state class (`is-active`) may differ per page; the importer strips it before comparing.

#### 4. Style through that single class — never a descendant selector

Only a **single bare class** (`.stat-value`) imports as an editable rule the tenant can change on one element. A descendant selector (`.stat-item strong`) imports as an **ambient** rule: it still renders correctly, but editing it changes **every** element it matches, so the tenant can't restyle just the one they clicked.

```css
/* ❌ edits hit all four stat blocks at once */
.stat-item strong { font-size: 22px; color: var(--fg); }
/* ✅ edits hit exactly the element the tenant selected */
.stat-value { font-size: 22px; color: var(--fg); }
```

### Shared blocks — mark anything that repeats: `data-shared="name"`

If the same block appears on more than one page (or twice on one page) — a CTA band, a contact strip, a newsletter box, a repeated card — put **`data-shared="a-name"`** on its outer element. The CMS turns each marked group into **one shared component**: it stays exactly where you put it on every page, and the tenant edits it **once** to update all of them. Without the marker each copy imports separately and the tenant has to repeat the same edit on every page.

```html
<!-- ✅ same block on 3 pages → ONE component named "Cta Band" -->
<section class="cta-band" data-shared="cta-band">
  <h2 class="cta-band-title">Ready when you are.</h2>
  <a class="cta-band-action" href="contact.html">Plan a trip</a>
</section>
```

**The copies must be byte-identical** — same markup, same classes, in the same order. The CMS groups by `(name + exact structure)`, so one different class splits the group and you silently get separate copies again. In particular, a shared block's **per-element unique classes must be the same on every page** (rule 3 above): name them from the block (`cta-band-title`), never from a per-page counter. Only the active-state class (`is-active`) may differ — the importer strips it before comparing.

Use one `data-shared` name per distinct block; don't reuse a name for blocks that differ.

### Shared nav / footer + active state
Keep `<nav>`/`<header>`/`<footer>` structurally identical across pages (they get promoted to one shared component). Set the nav active state at **runtime** with a small script (read `location.pathname`, toggle a class + `aria-current`), and scope component scripts to a **wrapper class**, not `getElementById` (so a shared component works on every page).

```html
<script>
(function () {
  var p = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-link').forEach(function (a) {
    var on = (a.getAttribute('href').replace(/\/$/, '') || '/') === p;
    a.classList.toggle('nav-link-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
})();
</script>
```

### Page `<head>`
Only `<title>` is read on import; favicon, meta description/OG, canonical, preload, and theme-color are ignored by the importer (set those in the CMS/publish settings, not relied on from the source).

---

## If a tenant asks for something that can't import

Don't block their workflow and don't lecture them. Figure out the compliant way (see the cookbook), build **that**, and add one short, plain-language line about what you adjusted — e.g. *"I built the gallery as static images so it works in your site editor; live filtering runs with CSS."* Only if it truly can't be done, say so simply and offer the closest thing that can.

---

## Quick checklist

- [ ] All visible content is **real static HTML** — nothing built by JS (`innerHTML`, lists, cards, galleries all written out).
- [ ] **No Tailwind/utility classes**, no `@apply`, no Tailwind CDN. Plain CSS, one semantic class per component.
- [ ] No `@layer` / `@import` / `@page` / `@namespace`.
- [ ] All CSS in inline `<style>`; brand colors as `:root` tokens; fonts as `--font-*` tokens.
- [ ] No modern color function (`oklch/color-mix/…`) bare inside a `background`/`border`/`font` **shorthand** — use a `var(--token)` or the longhand.
- [ ] Fonts via Google **`/css2`** `<link>` or self-hosted `@font-face` — no `@fontsource`, no other CDNs.
- [ ] Images are real `<img>` in **jpg/png/webp/gif/svg** (no avif/ico, no `data:`/`?query`) — a local `/images/…` path or a real photo URL (OD saves the file in).
- [ ] **Every section is visible with CSS alone** — no JS-dismissed loading overlay, no `opacity:0`/`visibility:hidden` content revealed only by a JS-added class.
- [ ] No hashed/`_astro` imports, no SPA hydration root.
- [ ] JavaScript is **behavior only** on existing markup (menus, tabs, swaps); no `on*=` inline handlers; no asset paths hardcoded in script text.
- [ ] **No bare text anywhere** — never text sitting directly inside a `<div>`/`<li>`/`<td>`/`<b>`/etc., and never a loose run beside a child element inside a heading. Every run is wrapped in its own `<span>`/`<p>`/heading so all of it is selectable.
- [ ] **Every text element carries its own single, meaningful class** — so the tenant can restyle that one piece of text (colour, size, font) on its own.
- [ ] **Every text element also has a UNIQUE class, listed first** (`class="stat-label-4 stat-label"`), declared in the CSS even if empty — otherwise editing one label restyles every label sharing that class.
- [ ] **Every repeated block carries `data-shared="a-name"`** (CTA band, contact strip, repeated card) and its copies are byte-identical — so the tenant edits it once instead of on every page.
- [ ] **`<header>`/`<nav>`/`<footer>` are byte-identical on every page** — same markup AND same classes (including the unique ones; use reserved `site-chrome-*` names). Only `is-active` may differ. Otherwise they stop being one shared component and each page keeps its own copy.
- [ ] **Style text through that single class, never a descendant selector** — `.stat-label { }`, not `.stat-item strong { }` (a descendant rule edits every match at once).
- [ ] **Every structural element carries a meaningful class** (`hero`, `services-grid`, `service-card-title`) — outer sections *and* nested blocks — so the Layers panel never reads "Container". Never rely on `container`/`wrapper`/`row`/`grid` alone.
- [ ] Effects (animation/3D/filters/carousels) built with CSS + behavioral JS, never content-generating JS.
