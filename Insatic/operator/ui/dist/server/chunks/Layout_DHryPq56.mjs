import { e as createComponent, o as renderHead, g as addAttribute, p as renderSlot, r as renderTemplate, h as createAstro } from './astro/server_D03FvIM3.mjs';
import 'piccolore';
import 'clsx';
/* empty css                         */

const BRAND_NAME = "Site Agent";
const BRAND_EMOJI = "🛰️";

const $$Astro = createAstro();
const $$Layout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Layout;
  const { title = BRAND_NAME } = Astro2.props;
  const path = Astro2.url.pathname;
  return renderTemplate`<html lang="en"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>${title} · ${BRAND_NAME}</title>${renderHead()}</head> <body> <header> <span class="brand">${BRAND_EMOJI} ${BRAND_NAME}</span> <nav> <a href="/"${addAttribute(path === "/" ? "active" : "", "class")}>Tenants</a> <a href="/settings"${addAttribute(path === "/settings" ? "active" : "", "class")}>Settings</a> </nav> </header> <main>${renderSlot($$result, $$slots["default"])}</main> </body></html>`;
}, "S:/InstaticSiteAgent/operator/ui/src/layouts/Layout.astro", void 0);

export { $$Layout as $ };
