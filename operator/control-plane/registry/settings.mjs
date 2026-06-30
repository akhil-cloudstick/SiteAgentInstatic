// Operator settings: OpenRouter key/model + Cloudflare creds. Secrets encrypted at rest.
import { query } from './db.mjs';
import { encrypt, decrypt } from '../lib/crypto.mjs';

// Safe view for the UI (never returns plaintext secrets).
export async function getSettings() {
  const { rows } = await query('select * from siteagent_control.settings where id = 1');
  const r = rows[0] || {};
  return {
    openrouterModel: r.openrouter_model || '',
    cloudflareAccountId: r.cloudflare_account_id || '',
    hasOpenrouterKey: !!r.openrouter_key_enc,
    hasCloudflareToken: !!r.cloudflare_token_enc,
  };
}

// Decrypted secrets — server-side only (AI Gateway, Deployer).
export async function getSecrets() {
  const { rows } = await query('select * from siteagent_control.settings where id = 1');
  const r = rows[0] || {};
  return {
    openrouterKey: r.openrouter_key_enc ? decrypt(r.openrouter_key_enc) : null,
    openrouterModel: r.openrouter_model || null,
    cloudflareToken: r.cloudflare_token_enc ? decrypt(r.cloudflare_token_enc) : null,
    cloudflareAccountId: r.cloudflare_account_id || null,
  };
}

// Upsert the singleton. Only overwrite a secret when a new non-empty value is given.
export async function saveSettings({ openrouterKey, openrouterModel, cloudflareToken, cloudflareAccountId } = {}) {
  await query(
    `insert into siteagent_control.settings
       (id, openrouter_key_enc, openrouter_model, cloudflare_token_enc, cloudflare_account_id, updated_at)
     values (1, $1, $2, $3, $4, now())
     on conflict (id) do update set
       openrouter_key_enc    = coalesce($1, siteagent_control.settings.openrouter_key_enc),
       openrouter_model      = coalesce($2, siteagent_control.settings.openrouter_model),
       cloudflare_token_enc  = coalesce($3, siteagent_control.settings.cloudflare_token_enc),
       cloudflare_account_id = coalesce($4, siteagent_control.settings.cloudflare_account_id),
       updated_at = now()`,
    [
      openrouterKey ? encrypt(openrouterKey) : null,
      openrouterModel || null,
      cloudflareToken ? encrypt(cloudflareToken) : null,
      cloudflareAccountId || null,
    ],
  );
  return getSettings();
}
