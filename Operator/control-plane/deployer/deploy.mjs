// Publish Deployer — ships a tenant's baked static site to Cloudflare Pages via wrangler.
// Instatic bakes fully-static pages to <uploads>/published/current/ at publish time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import * as tenants from '../registry/tenants.mjs';
import { verifyDeployedSite } from './verify.mjs';
import {
  recordReceipt,
  retainKnownGood,
  deploymentIdFrom,
  BUILD_REVISION,
  listKnownGood,
  listReceipts,
} from './receipt.mjs';
import { getSecrets } from '../registry/settings.mjs';
import * as rt from '../runtime/tenantRuntime.mjs';
import config from '../lib/env.mjs';

const isWin = process.platform === 'win32';

function publishedDir(slug) {
  return resolve(rt.tenantPaths(slug).uploads, 'published');
}

// Resolve the directory holding the tenant's latest baked site.
//
// Instatic writes each publish into a slot (a|b) then points `published/current`
// at it via a SYMLINK. On Windows without admin/Developer Mode that symlink()
// silently fails, so we can't rely on `current`. Strategy:
//   1. Follow `current` if it resolves (POSIX / privileged Windows).
//   2. Otherwise pick the newest slot dir (a|b) that contains an index.html —
//      publishes always target the inactive slot, so the freshest index.html
//      marks the most recently published slot.
// Returns null when nothing has been baked yet.
export function bakedDir(slug) {
  const pub = publishedDir(slug);
  const cur = resolve(pub, 'current');
  try {
    const real = realpathSync(cur);
    if (existsSync(resolve(real, 'index.html'))) return real;
  } catch { /* no usable current symlink — fall through to slot scan */ }

  let best = null;
  let bestTime = -1;
  for (const slot of ['a', 'b']) {
    const idx = resolve(pub, slot, 'index.html');
    try {
      if (existsSync(idx)) {
        const t = statSync(idx).mtimeMs;
        if (t > bestTime) { bestTime = t; best = resolve(pub, slot); }
      }
    } catch { /* ignore unreadable slot */ }
  }
  return best;
}

// True once the tenant has published locally (Instatic baked the site to disk).
export function hasBakedOutput(slug) {
  return bakedDir(slug) !== null;
}

function runWrangler(args, env) {
  return new Promise((res) => {
    let out = '';
    const child = spawn('npx', ['--yes', 'wrangler', ...args], {
      cwd: config.root, env, shell: isWin, windowsHide: true,
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => res({ code, out }));
    child.on('error', (e) => res({ code: -1, out: out + '\n' + e.message }));
  });
}

// Minimal, self-contained "Coming soon" page (no external assets) shown on the
// tenant's Pages URL / custom domain until their first real Publish replaces it.
function placeholderHtml(slug) {
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Coming soon</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:#0f172a;color:#e2e8f0;text-align:center;padding:2rem}
  .card{max-width:32rem}
  h1{font-size:2rem;margin:0 0 .5rem}
  p{color:#94a3b8;margin:0}
</style>
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <p>This site is coming soon.</p>
  </div>
</body>
</html>
`;
}

// Attach a custom domain to a Pages project via the Cloudflare API (wrangler has
// no stable CLI for this). Works automatically when the domain's zone lives in the
// same CF account — CF then creates the DNS record too. Best-effort: returns a flag.
async function attachCustomDomain(secrets, project, domain) {
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${secrets.cloudflareAccountId}/pages/projects/${project}/domains`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.cloudflareToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      },
    );
    const j = await r.json().catch(() => ({}));
    // 409/"already added" is success for our purposes (idempotent).
    const already = JSON.stringify(j.errors || '').includes('already');
    return { ok: (r.ok && j.success !== false) || already, detail: j };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// Delete the tenant's Cloudflare Pages project (and thus its live site). Best-effort:
// a missing project or unconfigured CF is treated as "nothing to do".
export async function deleteTenantSite(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) return { ok: false, error: 'unknown tenant' };
  const secrets = await getSecrets();
  if (!secrets.cloudflareToken || !secrets.cloudflareAccountId) {
    return { ok: false, skipped: true, reason: 'Cloudflare not configured' };
  }
  const project = row.cf_project || `siteagent-${slug}`;
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: secrets.cloudflareToken,
    CLOUDFLARE_ACCOUNT_ID: secrets.cloudflareAccountId,
  };
  const { code, out } = await runWrangler(['pages', 'project', 'delete', project, '--yes'], env);
  const ok = code === 0 || /not found|does not exist/i.test(out);
  if (!ok) console.error(`[deploy] CF project delete for ${slug} failed:`, out.slice(-300));
  return { ok, out };
}

