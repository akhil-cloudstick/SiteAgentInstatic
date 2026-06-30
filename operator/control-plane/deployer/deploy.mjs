// Publish Deployer — ships a tenant's baked static site to Cloudflare Pages via wrangler.
// Instatic bakes fully-static pages to <uploads>/published/current/ at publish time.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as tenants from '../registry/tenants.mjs';
import { getSecrets } from '../registry/settings.mjs';
import * as rt from '../runtime/tenantRuntime.mjs';
import config from '../lib/env.mjs';

const isWin = process.platform === 'win32';

export function bakedDir(slug) {
  return resolve(rt.tenantPaths(slug).uploads, 'published', 'current');
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

export async function deployTenant(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  const dir = bakedDir(slug);
  if (!existsSync(dir)) {
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

  // Direct Upload the baked folder.
  const { code, out } = await runWrangler(
    ['pages', 'deploy', dir, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], env);

  const m = out.match(/https:\/\/[a-z0-9-]+\.pages\.dev/i);
  const url = m ? m[0] : null;

  if (code === 0 && url) {
    await tenants.finishDeploy(deploy.id, 'live', url, null);
    await tenants.updateTenant(slug, { pages_url: url, cf_project: project });
    return { ok: true, url };
  }
  await tenants.finishDeploy(deploy.id, 'failed', null, out.slice(-1200));
  return { ok: false, error: out.slice(-600) || `wrangler exited ${code}` };
}
