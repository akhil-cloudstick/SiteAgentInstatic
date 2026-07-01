// Publish Deployer — ships a tenant's baked static site to Cloudflare Pages via wrangler.
// Instatic bakes fully-static pages to <uploads>/published/current/ at publish time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as tenants from '../registry/tenants.mjs';
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

  // Write + Direct-Upload the placeholder page.
  const dir = resolve(rt.tenantPaths(slug).dir, 'placeholder');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), placeholderHtml(slug));

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

export async function deployTenant(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  const dir = bakedDir(slug);
  if (!dir) {
    throw new Error('No published output yet — open the site and click Publish inside Instatic first.');
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

  // Direct Upload the baked folder (resolved past the current -> slot symlink).
  const { code, out } = await runWrangler(
    ['pages', 'deploy', dir, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], env);

  if (deploySucceeded(code, out)) {
    const url = canonicalPagesUrl(project);
    await tenants.finishDeploy(deploy.id, 'live', url, null);
    await tenants.updateTenant(slug, { pages_url: url, cf_project: project, last_error: null });
    return { ok: true, url };
  }
  // Surface the failure to the operator (the auto-publish webhook path is otherwise
  // silent — it only logged to the console, so a failed live publish looked fine).
  await tenants.finishDeploy(deploy.id, 'failed', null, out.slice(-1200));
  await tenants.updateTenant(slug, { last_error: `Publish→CF: ${out.slice(-400) || `wrangler exited ${code}`}` });
  return { ok: false, error: out.slice(-600) || `wrangler exited ${code}` };
}