// Attach the tenant's stored custom domain to its Pages project — safe to call any
// time (does NOT touch published content). Used by edit/repair flows.
export async function attachTenantDomain(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);
  if (!row.custom_domain) return { ok: false, error: 'no custom domain set' };
  const secrets = await getSecrets();
  if (!secrets.cloudflareToken || !secrets.cloudflareAccountId) {
    return { ok: false, error: 'Cloudflare not configured' };
  }
  const project = row.cf_project || `siteagent-${slug}`;
  const d = await attachCustomDomain(secrets, project, row.custom_domain);
  return { ok: d.ok, error: d.ok ? null : JSON.stringify(d.detail).slice(0, 300) };
}

// Create the tenant's Cloudflare Pages project up-front and push a "Coming soon"
// placeholder so its *.pages.dev URL (and any attached custom domain) is live
// immediately — before the tenant has built or published anything. Idempotent and
// best-effort: if Cloudflare isn't configured yet it no-ops (the project is then
// created lazily on the first real Publish via deployTenant instead).
export async function initTenantSite(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  const secrets = await getSecrets();
  if (!secrets.cloudflareToken || !secrets.cloudflareAccountId) {
    return { ok: false, skipped: true, reason: 'Cloudflare not configured' };
  }

  const project = row.cf_project || `siteagent-${slug}`;
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: secrets.cloudflareToken,
    CLOUDFLARE_ACCOUNT_ID: secrets.cloudflareAccountId,
  };

  // Ensure the Pages project exists (idempotent — ignore "already exists").
  await runWrangler(['pages', 'project', 'create', project, '--production-branch=main'], env);

  // Write + Direct-Upload the placeholder page. A placeholder is never content
  // worth indexing, so it ships with the same root files as a real deploy —
  // otherwise the very first thing a crawler sees on a brand-new tenant URL is
  // an unguarded page.
  const dir = resolve(rt.tenantPaths(slug).dir, 'placeholder');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), placeholderHtml(slug));
  try {
    writeRootFiles(dir, { ...row, search_indexing: false });
  } catch (e) {
    console.error(`[deploy] root files for ${slug} placeholder could not be written:`, e.message);
  }

  const { code, out } = await runWrangler(
    ['pages', 'deploy', dir, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], env);

  if (deploySucceeded(code, out)) {
    const url = canonicalPagesUrl(project);
    await tenants.updateTenant(slug, { pages_url: url, cf_project: project });
    // Attach the operator-supplied custom domain, if any (best-effort).
    let domain = null;
    if (row.custom_domain) {
      const d = await attachCustomDomain(secrets, project, row.custom_domain);
      domain = d.ok ? row.custom_domain : null;
      if (!d.ok) console.error(`[deploy] custom domain attach for ${slug} failed:`, JSON.stringify(d.detail).slice(0, 300));
    }
    return { ok: true, url, domain, placeholder: true };
  }
  return { ok: false, error: out.slice(-600) || `wrangler exited ${code}` };
}

// The stable production URL of a Pages project. We derive it from the project name
// rather than scraping wrangler's output, which prints the per-deploy hash URL
// (e.g. https://<hash>.<project>.pages.dev) that changes every deploy.
function canonicalPagesUrl(project) {
  return `https://${project}.pages.dev`;
}

// Treat a deploy as successful on exit 0 OR when wrangler clearly reported success
// in its output (it occasionally prints "Deployment complete" yet exits non-zero
// from an unrelated post-step). Prevents a real success being logged as an error.
function deploySucceeded(code, out) {
  return code === 0 || /Deployment complete|Success! Uploaded/i.test(out || '');
}

