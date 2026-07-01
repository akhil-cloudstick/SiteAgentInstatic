# SiteAgent — Website Build Rule

This rule is for **anyone rebuilding a website** so the finished project imports into **Instatic** correctly — with all styles, colors, animations, and pages intact — and the tenant gets full editing capability inside Instatic (editor shows the correct design, publish to Cloudflare looks exactly the same).

---

## What the output must be

A **project folder** with a standard static build inside it (e.g. `dist/`).

The tenant selects that folder in Instatic → **Ctrl + K → Import Site → select folder**.  
Everything must work from that single action. No manual steps after.

---

## Framework

Use **Astro** with `output: 'static'`.

---

## CSS — the most important rule

### Do NOT use Tailwind CSS or any utility-first CSS framework

Tailwind generates utility classes like `.bg-gray-900`, `.text-white`, `.flex`, `.mt-4`.  
Instatic cannot import or understand these. The styles will be lost after import.

### Use plain CSS with semantic classes and CSS custom properties

Write CSS the traditional way — one meaningful class per component, colors as CSS variables.  
This is exactly what Instatic imports as **color tokens** and **style rules**.

**Wrong — Tailwind (styles lost after import):**
```html
<div class="bg-gray-900 text-white min-h-screen flex flex-col items-center px-6 py-20">
  <h1 class="text-5xl font-bold text-red-500 mb-4">Welcome</h1>
</div>
```

**Correct — plain CSS (styles preserved in Instatic):**
```html
<div class="page-wrapper">
  <h1 class="hero-title">Welcome</h1>
</div>

<style>
  :root {
    --color-bg:      #0D0D0D;
    --color-surface: #141414;
    --color-text:    #ffffff;
    --color-accent:  #FF3B30;
  }

  .page-wrapper {
    background: var(--color-bg);
    color: var(--color-text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 80px 24px;
  }

  .hero-title {
    font-size: 3rem;
    font-weight: 800;
    color: var(--color-accent);
    margin-bottom: 16px;
  }
</style>
```

### CSS rules

- Define all brand colors as **CSS custom properties** in `:root` — Instatic imports these as **color tokens** (the tenant can change the brand color in one place and it updates everywhere).
- Give every section and element a **semantic class name** (`.hero`, `.navbar`, `.card`, `.footer-links`) — Instatic imports these as **style rules** the tenant can edit.
- Write all CSS in `<style>` blocks inside the `.astro` files or in a global `.css` file imported by the layout.
- CSS animations (`@keyframes`, `transition`, `animation`) are fully supported — write them in plain CSS.

### Verified to import pixel-exact

These common patterns were tested end-to-end (build → import → publish → diff against the original) and reproduce faithfully — use them freely:

- **Responsive breakpoints** — `@media (min-width: …)` / `(max-width: …)` overrides. Minified output (`@media(min-width:1024px)`, no space) imports correctly, and the widest matching breakpoint wins on the published page just like in the browser.
- **Sticky headers/sidebars** — `position: sticky; top: 0`. The published `<body>` grows with content, so a sticky element stays stuck for the whole scroll (not just one screen).
- **Icon buttons** — `<button><svg>…</svg></button>` (hamburger, close, chevrons). The inline `<svg>` and its `<line>`/`<path>`/`<circle>` children are preserved.
- **`line-height`** — buttons/cards/badges that rely on the browser default (`normal`) keep their exact height; the CMS does not force an opinionated `1.5`.

The tenant edits all of the above inside Instatic and re-publishes with the same result.

---

## Required `astro.config.mjs`

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    build: {
      assetsInlineLimit: 1048576,  // puts all CSS inside the HTML as <style> blocks
      cssCodeSplit: false,
    },
  },
});
```

---

## Fonts

### Google Fonts — use a `<link>` tag in the layout `<head>`

Instatic automatically detects Google Fonts CDN links and **self-hosts the font files** inside the CMS — no external CDN dependency in the published site.

```astro
<!-- src/layouts/Layout.astro -->
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
    rel="stylesheet"
  />
