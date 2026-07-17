// Image materialization — guarantee every image a page references is a REAL
// local file under the project's `public/images/`, so it renders in the OD
// canvas AND imports into the CMS as an uploaded media asset.
//
// Why this exists: the CMS contract forbids external/hotlinked images and tells
// the agent to use web-root `/images/x.jpg` paths, but OD has no keyless way to
// synthesize those files (the AI image provider needs a key and is often
// unconfigured). So a build emits `<img src="/images/x.jpg">` pointing at files
// that were never written → broken images + an empty media panel. This pass
// fills them in deterministically, provider-free:
//   • an AI-referenced external `http(s)` image  → download (SSRF-guarded) and
//     save it in, rewriting the ref to web-root (captured, not borrowed);
//   • a local `/images/x` with no file           → fetch a real royalty-free
//     photo from keyless Lorem Picsum (deterministic seed, never churns);
//   • offline / fetch failed                      → write a self-contained SVG
//     placeholder so a link is NEVER broken.
//
// Everything is saved under `public/images/` and referenced web-root `/images/…`
// (the load-bearing invariant: `od-share-to-cms.ts` strips `public/` from both
// the file key and the `src`, so the importer resolves it and uploads a
// `/uploads/…` media asset). Only CMS-accepted formats are produced —
// jpg/png/webp/gif/svg — never avif/ico (the importer rejects those).

import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { assertAndFetchExternalAsset } from './connectionTest.js';
import { isIgnoredProjectDirName } from './project-ignored-dirs.js';

const MAX_IMG_BYTES = 10 * 1024 * 1024; // well under the importer's 50 MB cap
const FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_W = 1200;
const DEFAULT_H = 800;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
/** Formats the Instatic importer accepts (avif/ico are rejected → excluded). */
const CMS_OK_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

export interface MaterializeResult {
  /** HTML with any external / format-changed image refs rewritten to web-root local paths. */
  html: string;
  /** Web-root keys created (e.g. `images/hero.jpg`), for logging. */
  created: string[];
}

interface ImgRef {
  src: string;
  width?: number;
  height?: number;
  alt?: string;
}

const attrOf = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];

/** Parse `<img>` tags for their src + optional width/height/alt. */
function parseImgRefs(html: string): ImgRef[] {
  const out: ImgRef[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrOf(tag, 'src');
    if (!src) continue;
    const w = Number(attrOf(tag, 'width'));
    const h = Number(attrOf(tag, 'height'));
    const alt = attrOf(tag, 'alt');
    const ref: ImgRef = { src };
    if (Number.isFinite(w) && w > 0) ref.width = Math.round(w);
    if (Number.isFinite(h) && h > 0) ref.height = Math.round(h);
    if (alt !== undefined) ref.alt = alt;
    out.push(ref);
  }
  return out;
}