// Every URL path the baked slot serves, derived from the .html files on disk.
//
// The CMS bakes one file per route (`index.html` -> `/`, `about.html` ->
// `/about`, `blog/post.html` -> `/blog/post`), so the directory IS the route
// list — no need to ask the CMS what it published. `404.html` is the static
// error document, not a page, so it is excluded.
export function bakedUrlPaths(dir) {
  const paths = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(resolve(current, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name.endsWith('.html')) {
        const base = entry.name.slice(0, -'.html'.length);
        if (base === '404' && prefix === '') continue;
        // `index.html` is the route for its own directory, which is how a
        // trailing-slash site bakes: `about-us/index.html` serves `/about-us/`.
        // Emitting `/about-us` there would advertise the URL the host redirects
        // AWAY from, putting a redirect in the sitemap of every page.
        paths.push(base === 'index' ? `${prefix}/` : `${prefix}/${base}`);
      }
    }
  };
  walk(dir, '');
  return paths.sort();
}

// A sitemap generated from what was actually baked.
//
// Written only for an indexable site: robots.txt advertises this file, and
// advertising one that 404s is worse than omitting the line. Nothing in the CMS
// emits a sitemap, so without this the `Sitemap:` directive pointed at nothing.
function writeSitemap(dir, siteBase) {
  const urls = bakedUrlPaths(dir)
    .map((p) => `  <url><loc>${escapeXml(`${siteBase}${p}`)}</loc></url>`)
    .join('\n');
  writeFileSync(
    resolve(dir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${GENERATED_MARKER} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8',
  );
  return urls ? urls.split('\n').length : 0;
}

/**
 * Stamped into every root file we generate, so a later deploy can tell its own
 * output apart from a file that came with the site.
 *
 * This is not cosmetic. An imported site can legitimately bring its own
 * `robots.txt`, `sitemap.xml` or `_headers` — `atlas-infra.pages.dev` serves an
 * imported sitemap listing a completely different domain — and an earlier
 * version of this code overwrote and deleted those unconditionally. Publishing
 * must not eat content the tenant imported.
 */
const GENERATED_MARKER = 'generated by SiteAgent';

/**
 * Delimiters for a block we add INTO a file somebody else authored.
 *
 * Deliberately does not contain `GENERATED_MARKER`. The two must stay distinct:
 * a file we appended to is still *their* file, and conflating the two is how the
 * first version of this deleted an imported `_headers` — it appended its marker
 * on one deploy and then recognised the whole file as its own on the next.
 */
const BLOCK_BEGIN = '# >>> SiteAgent managed block >>>';
const BLOCK_END = '# <<< SiteAgent managed block <<<';

/** True when the file is absent, or present and authored by us in full. */
function oursOrAbsent(path) {
  if (!existsSync(path)) return true;
  try {
    return readFileSync(path, 'utf8').includes(GENERATED_MARKER);
  } catch {
    return false; // unreadable — treat as foreign and leave it alone
  }
}

/** Remove a file only when we authored the whole thing. */
function removeIfOurs(path) {
  if (existsSync(path) && oursOrAbsent(path)) rmSync(path, { force: true });
}

/** Drop our delimited block from a file we did not author, keeping the rest. */
function stripManagedBlock(text) {
  const start = text.indexOf(BLOCK_BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(BLOCK_END, start);
  const after = end === -1 ? text.length : end + BLOCK_END.length;
  return `${text.slice(0, start)}${text.slice(after)}`.replace(/\n{3,}/g, '\n\n');
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]
  ));
}

