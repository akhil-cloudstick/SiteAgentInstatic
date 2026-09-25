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
import { buildStampOf } from './stamp.mjs';

const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Check EVERY route on a site up to this size.
 *
 * It used to sample at most twelve routes whatever the site, which meant a
 * partial upload that missed a route outside the sample passed. The validator
 * asked the obvious question about it: an eighteen-route site is cheap to check
 * completely, so why sample it at all. It is not, and now it isn't.
 */
const EXHAUSTIVE_UPTO = 60;

/**
 * Above that, sample — a 400-page site should not cost 400 fetches. Spread
 * across the site's depth rather than down one branch, and the verdict says it
 * sampled, so "verified" never quietly means "verified a fraction of it".
 */
const MAX_SAMPLED_ROUTES = 24;

/**
 * A short, distinctive string from a baked page — enough to tell that page
 * apart from the host's fallback, and from every other page on the site.
 *
 * The <title> was the original choice: every baked page has one, a fallback page
 * has a different one, and it survives the minification and asset rewriting a
 * host may do on the way out.
 *
 * It is now the FALLBACK, not the first choice, because of what it cannot see.
 * A title is stable across builds by design, so an upload that silently does
 * not land — leaving the previous version of the site live — matches every
 * title and passes. `comparableOfBakedPage` below prefers the build stamp,
 * which changes when the page changes.
 */
export function fingerprintOfBakedPage(html) {
  const title = /<title[^>]*>([\s\S]{1,200}?)<\/title>/i.exec(html)?.[1];
  const cleaned = title?.replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.length >= 3 ? cleaned : null;
}

/**
 * What a route is recognised by, and how strong that recognition is.
 *
 * The build stamp is preferred: it is derived from the page's own bytes, so it
 * changes when the page changes and catches a stale site that every title check
 * would wave through. The title remains for a page with no <head> to stamp into.
 *
 * The two are NOT reported as the same thing — the verdict says how many routes
 * were compared by stamp, because a run that fell back to titles is a weaker
 * check and reading it as equally strong is how a gap gets re-introduced.
 */
export function comparableOfBakedPage(html) {
  const stamp = buildStampOf(html);
  if (stamp) return { kind: 'stamp', value: stamp };
  const title = fingerprintOfBakedPage(html);
  return title ? { kind: 'title', value: title } : null;
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

  // Home first — it is the one every host serves — then the rest.
  const ordered = [...routes].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : 0));
  const sampled = ordered.length > EXHAUSTIVE_UPTO;
  const step = sampled ? Math.max(1, Math.ceil(ordered.length / MAX_SAMPLED_ROUTES)) : 1;
  const sample = sampled
    ? ordered.filter((_, i) => i % step === 0).slice(0, MAX_SAMPLED_ROUTES)
    : ordered;

  // How many baked pages carry each title, across the WHOLE build rather than
  // the sample. A title shared by two pages cannot tell them apart, so a
  // fallback serving the wrong one would pass — the validator's second finding.
  // Computed lazily, because after stamping almost nothing falls back to titles
  // and reading every baked file off a network share is not free.
  let titleCounts = null;
  const titleIsUnique = (title) => {
    if (titleCounts === null) {
      titleCounts = new Map();
      for (const route of ordered) {
        try {
          const t = fingerprintOfBakedPage(readFileSync(bakedFileFor(dir, route), 'utf8'));
          if (t) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
        } catch {
          // Unreadable here means it simply does not contribute a title.
        }
      }
    }
    return (titleCounts.get(title) ?? 0) <= 1;
  };

  const expected = new Map();
  // Routes that exist but cannot be told apart from another page. Counted and
  // named rather than skipped in silence: "could not check" must never read the
  // same as "checked and fine".
  const indistinguishable = [];
  for (const route of sample) {
    try {
      const html = readFileSync(bakedFileFor(dir, route), 'utf8');
      const comparable = comparableOfBakedPage(html);
      if (!comparable) continue;
      if (comparable.kind === 'title' && !titleIsUnique(comparable.value)) {
        indistinguishable.push(route);
        continue;
      }
      expected.set(route, comparable);
    } catch {
      // A route we cannot read locally cannot be compared; it is simply not
      // part of the sample rather than a failure of the site.
    }
  }

  // Every route shares its title with another. Nothing here can be verified, and
  // per P2 that is reported as "could not check", never as success.
  if (expected.size === 0 && indistinguishable.length > 0) {
    return {
      verification: 'unverified',
      detail:
        `${indistinguishable.length} routes share their titles with other pages and carry no build ` +
        'stamp, so none of them can be told apart from a fallback. Publish again to stamp them.',
      checked: 0,
      failed: 0,
    };
  }
  if (expected.size === 0) {
    return { verification: 'unverified', detail: 'no baked page carried a build stamp or a comparable title', checked: 0, failed: 0 };
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
  let byStamp = 0;
  for (const [route, expect] of expected) {
    const res = await fetchText(`${base}${route}`);
    checked++;
    if (!res.ok) {
      mismatched.push(`${route}: answered ${res.status || 'nothing'}`);
      continue;
    }

    if (expect.kind === 'stamp') {
      byStamp++;
      const live = buildStampOf(res.text);
      if (live === expect.value) continue;
      // The failure the stamp exists for: the route answers, and answers with a
      // real page of the right shape — just not the one that was uploaded. Both
      // messages name which, because "it did not land" and "it is an older
      // build" send whoever reads the receipt to different places.
      mismatched.push(
        live === null
          ? `${route}: served a page carrying no build stamp — an older build, or a host that strips meta tags`
          : `${route}: served build ${live}, not the ${expect.value} that was uploaded`,
      );
      continue;
    }

    // The test that a status code cannot pass: this route must serve ITS page,
    // not the host's fallback and not another page's.
    if (!res.text.includes(expect.value)) {
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
  // How much, and how, both travel with the verdict. All-by-stamp over every
  // route is the strong result; anything less says so on the receipt rather than
  // looking identical to it.
  const how =
    byStamp === checked
      ? 'by build stamp'
      : `${byStamp} of ${checked} by build stamp, the rest by title only`;
  const scope = sampled
    ? `sampled ${checked} of ${ordered.length} routes`
    : checked === ordered.length
      ? `all ${checked} routes`
      : `${checked} of ${ordered.length} routes`;
  const caveat =
    indistinguishable.length > 0
      ? `; ${indistinguishable.length} could not be told apart (shared titles, no build stamp)`
      : '';
  return {
    verification: 'verified',
    detail: `${scope} served their own content (${how})${caveat}`,
    checked,
    failed: 0,
  };
}
