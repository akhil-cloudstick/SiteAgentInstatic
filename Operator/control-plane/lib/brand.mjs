// What an Operator's customers see (R5, AC-A5.2).
//
// An agency reselling the platform cannot show its own customers the
// platform's name, so an Operator carries a brand — a logo, a name and an
// accent colour — and its projects wear it. The rule, from the target
// architecture: branding flows down EXACTLY one level. An Operator's branding
// replaces the platform's across everything that Operator owns; a Business
// sitting directly under the Platform Owner keeps MMSBUILD's.
//
// That rule needs no code of its own. A project's operator_id is stamped by
// the schema's triggers, and a direct Business has none — so "no Operator"
// resolves to the platform brand by construction.
//
// resolveBrand is pure, so the fallback chain is provable without a database
// (lib/brand.selftest.mjs). Everything else here is a thin, cached read.

import { readOperatorBrandRow } from '../registry/org.mjs';
import { getTenant } from '../registry/tenants.mjs';

/** The platform's own brand, and the fallback for everything unset. */
export const PLATFORM_BRAND = Object.freeze({
  operatorId: null,
  name: 'MMSBUILD',
  accent: null, // null = the shared design tokens' own green
  logoLight: null, // null = each product's bundled artwork
  logoDark: null,
  icon: null,
  version: 0,
  isPlatform: true,
});

// The platform's product names, and the word that survives when an Operator
// puts its own name in front: "MMS-CMS" -> "BrightLeaf CMS".
const PRODUCTS = Object.freeze({
  cms: { platform: 'MMS-CMS', suffix: 'CMS' },
  design: { platform: 'MMS Design', suffix: 'Design' },
  console: { platform: 'MMS Operator', suffix: 'Operator' },
});

/** A validated #rrggbb, or null. Never trust this string to a stylesheet unchecked. */
export function cleanAccent(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw Object.assign(new Error('Accent must be a colour like #15964e'), { status: 400 });
  return v.toLowerCase();
}

/** A brand name an Operator may show. Empty means "use the platform's". */
export function cleanBrandName(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v.length > 40) throw Object.assign(new Error('Brand name is too long'), { status: 400 });
  // It is rendered as text in a page title and a header; refuse the characters
  // that would end an attribute or open a tag rather than escaping at each of
  // the dozen places it is printed.
  if (/[<>"'`\\]/.test(v)) throw Object.assign(new Error('Brand name cannot contain < > " \' ` or \\'), { status: 400 });
  return v;
}

/**
 * The brand an operator row means — pure, and the only place the fallback
 * chain is decided. `null` (no Operator) is the platform's own brand.
 */
export function resolveBrand(operator) {
  if (!operator || !operator.id) return PLATFORM_BRAND;
  const version = Number(operator.brand_version || 0);
  const art = (kind, present) => (present ? `/brand/${operator.id}/${kind}?v=${version}` : null);
  const name = operator.brand_name ? String(operator.brand_name) : null;
  return Object.freeze({
    operatorId: String(operator.id),
    name: name || PLATFORM_BRAND.name,
    accent: operator.brand_accent || null,
    logoLight: art('logo', operator.has_logo),
    // One artwork is enough: an Operator that uploads only a light logo gets it
    // on both themes rather than a broken image on one of them.
    logoDark: art('logo-dark', operator.has_logo_dark) || art('logo', operator.has_logo),
    icon: art('icon', operator.has_icon),
    version,
    // "Branded" means this Operator actually set something. An Operator that
    // has set nothing is the platform brand under another id, and every
    // surface should treat it as such.
    isPlatform: !name && !operator.brand_accent && !operator.has_logo && !operator.has_icon,
  });
}

/** The name of one product under a brand: "BrightLeaf CMS", or "MMS-CMS". */
export function productName(brand, product) {
  const p = PRODUCTS[product];
  if (!p) throw new Error(`unknown product: ${product}`);
  if (!brand || brand.isPlatform || brand.name === PLATFORM_BRAND.name) return p.platform;
  return `${brand.name} ${p.suffix}`;
}

/** The brand as it travels to the products, or null when it is the platform's. */
export function brandForWire(brand) {
  if (!brand || brand.isPlatform) return null;
  return {
    name: brand.name,
    accent: brand.accent,
    logoLight: brand.logoLight,
    logoDark: brand.logoDark,
    cms: productName(brand, 'cms'),
    design: productName(brand, 'design'),
  };
}

// ---- Cached reads -------------------------------------------------------------
//
// A brand is read on nearly every page the customer sees, and changes about
// once a year. A short cache keeps that off the database without making a
// change wait: saving invalidates it outright.

const TTL_MS = 60_000;
const byOperator = new Map(); // operatorId -> { at, brand }
const slugOperator = new Map(); // project slug -> { at, operatorId }

export function forgetBrand(operatorId = null) {
  if (operatorId === null) {
    byOperator.clear();
    slugOperator.clear();
    return;
  }
  byOperator.delete(String(operatorId));
}

export async function brandForOperator(operatorId) {
  if (operatorId === null || operatorId === undefined) return PLATFORM_BRAND;
  const key = String(operatorId);
  const hit = byOperator.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brand;
  const brand = resolveBrand(await readOperatorBrandRow(key));
  byOperator.set(key, { at: Date.now(), brand });
  return brand;
}

/** The brand a project wears — its Business's Operator, or the platform's. */
export async function brandForTenant(slug) {
  if (!slug) return PLATFORM_BRAND;
  const key = String(slug);
  const hit = slugOperator.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return brandForOperator(hit.operatorId);
  const tenant = await getTenant(key).catch(() => null);
  const operatorId = tenant ? tenant.operator_id ?? null : null;
  slugOperator.set(key, { at: Date.now(), operatorId });
  return brandForOperator(operatorId);
}

/** The brand an administrator's own console wears. */
export async function brandForScope(scope) {
  if (!scope || scope.level === 'platform') return PLATFORM_BRAND;
  if (scope.level === 'operator') return brandForOperator(scope.operatorId);
  const { rows } = await import('../registry/db.mjs').then((m) =>
    m.query('select operator_id from siteagent_control.businesses where id = $1', [scope.businessId]),
  );
  return brandForOperator(rows[0]?.operator_id ?? null);
}