// Write the root files Cloudflare serves but the CMS cannot produce.
//
// Instatic bakes page HTML and nothing else: there is no robots.txt handling
// anywhere in it, which is why /robots.txt on a deployed tenant used to return
// the homepage HTML, and no way for it to set response headers on a static
// Pages deploy (the `publish.headers` plugin filter is declared but never
// invoked, and a header set inside the CMS would not survive Direct Upload
// regardless). Cloudflare Pages does read `_headers` from the uploaded
// directory, so the control plane is the only place these can come from.
//
// Written on EVERY deploy rather than once: the deploy dir is a publish slot
// that Instatic wipes and rebuilds, so anything we leave there is temporary by
// design. Rewriting each time is idempotent and self-healing.
//
// `search_indexing` is false unless somebody deliberately set it, so the
// crawler-blocking pair is what a site gets by default.
export function writeRootFiles(dir, row) {
  const indexable = row.search_indexing === true;
  // `custom_domain` is a bare host ("acme.com") while `pages_url` is already a
  // full URL — normalise, or the Sitemap line ships without a scheme.
  const site = row.custom_domain
    ? `https://${String(row.custom_domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}`
    : (row.pages_url || '');

  // sitemap.xml — only for an indexable site, and only when we know the host to
  // build absolute `<loc>` values from. Written before robots.txt so the
  // `Sitemap:` directive is only advertised once the file it names exists.
  // The rule for every file below: we manage the ones we generated, and never
  // destroy one the site brought with it. The single exception is the noindex
  // pair — see robots.txt and _headers — because a crawler-blocking guarantee
  // that a leftover file can defeat is not a guarantee.
  const sitemapPath = resolve(dir, 'sitemap.xml');
  const robotsPath = resolve(dir, 'robots.txt');
  const headersPath = resolve(dir, '_headers');
  const llmsPath = resolve(dir, 'llms.txt');

  // sitemap.xml — generated only when we are not stepping on an imported one.
  // An imported sitemap describes the source site (often on another domain),
  // which is wrong for this deploy, but replacing content we did not create is
  // not ours to decide.
  const importedSitemap = !oursOrAbsent(sitemapPath);
  const sitemapUrl = indexable && site && !importedSitemap ? `${site}/sitemap.xml` : null;
  if (sitemapUrl) {
    writeSitemap(dir, site);
  } else if (!indexable) {
    // A site that is now noindex must not keep serving the crawl map a previous
    // indexable deploy wrote — but only if that map is ours.
    removeIfOurs(sitemapPath);
  }

  // robots.txt — the primary control, because `_headers` only applies on
  // Cloudflare while robots.txt travels with the directory to any static host.
  //
  // EXCEPTION: when indexing is off we overwrite even an imported robots.txt.
  // A noindex deploy is a preview, its own crawl rules do not matter, and the
  // block has to be unconditional to be worth anything. When indexing is ON we
  // defer to an imported file — that site has stated its own rules.
  if (!indexable) {
    writeFileSync(robotsPath, `# ${GENERATED_MARKER}\nUser-agent: *\nDisallow: /\n`, 'utf8');
  } else if (oursOrAbsent(robotsPath)) {
    writeFileSync(
      robotsPath,
      `# ${GENERATED_MARKER}\nUser-agent: *\nAllow: /\n${sitemapUrl ? `\nSitemap: ${sitemapUrl}\n` : ''}`,
      'utf8',
    );
  }

  // _headers — Cloudflare Pages applies these to every response. X-Robots-Tag
  // is the half a crawler honours even when it never fetches robots.txt, and it
  // covers non-HTML assets that carry no meta tag at all.
  //
  // Same exception as robots.txt, expressed differently: an imported `_headers`
  // carries rules that matter (caching, security), so instead of replacing it
  // we append our block. Cloudflare merges rules that match the same path.
  const noindexBlock = `${BLOCK_BEGIN}\n/*\n  X-Robots-Tag: noindex, nofollow\n${BLOCK_END}\n`;
  if (!indexable) {
    if (oursOrAbsent(headersPath)) {
      writeFileSync(headersPath, `# ${GENERATED_MARKER}\n${noindexBlock}`, 'utf8');
    } else {
      // Their file, our block. Strip any previous copy first so repeated
      // deploys do not stack duplicates.
      const kept = stripManagedBlock(readFileSync(headersPath, 'utf8'));
      writeFileSync(headersPath, `${kept.replace(/\n*$/, '\n')}\n${noindexBlock}`, 'utf8');
    }
  } else if (oursOrAbsent(headersPath)) {
    // Ours entirely, and no longer needed — a stale noindex header would keep
    // the site out of the index it was just opened to.
    removeIfOurs(headersPath);
  } else {
    // Theirs. Remove only what we added; their caching and security rules stay.
    const kept = stripManagedBlock(readFileSync(headersPath, 'utf8'));
    writeFileSync(headersPath, kept, 'utf8');
  }

  // llms.txt — the emerging convention for stating how AI crawlers may use a
  // site. Same posture as the rest: closed unless deliberately opened, and
  // never written over a statement the site already makes for itself.
  if (oursOrAbsent(llmsPath)) {
    const llms = indexable
      ? `# ${row.display_name || row.slug}\n\n${site ? `${site}\n\n` : ''}This site's published content may be used for indexing and retrieval.\n\n<!-- ${GENERATED_MARKER} -->\n`
      : `# ${row.display_name || row.slug}\n\nThis deployment is not public content. Do not index, crawl, or train on it.\n\n<!-- ${GENERATED_MARKER} -->\n`;
    writeFileSync(llmsPath, llms, 'utf8');
  }
}

