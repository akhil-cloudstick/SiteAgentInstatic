// The receipt, and the bundle it points back to (MMSBUILD R9).
//
// "Every publish produces an immutable receipt naming the approved content's
// identity, the deploy identity, the live-verification result, the timestamp,
// the previous known-good reference — and the build that performed it."
//
// Two notes on why this is its own module rather than more of deploy.mjs.
//
// The receipt is written ONCE, after the deploy and its verification have both
// finished, into a table whose triggers refuse any later edit or delete. The
// `deploys` row beside it stays mutable, because it tracks a deploy in flight
// and has to — the two records answer different questions and must not be the
// same row.
//
// Retention exists because the CMS keeps exactly two generations on disk and
// destroys the older one as the FIRST step of the next publish. So there is no
// spare generation to point at: what went live has to be copied out
// deliberately, and copied AFTER the deployer writes robots.txt and friends
// into the slot, or the kept bundle is not the bundle that was uploaded.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../registry/db.mjs';
import config from '../lib/env.mjs';

/** The repository this control plane runs from, for the build stamp. */
const REPO_ROOT = resolve(config.instaticDir ?? process.cwd(), '..');
import * as rt from '../runtime/tenantRuntime.mjs';

/** How many past generations to keep. Enough to go back, not enough to fill a disk. */
const KEEP_GENERATIONS = 3;

/**
 * Which build performed the publish, so a bad release can be identified rather
 * than guessed at. The git revision when it is available, otherwise the version.
 */
export const BUILD_REVISION = (() => {
  const fromEnv = process.env.MMS_BUILD_REVISION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const gitDir = resolve(REPO_ROOT, '.git');
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 12);
    return readFileSync(resolve(gitDir, head.slice(5)), 'utf8').trim().slice(0, 12);
  } catch {
    // No git, a packed ref, or a read that failed: the build is simply not
    // known, which the receipt records as such rather than guessing.
    return 'unknown';
  }
})();

/**
 * The provider's own id for this deployment, pulled from what the tool printed.
 *
 * Recorded so the platform's record and Cloudflare's can be reconciled later —
 * "the two records are reconciled, not merged". Absent is fine and common; it
 * is never invented.
 */
export function deploymentIdFrom(output) {
  const text = String(output || '');
  // Wrangler prints the deployment URL, whose first label is the deploy id.
  const url = /https:\/\/([0-9a-f]{8})\.[a-z0-9-]+\.pages\.dev/i.exec(text);
  if (url) return url[1];
  const named = /deployment[ _-]?id[":\s]+([0-9a-f-]{8,40})/i.exec(text);
  return named ? named[1] : null;
}

/** Where a project's retained generations live. */
const keepDir = (slug) => resolve(rt.tenantPaths(slug).uploads, 'published', 'known-good');

/**
 * Copy the bundle that was just uploaded, and prune the oldest.
 *
 * Returns the path kept, or null when nothing could be kept — which is
 * recorded on the receipt as an absence rather than passed off as success.
 */
export async function retainKnownGood(slug, dir) {
  if (!dir || !existsSync(dir)) return null;
  const root = keepDir(slug);
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const target = resolve(root, at);
  await mkdir(root, { recursive: true });
  await cp(dir, target, { recursive: true });

  // Oldest first, keep the newest few. Named by timestamp, so lexical order is
  // chronological order.
  try {
    const kept = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - KEEP_GENERATIONS))) {
      await rm(resolve(root, old), { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[deploy] ${slug} could not prune kept bundles: ${err.message}`);
  }
  return target;
}

/** The generations kept for a project, newest first, with their sizes. */
export async function listKnownGood(slug) {
  const root = keepDir(slug);
  if (!existsSync(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory());
  const out = [];
  for (const e of entries) {
    const path = resolve(root, e.name);
    const info = await stat(path).catch(() => null);
    out.push({ at: e.name, path, keptAt: info ? info.mtime.toISOString() : null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Write the receipt. Append-only by the table's own triggers, so this is the
 * single moment the record is created and it is never revised.
 */
export async function recordReceipt(entry) {
  try {
    const previous = await query(
      'select id from siteagent_control.deploy_receipts where tenant_slug = $1 order by at desc limit 1',
      [entry.tenantSlug],
    );
    const { rows } = await query(
      `insert into siteagent_control.deploy_receipts
         (tenant_slug, content_hash, published_pages, cf_project, deploy_url, deploy_id,
          verification, verification_detail, routes_checked, routes_failed,
          previous_receipt_id, known_good_path, build)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        entry.tenantSlug,
        entry.contentHash ?? null,
        entry.publishedPages ?? null,
        entry.cfProject ?? null,
        entry.deployUrl ?? null,
        entry.deployId ?? null,
        entry.verification ?? 'unverified',
        entry.verificationDetail ?? null,
        entry.routesChecked ?? null,
        entry.routesFailed ?? null,
        previous.rows[0]?.id ?? null,
        entry.knownGoodPath ?? null,
        entry.build ?? BUILD_REVISION,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    // A receipt that cannot be written is loud. It does not fail the deploy —
    // the site is already live, and pretending otherwise would be its own lie —
    // but the gap is visible rather than swallowed.
    console.error(`[deploy] ${entry.tenantSlug} RECEIPT NOT WRITTEN: ${err.message}`);
    return null;
  }
}

/** Receipts for a project, newest first. */
export async function listReceipts(scope, tenantSlug, limit = 50) {
  const { scopeFilter } = await import('../lib/scope.mjs');
  const f = scopeFilter(scope, 'r', [tenantSlug, Math.min(Number(limit) || 50, 200)]);
  const { rows } = await query(
    `select r.* from siteagent_control.deploy_receipts r
      where r.tenant_slug = $1 and ${f.sql}
      order by r.at desc limit $2`,
    f.params,
  );
  return rows;
}