</head>
```

Then reference the font via a CSS custom property so Instatic imports it as an editable font token:

```css
:root {
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
```

**Rules:**
- Use the `fonts.googleapis.com/css2` URL format — this is the only Google Fonts URL format Instatic can parse and self-host.
- Always define the font via a `--font-*` CSS custom property in `:root`. Instatic imports these as **font tokens** the tenant can change in the Typography panel.
- Include all weights you use in the URL (`wght@400;500;600;700;800`) so the published site has them available.

### Self-hosted font files — put them in `public/fonts/`

If you have `.woff2` / `.ttf` font files, Instatic imports them automatically too:

```css
@font-face {
  font-family: "MyFont";
  src: url("/fonts/myfont-400.woff2") format("woff2");
  font-weight: 400;
}

:root {
  --font-body: "MyFont", sans-serif;
}
```

### Do NOT use

- **`@fontsource` npm packages** — these end up bundled in separate Vite chunks, not in the HTML, and are lost on import.
- **Other font CDNs** (Adobe Fonts, Bunny Fonts, Typekit) — only `fonts.googleapis.com/css2` links are auto-installed. Other CDN links are dropped.
- **`font-family` hardcoded directly on elements** — always use a `var(--font-*)` token so the font is editable in Instatic.

---

## JavaScript and animations

Load all JS libraries (GSAP, AOS, Swiper, Alpine.js, etc.) from a **CDN `<script>` tag** in the HTML — not installed via npm.

```html
<!-- Correct — comes with the HTML on import -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>

<!-- Wrong — ends up in a separate _astro/*.js file that won't import -->
import gsap from 'gsap';
```

Small custom JS (menu toggles, counters, scroll effects) can be written directly in `<script>` blocks in the HTML.

---

## Images and media

Put all images in the `public/` folder. Reference them with plain `<img>` tags.

```html
<!-- Correct -->
<img src="/images/hero.jpg" alt="Hero" />
<img src="/images/logo.svg" alt="Logo" />

<!-- Wrong — Astro hashes the file and breaks the path after import -->
import heroImg from './hero.jpg';
<Image src={heroImg} />
```

---

## Mark editable content with `data-sa`

Add a `data-sa` attribute to every piece of text or image the tenant will want to change.

```html
<h1 data-sa="text:hero.heading">Your headline here</h1>
<p  data-sa="text:hero.subheading">A short description.</p>
<img data-sa="image:hero.photo" src="/images/hero.jpg" alt="Hero" />
```

**Rules:**
- Format: `text:section.field` for text, `image:section.field` for images
- All lowercase: `hero.heading`, `about.body`, `services.card1.title`
- Unique per page — never reuse the same key on the same page
- Never rename a key once set

---

## Pages

Each `.astro` file in `src/pages/` becomes one HTML page:

```
src/pages/
  index.astro       →  homepage
  about.astro       →  /about
  services.astro    →  /services
  contact.astro     →  /contact
```

---

## Shared sections (nav, footer)

Use Astro components so nav and footer are identical across all pages:

```astro
<!-- src/components/Nav.astro -->
<nav class="navbar">
  <img data-sa="image:nav.logo" src="/images/logo.svg" alt="Logo" />
</nav>

<style>
  .navbar {
    position: sticky;
    top: 0;
    background: var(--color-surface);
    padding: 16px 24px;
  }
</style>
```

Instatic detects nav, header, and footer sections that are structurally
identical across pages and automatically promotes them to a single shared
Visual Component on import. Operators can edit once and all pages update.

---

## Nav active state — use JavaScript

**Do NOT use Astro's build-time path detection** (`Astro.url.pathname`) to
add an active class to the current nav link. Astro bakes a different active
item into every page's HTML. When Instatic deduplicates the shared nav it
cannot use 6 conflicting versions — it strips the baked-in active classes.

Use a `<script>` block inside `Nav.astro` instead. It reads the real URL at
runtime and always highlights the correct link:

```astro
<!-- src/components/Nav.astro -->
<nav class="navbar">
  <a class="nav-link" href="/">Home</a>
  <a class="nav-link" href="/services">Services</a>
  <a class="nav-link" href="/about">About</a>
  <a class="nav-link" href="/contact">Contact</a>
</nav>

<script>
(function () {
  var p = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-link').forEach(function (a) {
    var on = (a.getAttribute('href').replace(/\/$/, '') || '/') === p;
    a.classList.toggle('nav-link-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else     a.removeAttribute('aria-current');
  });
})();
</script>

<style>
  .nav-link-active {
    /* active style here */
  }
  /* OR use the standard attribute — both work: */
  a[aria-current="page"] {
    font-weight: 700;
  }
</style>
```

Instatic also injects `aria-current="page"` server-side on the matching link
when publishing, so screen readers and CSS `[aria-current="page"]` selectors
work even without JavaScript.

---

## Component scripts — scope to a wrapper class, not `getElementById`

Scripts for interactive components (hamburger menus, accordions, tabs,
dropdowns) must target a **wrapper class**, not a hard-coded element ID.
When the component is shared across pages, `getElementById` only finds it on
the page where the ID was first defined.

**Wrong — breaks when the component is reused on other pages:**
```js
document.getElementById('menu-btn').addEventListener('click', function () {
  document.getElementById('mobile-menu').classList.toggle('open');
});
```

**Correct — works on every page the component appears on:**
```js
document.querySelectorAll('.navbar').forEach(function (nav) {
  nav.querySelector('.menu-btn').addEventListener('click', function () {
    nav.classList.toggle('open');
  });
});
```

---

## Build and hand over

```bash
npm run build
```

Hand the person the **`dist/` folder**.

They open their Instatic → **Ctrl + K → Import Site → select the `dist/` folder → Continue → Import**.

The site appears with:
- Correct colors (imported as color tokens — editable)
- Correct styles (imported as style rules — editable)
- All pages
- All images

The tenant can then edit content, restyle, change colors, add pages, and publish to Cloudflare — all inside Instatic.

---

## Checklist

- [ ] `output: 'static'` in `astro.config.mjs`
- [ ] `assetsInlineLimit: 1048576` and `cssCodeSplit: false` in vite build config
- [ ] **No Tailwind CSS** — plain CSS only
- [ ] All brand colors defined as CSS custom properties in `:root`
- [ ] Every section/component has a semantic class name (`.hero`, `.navbar`, `.card`)
- [ ] **Fonts loaded via Google Fonts `<link>` tag** (fonts.googleapis.com/css2) OR self-hosted `.woff2` files in `public/fonts/` — no `@fontsource` npm packages, no other font CDNs
- [ ] All fonts referenced via `--font-*` CSS custom properties in `:root`
- [ ] All JS libraries loaded from CDN `<script>` tags — not npm packages
- [ ] All images in `public/` as plain `<img src="/...">` tags
- [ ] All pages have real HTML content — no JavaScript-rendered blank pages
- [ ] `data-sa` markers on all headings, paragraphs, and images the tenant will edit
- [ ] `npm run build` runs without errors
- [ ] `dist/` folder exists with `.html` files