/**
 * Deploy a project's baked output, then CHECK that the site serves it (R9).
 *
 * `publishedSiteHash` and `publishedPages` come from the CMS publish that
 * triggered this, and are what let the receipt name the content that went
 * live. They are absent when an operator re-deploys by hand, which the receipt
 * records honestly rather than filling in.
 */
export async function deployTenant(
  slug,
  { allowNoindexOnCustomDomain = false, publishedSiteHash = null, publishedPages = null } = {},
) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  const dir = bakedDir(slug);
  if (!dir) {
    throw new Error('No published output yet — open the site and click Publish inside Instatic first.');
  }

  // A tenant on its own domain is a production site. Shipping it with
  // `Disallow: /` and `X-Robots-Tag: noindex` is almost never what anyone meant
  // — it is the staging default surviving one step past the point it should
  // have been turned off, which is how a real site quietly leaves the index.
  // The pages.dev URL is a different case: it is a preview host and staying out
  // of the index there is correct, so it deploys without complaint.
  if (row.custom_domain && row.search_indexing !== true && !allowNoindexOnCustomDomain) {
    const message =
      `Refusing to deploy ${slug} to ${row.custom_domain} with search indexing OFF — ` +
      'the site would publish with robots.txt "Disallow: /" and X-Robots-Tag noindex. ' +
      'Turn on "Allow search engines" for this tenant, or re-run with the override to ' +
      'deploy a custom domain deliberately kept out of the index.';
    // Recorded, not just thrown. The tenant-triggered publish path calls this in
    // the background and only logs the rejection, so without a registry row a
    // refused deploy would look to everyone like a publish that worked.
    await tenants.recordDeploy(row.id, 'failed', null, message);
    await tenants.updateTenant(slug, { last_error: message });
    throw new Error(message);
  }

  const secrets = await getSecrets();
  if (!secrets.cloudflareToken || !secrets.cloudflareAccountId) {
    throw new Error('Set the Cloudflare API token + account id in Settings before publishing.');
  }

  const project = row.cf_project || `siteagent-${slug}`;
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: secrets.cloudflareToken,
    CLOUDFLARE_ACCOUNT_ID: secrets.cloudflareAccountId,
  };
  const deploy = await tenants.recordDeploy(row.id, 'uploading', null, null);

  // Ensure the Pages project exists (idempotent — ignore "already exists").
  await runWrangler(['pages', 'project', 'create', project, '--production-branch=main'], env);

  // robots.txt / _headers / llms.txt — the CMS cannot emit these, so they are
  // written into the upload directory here. Never fatal: a deploy that ships
  // without them is worse than one that ships with them, but far better than
  // no deploy at all.
  try {
    writeRootFiles(dir, row);
  } catch (e) {
    console.error(`[deploy] root files for ${slug} could not be written:`, e.message);
  }

  // Direct Upload the baked folder (resolved past the current -> slot symlink).
  const { code, out } = await runWrangler(
    ['pages', 'deploy', dir, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], env);

  if (deploySucceeded(code, out)) {
    const url = row.custom_domain ? `https://${row.custom_domain}` : canonicalPagesUrl(project);

    // The deploy tool says it uploaded. That is not the same as the site
    // serving what we baked, and until now nothing ever checked (R9,
    // AC-B9.2). A host that answers its fallback page for a missing route
    // returns 200 for everything, so this compares each route's own content.
    const verdict = await verifyDeployedSite(url, dir, bakedUrlPaths(dir)).catch((err) => ({
      verification: 'unverified',
      detail: `the check could not run: ${err instanceof Error ? err.message : String(err)}`,
      checked: 0,
      failed: 0,
    }));

    const live = verdict.verification !== 'failed';

    // Keep what was actually UPLOADED — after the root files were written into
    // the slot, not the CMS's bake before them — so the retained bundle is the
    // thing that went live and can reconstruct it (AC-B9.3).
    //
    // Only when it VERIFIED. This used to run unconditionally, above the line
    // that computes `live`, so a bundle the verifier had just proven was not
    // being served was still filed as "known-good" — and with three
    // generations kept, three bad deploys in a row evicted every genuinely good
    // one. The ring a rollback reads from could be emptied by exactly the
    // failure a rollback exists to recover from.
    //
    // `unverified` does not qualify either: it means the check could not run,
    // and calling a bundle good because nobody could look is the fail-open
    // principle P2 forbids. The cost is deliberate and worth stating — a
    // project whose verification can never run (no public address, nothing
    // baked) retains nothing and has nothing to roll back to. That is the
    // correct answer to "is this known to be good?", and it is loud.
    const keptAt = shouldRetainBundle(verdict.verification)
      ? await retainKnownGood(slug, dir).catch((err) => {
          console.warn(`[deploy] ${slug} could not retain the bundle: ${err.message}`);
          return null;
        })
      : null;
    await tenants.finishDeploy(deploy.id, live ? 'live' : 'failed', url, live ? null : verdict.detail);
    await tenants.updateTenant(slug, {
      pages_url: url,
      cf_project: project,
      last_error: live ? null : `Published, but the site is not serving it: ${verdict.detail}`,
    });

    await recordReceipt({
      tenantSlug: slug,
      contentHash: publishedSiteHash ?? null,
      publishedPages: publishedPages ?? null,
      cfProject: project,
      deployUrl: url,
      deployId: deploymentIdFrom(out),
      verification: verdict.verification,
      verificationDetail: verdict.detail,
      routesChecked: verdict.checked,
      routesFailed: verdict.failed,
      knownGoodPath: keptAt,
      build: BUILD_REVISION,
    });

    if (!live) {
      console.error(`[deploy] ${slug} uploaded but failed verification: ${verdict.detail}`);
      return { ok: false, error: verdict.detail, url };
    }
    return { ok: true, url, verification: verdict.verification };
  }
  // Surface the failure to the operator (the auto-publish webhook path is otherwise
  // silent — it only logged to the console, so a failed live publish looked fine).
  await tenants.finishDeploy(deploy.id, 'failed', null, out.slice(-1200));
  await tenants.updateTenant(slug, { last_error: `Publish→CF: ${out.slice(-400) || `wrangler exited ${code}`}` });

  // A failed deploy gets a receipt too.
  //
  // This path used to return here, so the ONE event the proof chain most needs
  // to record — a push that did not go live — left only the mutable `deploys`
  // row behind, and nothing in the append-only store. "Failed deployment
  // exercised" (E10) had no evidence artefact at all.
  //
  // Best-effort, matching the success path: `recordReceipt` already logs loudly
  // and does not throw, and a bookkeeping failure must not change what the
  // caller is told about the deploy itself.
  await recordReceipt({
    tenantSlug: slug,
    contentHash: publishedSiteHash ?? null,
    publishedPages: publishedPages ?? null,
    cfProject: project,
    deployUrl: null,
    deployId: deploymentIdFrom(out),
    verification: 'failed',
    verificationDetail: out.slice(-1200) || `wrangler exited ${code}`,
    routesChecked: 0,
    routesFailed: 0,
    knownGoodPath: null,
    build: BUILD_REVISION,
  });

  return { ok: false, error: out.slice(-600) || `wrangler exited ${code}` };
}

