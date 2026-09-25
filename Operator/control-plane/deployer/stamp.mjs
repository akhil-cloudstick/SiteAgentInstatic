/**
 * Build stamps — what tells a served page apart from its own predecessor.
 *
 * The live check (verify.mjs) recognised a page by its `<title>`. A title is
 * stable across builds by design, so the one failure it could not see was the
 * important one: an upload that silently does not land, leaving the PREVIOUS
 * version of the site live. Every title still matches, every route answers 200,
 * and the deploy is recorded as verified. The validator found this by reasoning
 * about it, not by hitting it, which is the good way to find it.
 *
 * So every page now carries a revision of its own, written in immediately
 * before upload:
 *
 *     <meta name="mms-build" content="9f1c2ab34d57">
 *
 * The value is a SHA-256 over the page's own bytes with any previous stamp
 * removed. Two consequences, both deliberate:
 *
 *   - Stamping is IDEMPOTENT. Re-stamping a stamped page yields the same value,
 *     so a rollback (which re-uploads a bundle that was stamped when it first
 *     went out) stamps it identically and still verifies.
 *   - The check is PER PAGE, not per deploy. A partial upload where some routes
 *     landed and others did not is caught route by route. A single build-wide
 *     id could not do that.
 *
 * Why not `BUILD_REVISION`, which already exists on every receipt: that is the
 * git revision of the CONTROL PLANE. It does not change when the site's content
 * changes, which is precisely the case this exists to catch. It stays on the
 * receipt, where it answers a different question.
 *
 * The limit, stated rather than hidden: two deploys of byte-identical content
 * produce the same stamp, so a failed upload of content that did not change
 * still passes. That is the correct answer — the bytes being served are the
 * bytes that were meant to be served. What this detects is a stale SITE, never
 * merely a stale upload of the same site.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The meta name. One place, because verify.mjs reads what this writes. */
export const BUILD_STAMP_NAME = 'mms-build';

/** Matches a stamp and captures its value. */
const STAMP_VALUE = /<meta\s+name="mms-build"\s+content="([0-9a-f]{6,64})"\s*\/?>/i;

/** Matches a stamp plus the whitespace it was laid out with, for clean removal. */
const STAMP_TAG = /[ \t]*<meta\s+name="mms-build"\s+content="[0-9a-f]{6,64}"\s*\/?>\r?\n?/gi;

/** Where the stamp goes: after the charset meta when there is one, else after <head>. */
const CHARSET_META = /<meta\s+charset=["'][^"']*["']\s*\/?>/i;
const HEAD_OPEN = /<head[^>]*>/i;

/** The stamp a page is carrying, or null if it is not carrying one. */
export function buildStampOf(html) {
  return STAMP_VALUE.exec(html)?.[1] ?? null;
}

/** The page with any stamp removed — the bytes the revision is computed over. */
export function stripStamp(html) {
  return html.replace(STAMP_TAG, '');
}

/** The revision for a page, independent of whether it is already stamped. */
export function revisionOf(html) {
  return createHash('sha256').update(stripStamp(html), 'utf8').digest('hex').slice(0, 12);
}

/**
 * The page, stamped. Returns null when there is no `<head>` to stamp into —
 * a caller must treat that as "not stamped" and not as a stamped page, because
 * a page that cannot carry a revision cannot be checked by one.
 */
export function stampHtml(html) {
  const bare = stripStamp(html);
  const charset = CHARSET_META.exec(bare);
  const head = charset ?? HEAD_OPEN.exec(bare);
  if (!head) return null;

  const at = head.index + head[0].length;
  // Follow the file's own line endings. These files are written on Windows and
  // read back by a check that compares them byte for byte.
  const eol = bare.slice(0, at).includes('\r\n') ? '\r\n' : '\n';
  const tag = `${eol}  <meta name="${BUILD_STAMP_NAME}" content="${revisionOf(bare)}">`;
  return bare.slice(0, at) + tag + bare.slice(at);
}

/** Every .html file under a directory, as absolute paths. */
function htmlFilesIn(dir) {
  const found = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = resolve(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) found.push(child);
    }
  };
  walk(dir);
  return found;
}

/**
 * Stamp every baked page in an upload directory, in place, just before it ships.
 *
 * Returns what happened rather than throwing on a single bad file: one page that
 * cannot be read or stamped must not stop a deploy. It does make that page
 * uncheckable, and the verifier says so rather than passing it quietly — the
 * two halves of this are meant to be read together.
 */
export function stampBakedPages(dir) {
  let stamped = 0;
  const unstamped = [];
  for (const file of htmlFilesIn(dir)) {
    try {
      const html = readFileSync(file, 'utf8');
      const out = stampHtml(html);
      if (out === null) {
        unstamped.push(file);
        continue;
      }
      writeFileSync(file, out, 'utf8');
      stamped++;
    } catch {
      unstamped.push(file);
    }
  }
  return { stamped, unstamped };
}