const extOf = (p: string): string =>
  (p.replace(/[?#].*$/, '').match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

const replaceExt = (key: string, ext: string): string => key.replace(/\.[a-z0-9]+$/i, `.${ext}`);

/** Map a page `src` to its web-root key (`/images/x` or `images/x` → `images/x`); null for external/data. */
function localKeyForSrc(src: string): string | null {
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(src)) return null;
  const clean = src.replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!clean || clean.startsWith('public/')) return clean.replace(/^public\//, '') || null;
  return clean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** Find an already-captured external image (`images/od-<seed>.<ext>`) so previews don't re-download. */
async function findExistingCapture(projectRoot: string, seed: string): Promise<string | null> {
  for (const ext of ['jpg', 'png', 'webp', 'gif', 'svg']) {
    const key = `images/od-${seed}.${ext}`;
    if (await fileExists(nodePath.join(projectRoot, 'public', key))) return key;
  }
  return null;
}

async function writeFileEnsured(abs: string, bytes: Buffer): Promise<void> {
  await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, bytes);
}

/** Stable positive 32-bit-ish hash for deterministic seeds/colors (no Math.random). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic Lorem Picsum photo URL (keyless, real royalty-free). `fmt` matches the ref's extension. */
function picsumUrl(seed: string, w: number, h: number, fmt: 'jpg' | 'webp'): string {
  const s = encodeURIComponent(seed || 'photo');
  return `https://picsum.photos/seed/${s}/${w}/${h}.${fmt}`;
}

async function fetchBytes(url: string, trusted: boolean): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Trusted (hardcoded picsum) may redirect to its CDN → follow. Untrusted
    // (AI-supplied) goes through the SSRF guard, which forbids redirects.
    const resp = trusted
      ? await fetch(url, { redirect: 'follow', signal: ctrl.signal })
      : await assertAndFetchExternalAsset(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMG_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Self-contained SVG placeholder: deterministic gradient + the alt label. Always valid, always CMS-accepted. */
function svgPlaceholder(label: string, w: number, h: number, seed: string): Buffer {
  const hue = hashStr(seed) % 360;
  const hue2 = (hue + 40) % 360;
  const safe = (label || 'image').replace(/[<>&"']/g, '').slice(0, 40);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${safe}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},52%,72%)"/><stop offset="1" stop-color="hsl(${hue2},48%,58%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" fill="rgba(255,255,255,0.92)" font-family="system-ui,sans-serif" font-size="${Math.max(
      14,
      Math.round(Math.min(w, h) / 12),
    )}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${safe}</text>` +
    `</svg>`;
  return Buffer.from(svg, 'utf8');
}

/** Escape a string for use inside a RegExp. */
const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace every occurrence of an exact `src="old"`/`src='old'` value with the new src. */
function rewriteSrc(html: string, oldSrc: string, newSrc: string): string {
  return html.replace(
    new RegExp(`(\\bsrc\\s*=\\s*["'])${reEsc(oldSrc)}(["'])`, 'gi'),
    (_m, pre, post) => `${pre}${newSrc}${post}`,
  );
}

/**
 * Ensure every image `<img>` on a page has a real, CMS-accepted local file under
 * `<projectRoot>/public/images/…`. Creates missing files (real photo → placeholder)
 * and rewrites external / format-changed refs to their web-root local path.
 * Idempotent: an already-materialized page is a cheap stat-only no-op.
 */
export async function materializeImages(
  projectRoot: string,
  html: string,
): Promise<MaterializeResult> {
  // De-dupe repeated srcs, then materialize every image concurrently (first
  // load of a 12-image page = ~1 fetch of wall-time, not 12).
  const bySrc = new Map<string, ImgRef>();
  for (const ref of parseImgRefs(html)) if (!bySrc.has(ref.src)) bySrc.set(ref.src, ref);

  const results = await Promise.all([...bySrc.values()].map((ref) => materializeOne(projectRoot, ref)));

  let out = html;
  const created: string[] = [];
  for (const r of results) {
    if (!r) continue;
    if (r.created) created.push(r.created);
    if (r.rewrite) out = rewriteSrc(out, r.rewrite.from, r.rewrite.to);
  }
  return { html: out, created };
}

interface OneResult {
  created?: string;
  rewrite?: { from: string; to: string };
}

/** Materialize a single image ref. Returns what was created + any ref rewrite (never throws). */
async function materializeOne(projectRoot: string, ref: ImgRef): Promise<OneResult | null> {
  try {
    const w = ref.width ?? DEFAULT_W;
    const h = ref.height ?? DEFAULT_H;

    // --- Case 1: external http(s) image → capture it into the site ---
    if (/^https?:/i.test(ref.src)) {
      const seed = String(hashStr(ref.src));
      // Idempotent across previews: if we already captured this URL, just
      // re-point the ref — don't re-download every serve.
      const existing = await findExistingCapture(projectRoot, seed);
      if (existing) return { rewrite: { from: ref.src, to: `/${existing}` } };
      const resp = await fetchBytes(ref.src, false);
      if (resp) {
        const urlExt = extOf(ref.src);
        const ext = CMS_OK_EXT.has(urlExt) && urlExt !== 'svg' ? (urlExt === 'jpeg' ? 'jpg' : urlExt) : 'jpg';
        const key = `images/od-${seed}.${ext}`;
        await writeFileEnsured(nodePath.join(projectRoot, 'public', key), resp);
        return { created: key, rewrite: { from: ref.src, to: `/${key}` } };
      }
      // Couldn't capture → deterministic real photo, else placeholder.
      const fetched = await fetchBytes(picsumUrl(seed, w, h, 'jpg'), true);
      const bytes = fetched ?? svgPlaceholder(ref.alt ?? '', w, h, seed);
      const key = `images/od-${seed}.${fetched ? 'jpg' : 'svg'}`;
      await writeFileEnsured(nodePath.join(projectRoot, 'public', key), bytes);
      return { created: key, rewrite: { from: ref.src, to: `/${key}` } };
    }

    // --- Case 2: local ref ---
    const key = localKeyForSrc(ref.src);
    if (!key) return null; // data: / blob: / unresolvable
    const publicAbs = nodePath.join(projectRoot, 'public', key);
    if (await fileExists(publicAbs)) return null; // already materialized

    // Legacy: bytes at the project ROOT (`images/x`) but the canvas serves from
    // `public/` — copy them in so `/images/x` resolves.
    const rootAbs = nodePath.join(projectRoot, key);
    if (await fileExists(rootAbs)) {
      const bytes = await fsp.readFile(rootAbs);
      await writeFileEnsured(publicAbs, bytes);
      return { created: key };
    }

    // Missing entirely → real photo (format matching the ref) or placeholder.
    const seed = nodePath.basename(key).replace(/\.[a-z0-9]+$/i, '') || String(hashStr(ref.src));
    const ext = extOf(key);
    let bytes: Buffer | null;
    let finalKey = key;
    if (ext === 'jpg' || ext === 'jpeg') {
      bytes = await fetchBytes(picsumUrl(seed, w, h, 'jpg'), true);
    } else if (ext === 'webp') {
      bytes = await fetchBytes(picsumUrl(seed, w, h, 'webp'), true);
    } else {
      bytes = await fetchBytes(picsumUrl(seed, w, h, 'jpg'), true);
      finalKey = /\.[a-z0-9]+$/i.test(key) ? replaceExt(key, 'jpg') : `${key}.jpg`;
    }
    if (!bytes) {
      bytes = svgPlaceholder(ref.alt ?? seed, w, h, seed);
      finalKey = /\.[a-z0-9]+$/i.test(key) ? replaceExt(key, 'svg') : `${key}.svg`;
    }
    await writeFileEnsured(nodePath.join(projectRoot, 'public', finalKey), bytes);
    return finalKey === key ? { created: finalKey } : { created: finalKey, rewrite: { from: ref.src, to: `/${finalKey}` } };
  } catch {
    return null; // never let one image break the page
  }
}

const HTML_RE = /\.html?$/i;

/**
 * Materialize images across a whole project's HTML pages (the share-time hook):
 * for each page, create missing image files under `public/images/` and persist
 * any external/format ref rewrites back to the source file (permanent "saved
 * in" capture), so `collectSiteFiles` hands the CMS real image bytes + local
 * refs. Best-effort per file; never throws.
 */
export async function materializeProjectImages(projectRoot: string): Promise<{ created: string[] }> {
  const created: string[] = [];
  const htmlFiles: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredProjectDirName(entry.name)) await walk(abs);
      } else if (HTML_RE.test(entry.name)) {
        htmlFiles.push(abs);
      }
    }
  }
  await walk(projectRoot);

  for (const abs of htmlFiles) {
    try {
      const html = await fsp.readFile(abs, 'utf8');
      const res = await materializeImages(projectRoot, html);
      created.push(...res.created);
      if (res.html !== html) await fsp.writeFile(abs, res.html, 'utf8');
    } catch {
      /* skip this page — never fail the whole share */
    }
  }
  return { created };
}