/**
 * Put a previously-retained, verified bundle back on the live site (E10).
 *
 * `listKnownGood` had no caller anywhere until this function: R9 retained three
 * generations per project and nothing could read one back, so "failed
 * deployment and rollback exercised" had no mechanism at all.
 *
 * This is a RE-DEPLOY of retained bytes, not a database restore. An earlier
 * plan note suggested wiring `listKnownGood` to `restoreSiteBackup`; they are
 * different layers — one is a directory of baked HTML for the CDN, the other a
 * JSON row-dump for the CMS — and they are not interchangeable. See the note at
 * the end of this docblock for the half this does NOT cover.
 *
 * Deliberate choices the PRD does not make, each recorded where it is made:
 *  - the retained bundle is COPIED and never mutated, so it stays byte-identical
 *    for a later rollback and for comparison;
 *  - today's robots policy is applied to that copy, so rolling back does not
 *    silently re-open a site to crawlers that was taken out of the index since;
 *  - a rollback does NOT retain a new generation — recovering must not evict the
 *    oldest good bundle as a side effect;
 *  - an unknown `to` is refused rather than quietly falling back to the newest.
 *
 * NOT COVERED, and named so it is not mistaken for done: this restores what the
 * SITE SERVES. The CMS database still holds the content that was published, so
 * the next publish will push it again. Closing that needs an operable caller for
 * `restoreSiteBackup`, which is the R15 gap.
 */
