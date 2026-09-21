// Did it actually go live? (MMSBUILD R9, AC-B9.2)
//
// A deploy used to be recorded as "live" because wrangler exited zero, or
// because its output happened to contain the words "Deployment complete".
// Nothing ever fetched the result. The incident that motivated this
// requirement — a site that went live essentially unstyled — was caught by a
// person looking at it, which is exactly the dependency this removes.
//
// The acceptance criterion is specific that a status code is not enough:
// "a deliberately missing route serving a fallback is caught as a FAIL. An
// HTTP-200 check is not sufficient." A single-page-app host answers 200 with
// its fallback page for every address that does not exist, so a 200 sweep of a
// site with half its pages missing looks perfect. What is checked here is that
// each route serves ITS OWN content.
//
// The polling shape is adopted from the design studio's deploy path, which
// already does this part well: try, wait, try again, give up with a reason
// rather than a verdict.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Sampled rather than exhaustive: a 400-page site should not cost 400 fetches. */
const MAX_ROUTES = 12;

/**
 * A short, distinctive string from a baked page — enough to tell that page
 * apart from the host's fallback, and from every other page on the site.
 *
 * The <title> is the natural choice: every baked page has one, a fallback page
 * has a different one, and it survives the minification and asset rewriting a
 * host may do on the way out.
 */
export function fingerprintOfBakedPage(html) {
  const title = /<title[^>]*>([\s\S]{1,200}?)<\/title>/i.exec(html)?.[1];
  const cleaned = title?.replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.length >= 3 ? cleaned : null;
}

/** Map a route back to the file that was baked for it. */
function bakedFileFor(dir, route) {
  const rel = route.endsWith('/') ? `${route}index.html` : `${route}.html`;
  return resolve(dir, `.${rel}`);
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': 'mmsbuild-deploy-verifier' },
    });
    return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetch the published site and confirm it is serving what was baked.
 *
 * Returns one of three verdicts, and the difference between the last two is the
 * whole point of R8 meeting R9:
 *   verified   — routes were fetched and each served its own content
 *   failed     — a route was missing, or served something else
 *   unverified — the check could not run at all (no address, nothing baked)
 *
 * "Could not check" is never reported as success.
 */
export async function verifyDeployedSite(url, dir, routes, { now = Date.now, sleep } = {}) {
  if (!url) return { verification: 'unverified', detail: 'no public address to check', checked: 0, failed: 0 };
  if (!Array.isArray(routes) || routes.length === 0) {
    return { verification: 'unverified', detail: 'nothing was baked to check against', checked: 0, failed: 0 };
  }

  // Home first — it is the one every host serves — then a spread of the rest,
  // so a large site is sampled across its depth rather than down one branch.
  const ordered = [...routes].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : 0));
  const step = Math.max(1, Math.ceil(ordered.length / MAX_ROUTES));
  const sample = ordered.filter((_, i) => i % step === 0).slice(0, MAX_ROUTES);

  const expected = new Map();
  for (const route of sample) {
    try {
      const html = readFileSync(bakedFileFor(dir, route), 'utf8');
      const fingerprint = fingerprintOfBakedPage(html);
      if (fingerprint) expected.set(route, fingerprint);
    } catch {
      // A route we cannot read locally cannot be compared; it is simply not
      // part of the sample rather than a failure of the site.
    }
  }
  if (expected.size === 0) {
    return { verification: 'unverified', detail: 'no baked page carried a comparable title', checked: 0, failed: 0 };
  }

  const base = url.replace(/\/$/, '');
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = now();
  let lastDetail = 'the site did not answer';

  // A fresh deploy takes a moment to be served everywhere. Poll, because
  // failing a good deploy for being early is its own kind of wrong answer.
  while (now() - startedAt <= POLL_TIMEOUT_MS) {
    const home = await fetchText(`${base}${[...expected.keys()][0] === '/' ? '/' : [...expected.keys()][0]}`);
    if (home.ok) break;
    lastDetail = home.error ? `the site did not answer (${home.error})` : `the site answered ${home.status}`;
    await wait(POLL_INTERVAL_MS);
  }

  const mismatched = [];
  let checked = 0;
  for (const [route, fingerprint] of expected) {
    const res = await fetchText(`${base}${route}`);
    checked++;
    if (!res.ok) {
      mismatched.push(`${route}: answered ${res.status || 'nothing'}`);
      continue;
    }
    // The test that a status code cannot pass: this route must serve ITS page,
    // not the host's fallback and not another page's.
    if (!res.text.includes(fingerprint)) {
      mismatched.push(`${route}: served something other than its own page`);
    }
  }

  if (checked === 0) return { verification: 'unverified', detail: lastDetail, checked: 0, failed: 0 };
  if (mismatched.length > 0) {
    return {
      verification: 'failed',
      detail: `${mismatched.length} of ${checked} routes wrong — ${mismatched.slice(0, 4).join('; ')}`,
      checked,
      failed: mismatched.length,
    };
  }
  return { verification: 'verified', detail: `${checked} routes served their own content`, checked, failed: 0 };
}
