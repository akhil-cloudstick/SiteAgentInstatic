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

**Selectors — style each component with a single semantic class.** Only a **single bare class** (`.hero`) becomes an editable/bindable rule the tenant can tweak per element. Compound/descendant/pseudo/element selectors (`.hero .title`, `h1`, `a:hover`) still apply visually but import as **ambient** (global) rules — not per-node editable. Prefer one meaningful class per component.

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

### Editability is automatic — no marker attribute needed
Instatic makes an element editable **by its type** — write a real `<h1>`, `<p>`, `<img>`, `<button>`, and it becomes an editable block automatically. **You do NOT need a `data-sa` (or any) marker attribute** — the importer doesn't use one; clean semantic HTML is enough.

**But wrap every text run.** If part of a heading/sentence is wrapped in an inline element (for color/bold/a link), wrap **every** part in its own element too — otherwise the loose text next to it isn't selectable in the editor.

```html
<!-- ❌ the plain white text isn't editable -->
<h1>Powering the AI era with <span class="accent">high-density compute</span> built to last.</h1>
<!-- ✅ every run wrapped (keep the spaces) -->
<h1><span>Powering the AI era with </span><span class="accent">high-density compute</span><span> built to last.</span></h1>
```
If the whole line uses one accent color, put the color on the heading itself (no inner span) so it stays a single editable node.

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
- [ ] No bare text beside an inline element — every run wrapped so all parts are editable.
- [ ] Effects (animation/3D/filters/carousels) built with CSS + behavioral JS, never content-generating JS.