/**
 * Does a verdict qualify a bundle as known-good? (AC-B9.3)
 *
 * Only `verified`. `failed` is obvious; `unverified` is the one worth stating —
 * it means the check could not RUN, and filing a bundle as good because nobody
 * could look is the fail-open shape P2 forbids.
 *
 * Exported as its own function so the rule is testable without a database or a
 * Cloudflare account, which is what the rest of this path needs.
 */
export function shouldRetainBundle(verification) {
  return verification === 'verified';
}

/**
 * Which retained generation to roll back to.
 *
 * `to` absent picks the newest. `to` given must MATCH — an unknown value is
 * refused rather than silently falling back to the newest, because a rollback
 * that quietly restored a different generation than the one asked for is the
 * worst outcome available here.
 *
 * Returns `{ ok: true, target }` or `{ ok: false, reason }`.
 */
export function selectKnownGood(kept, to = null) {
  if (!Array.isArray(kept) || kept.length === 0) {
    return {
      ok: false,
      reason: 'No retained bundle. Only a deploy that verified is kept, so there is nothing known-good to roll back to.',
    };
  }
  if (!to) return { ok: true, target: kept[0] };
  const target = kept.find((k) => k.at === to);
  return target
    ? { ok: true, target }
    : { ok: false, reason: `No retained bundle at "${to}". Available: ${kept.map((k) => k.at).join(', ')}` };
}

