// Operator settings: OpenRouter key/model + Cloudflare creds + per-task-type AI
// model routing (categories) + global AI guidance. Secrets encrypted at rest.
import { readFileSync, writeFileSync } from 'node:fs';
import { query } from './db.mjs';
import { encrypt, decrypt } from '../lib/crypto.mjs';

// The project's authored default AI guidance lives in /rules and is version
// controlled, so the operator never has to write it. Read once and cache.
// (registry/ -> control-plane/ -> operator/ -> repo root -> rules/)
const DEFAULT_GUIDANCE_URL = new URL('../../../rules/globalAiGuidanceRule.md', import.meta.url);
let defaultGuidanceCache = null;

const GUIDANCE_MAX = 16_000;

/** The authored default guidance from /rules/globalAiGuidanceRule.md ('' if missing). */
export function getDefaultGuidance() {
  if (defaultGuidanceCache !== null) return defaultGuidanceCache;
  try {
    defaultGuidanceCache = readFileSync(DEFAULT_GUIDANCE_URL, 'utf8');
  } catch {
    defaultGuidanceCache = '';
  }
  return defaultGuidanceCache;
}

/**
 * Overwrite /rules/globalAiGuidanceRule.md with operator-edited text and refresh
 * the in-memory cache so the AI Gateway's /config probe serves it immediately
 * (every tenant's AI chat reads it on its next message — no restart needed).
 */
export function saveDefaultGuidance(text) {
  if (typeof text !== 'string') throw new Error('guidance must be text');
  if (text.length > GUIDANCE_MAX) throw new Error(`guidance too large (max ${GUIDANCE_MAX} chars)`);
  writeFileSync(DEFAULT_GUIDANCE_URL, text, 'utf8');
  defaultGuidanceCache = text; // keep the cache in lock-step with the file on disk
  return text;
}
// Header-safe, stable category id. Lowercase alnum + dashes; must start alnum.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const BUILTIN_SLUGS = ['design', 'content'];

// pg returns jsonb already parsed; tolerate a string too (defensive).
function parseCategories(v) {
  if (!v) return [];
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return []; } }
  return Array.isArray(arr) ? arr : [];
}