export async function rollbackTenant(slug, { to = null } = {}, deps = {}) {
  const {
    run = runWrangler,
    verify = verifyDeployedSite,
    record = recordReceipt,
    kept: keptFn = listKnownGood,
    receipts: receiptsFn = listReceipts,
  } = deps;

  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  // No fallback to the bundle that is already live: there is nothing to roll
  // back TO, and saying so is the correct answer rather than re-pushing the
  // state somebody is trying to get away from.
  const choice = selectKnownGood(await keptFn(slug), to);
  if (!choice.ok) throw new Error(`${slug}: ${choice.reason}`);
  const target = choice.target;

  // Same refusal a deploy makes. A rollback onto a custom domain with indexing
  // off would publish `Disallow: /` to a production site for the same reason.
  if (row.custom_domain && row.search_indexing !== true) {
    const message =
      `Refusing to roll ${slug} back to ${row.custom_domain} with search indexing OFF — ` +
      'the site would publish with robots.txt "Disallow: /" and X-Robots-Tag noindex.';
    await tenants.recordDeploy(row.id, 'failed', null, message);
    throw new Error(message);
  }

  const secrets = await getSecrets();
  if (!secrets.cloudflareToken || !secrets.cloudflareAccountId) {
    throw new Error('Set the Cloudflare API token + account id in Settings before rolling back.');
  }

  const project = row.cf_project || `siteagent-${slug}`;
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: secrets.cloudflareToken,
    CLOUDFLARE_ACCOUNT_ID: secrets.cloudflareAccountId,
  };

  // Stage a copy. The retained directory is evidence and must survive this.
  const staging = resolve(publishedDir(slug), `rollback-${Date.now()}`);
  rmSync(staging, { recursive: true, force: true });
  cpSync(target.path, staging, { recursive: true });
  try {
    writeRootFiles(staging, row);
  } catch (e) {
    console.error(`[rollback] root files for ${slug} could not be written:`, e.message);
  }

  const deploy = await tenants.recordDeploy(row.id, 'uploading', null, null);
  const { code, out } = await run(
    ['pages', 'deploy', staging, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], env);

  if (!deploySucceeded(code, out)) {
    await tenants.finishDeploy(deploy.id, 'failed', null, out.slice(-1200));
    await record({
      tenantSlug: slug, kind: 'rollback', cfProject: project, deployUrl: null,
      deployId: deploymentIdFrom(out), verification: 'failed',
      verificationDetail: out.slice(-1200) || `wrangler exited ${code}`,
      knownGoodPath: target.path, build: BUILD_REVISION,
    });
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: out.slice(-600) || `wrangler exited ${code}`, restoredFrom: target.at };
  }

  const url = row.custom_domain ? `https://${row.custom_domain}` : canonicalPagesUrl(project);

  // Measured fresh against what is now serving — never copied from the receipt
  // being restored. A rollback that did not actually restore the site has to be
  // able to say so; that is what makes this receipt evidence and not a claim.
  const verdict = await verify(url, staging, bakedUrlPaths(staging)).catch((err) => ({
    verification: 'unverified',
    detail: `the check could not run: ${err instanceof Error ? err.message : String(err)}`,
    checked: 0,
    failed: 0,
  }));

  // The receipt whose bundle this was, so the rollback names what it restored.
  // An orphaned bundle (kept, but its receipt aged out) is possible and is
  // recorded as null rather than invented.
  let restoredFromReceiptId = null;
  let contentHash = null;
  let publishedPages = null;
  try {
    const priors = await receiptsFn({ level: 'platform' }, slug, 200);
    const match = priors.find((r) => r.known_good_path === target.path);
    if (match) {
      restoredFromReceiptId = match.id;
      contentHash = match.content_hash ?? null;
      publishedPages = match.published_pages ?? null;
    }
  } catch (err) {
    console.warn(`[rollback] ${slug} could not resolve the restored receipt: ${err.message}`);
  }

  const live = verdict.verification !== 'failed';
  await tenants.finishDeploy(deploy.id, live ? 'live' : 'failed', url, live ? null : verdict.detail);
  await tenants.updateTenant(slug, {
    pages_url: url,
    cf_project: project,
    last_error: live ? null : `Rolled back, but the site is not serving it: ${verdict.detail}`,
  });

  const receiptId = await record({
    tenantSlug: slug,
    kind: 'rollback',
    restoredFromReceiptId,
    contentHash,
    publishedPages,
    cfProject: project,
    deployUrl: url,
    deployId: deploymentIdFrom(out),
    verification: verdict.verification,
    verificationDetail: verdict.detail,
    routesChecked: verdict.checked,
    routesFailed: verdict.failed,
    // The generation that went live. NOT retained again — see the docblock.
    knownGoodPath: target.path,
    build: BUILD_REVISION,
  });

  rmSync(staging, { recursive: true, force: true });

  return {
    ok: live,
    url,
    verification: verdict.verification,
    restoredFrom: target.at,
    restoredFromReceiptId,
    // A rollback whose proof failed to write must not read as a clean success.
    receipt: receiptId ?? 'NOT WRITTEN',
    ...(live ? {} : { error: verdict.detail }),
  };
}