// Safe view for the UI (never returns plaintext secrets, but DOES return the
// category→model map: model ids are not secret to the operator console).
export async function getSettings() {
  const { rows } = await query('select * from siteagent_control.settings where id = 1');
  const r = rows[0] || {};
  return {
    openrouterModel: r.openrouter_model || '',
    cloudflareAccountId: r.cloudflare_account_id || '',
    hasOpenrouterKey: !!r.openrouter_key_enc,
    hasCloudflareToken: !!r.cloudflare_token_enc,
    aiCategories: parseCategories(r.ai_categories),
    classifierModel: r.classifier_model || '',
    aiGuidance: r.ai_guidance || '',
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

// AI routing config WITHOUT decrypting the OpenRouter key. Used by the gateway
// for the /model + /config probes and for category→model resolution, so those
// paths never touch the encrypted key (Codex #7).
export async function readAiSettingsRaw() {
  const { rows } = await query(
    'select ai_categories, ai_guidance, classifier_model, openrouter_model from siteagent_control.settings where id = 1',
  );
  const r = rows[0] || {};
  return {
    categories: parseCategories(r.ai_categories),
    classifierModel: r.classifier_model || null,
    guidance: r.ai_guidance || '',
    legacyModel: r.openrouter_model || null, // back-compat default source
  };
}

// The default model id, derived from the categories or the legacy single model.
export function defaultModelOf({ categories, legacyModel }) {
  const def = categories.find((c) => c.isDefault && c.modelId);
  if (def) return def.modelId;
  const any = categories.find((c) => c.modelId);
  if (any) return any.modelId;
  return legacyModel || null;
}

// Resolve the concrete model id for a routed call.
//   { classify: true }          -> the classifier model (falls back to default)
//   { categorySlug: '<slug>' }  -> that category's model
//   absent / unknown slug       -> the default model (Codex #14: no magic string)
export function resolveRoutedModel(cfg, { classify = false, categorySlug = null } = {}) {
  if (classify) return cfg.classifierModel || defaultModelOf(cfg);
  if (categorySlug) {
    const hit = cfg.categories.find((c) => c.slug === categorySlug);
    if (hit && hit.modelId) return hit.modelId;
  }
  return defaultModelOf(cfg);
}

// Non-secret config for the tenant /config probe. NEVER includes model ids.
export function publicAiConfig(cfg) {
  return {
    categories: cfg.categories.map((c) => ({
      slug: c.slug,
      name: c.name || c.slug,
      description: c.description || '',
    })),
    guidance: cfg.guidance || '',
    hasClassifier: !!cfg.classifierModel,
  };
}

// Reject a malformed AI config before it is written (Codex #6). Throws -> 400.
function validateAiConfig({ aiCategories, aiGuidance, classifierModel }) {
  if (aiCategories !== undefined) {
    if (!Array.isArray(aiCategories) || aiCategories.length === 0) {
      throw new Error('aiCategories must be a non-empty array');
    }
    const slugs = new Set();
    let defaults = 0;
    for (const c of aiCategories) {
      if (!c || typeof c !== 'object') throw new Error('invalid category entry');
      if (typeof c.slug !== 'string' || !SLUG_RE.test(c.slug)) {
        throw new Error(`invalid category slug: ${JSON.stringify(c.slug)}`);
      }
      if (slugs.has(c.slug)) throw new Error(`duplicate category slug: ${c.slug}`);
      slugs.add(c.slug);
      if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`category ${c.slug} needs a name`);
      if (typeof c.modelId !== 'string' || !c.modelId.trim()) throw new Error(`category ${c.slug} needs a model`);
      if (c.description != null && typeof c.description !== 'string') {
        throw new Error(`category ${c.slug} description must be text`);
      }
      if (c.isDefault === true) defaults++;
    }
    if (defaults !== 1) throw new Error('exactly one category must be marked as the default');
    for (const b of BUILTIN_SLUGS) {
      if (!slugs.has(b)) throw new Error(`missing builtin category: ${b}`);
    }
  }
  if (aiGuidance != null) {
    if (typeof aiGuidance !== 'string') throw new Error('aiGuidance must be text');
    if (aiGuidance.length > GUIDANCE_MAX) throw new Error(`aiGuidance too large (max ${GUIDANCE_MAX} chars)`);
  }
  if (classifierModel != null && typeof classifierModel !== 'string') {
    throw new Error('classifierModel must be text');
  }
}

// Normalize categories server-side: force builtin flag for design/content,
// coerce isDefault to a real bool, trim strings. Never trust the client blindly.
function normalizeCategories(aiCategories) {
  return aiCategories.map((c) => ({
    slug: c.slug,
    name: String(c.name).trim(),
    description: c.description ? String(c.description) : '',
    modelId: String(c.modelId).trim(),
    isDefault: c.isDefault === true,
    builtin: BUILTIN_SLUGS.includes(c.slug),
  }));
}

// Upsert the singleton. Only overwrite a value when a new one is given
// (undefined => keep existing). AI fields validated first.
export async function saveSettings({
  openrouterKey,
  openrouterModel,
  cloudflareToken,
  cloudflareAccountId,
  aiCategories,
  classifierModel,
  aiGuidance,
} = {}) {
  validateAiConfig({ aiCategories, aiGuidance, classifierModel });

  const categoriesJson = aiCategories !== undefined
    ? JSON.stringify(normalizeCategories(aiCategories))
    : null;

  await query(
    `insert into siteagent_control.settings
       (id, openrouter_key_enc, openrouter_model, cloudflare_token_enc, cloudflare_account_id,
        ai_categories, classifier_model, ai_guidance, updated_at)
     values (1, $1, $2, $3, $4, $5, $6, $7, now())
     on conflict (id) do update set
       openrouter_key_enc    = coalesce($1, siteagent_control.settings.openrouter_key_enc),
       openrouter_model      = coalesce($2, siteagent_control.settings.openrouter_model),
       cloudflare_token_enc  = coalesce($3, siteagent_control.settings.cloudflare_token_enc),
       cloudflare_account_id = coalesce($4, siteagent_control.settings.cloudflare_account_id),
       ai_categories         = coalesce($5, siteagent_control.settings.ai_categories),
       classifier_model      = coalesce($6, siteagent_control.settings.classifier_model),
       ai_guidance           = coalesce($7, siteagent_control.settings.ai_guidance),
       updated_at = now()`,
    [
      openrouterKey ? encrypt(openrouterKey) : null,
      openrouterModel || null,
      cloudflareToken ? encrypt(cloudflareToken) : null,
      cloudflareAccountId || null,
      categoriesJson,
      classifierModel != null ? (classifierModel || '') : null,
      aiGuidance != null ? aiGuidance : null,
    ],
  );
  return getSettings();
}
