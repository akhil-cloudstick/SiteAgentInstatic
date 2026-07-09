// AI Gateway — reverse proxy to OpenRouter that injects the single global key
// AND resolves which model runs per request from the operator's task-type map.
// Each tenant's Instatic points its OpenRouter base URL at:
//   http://127.0.0.1:<cp>/ai/<signed-tenant-token>/v1
// The real key lives ONLY here; it is never stored in a tenant instance.
//
// Routing headers (set by the tenant SERVER, never the browser):
//   x-instatic-ai-classify: 1        -> use the cheap classifier model
//   x-instatic-ai-category: <slug>   -> use that category's model
//   (absent / unknown slug)          -> the default category's model
// The gateway never trusts a raw `model` from the client; it maps a category
// slug server-side. The resolved model is echoed back in x-instatic-resolved-model
// for audit/cost on the tenant side.
import { Readable } from 'node:stream';
import {
  getSecrets,
  readAiSettingsRaw,
  resolveRoutedModel,
  defaultModelOf,
  publicAiConfig,
  getDefaultGuidance,
} from '../registry/settings.mjs';
import { verifyTenantToken } from '../lib/crypto.mjs';

const OPENROUTER = 'https://openrouter.ai/api';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// pathAfterAi = everything after "/ai/", e.g. "<token>/v1/chat/completions"
export async function handleGateway(req, res, pathAfterAi) {
  const slash = pathAfterAi.indexOf('/');
  const token = slash === -1 ? pathAfterAi : pathAfterAi.slice(0, slash);
  const rest = slash === -1 ? '' : pathAfterAi.slice(slash); // "/v1/chat/completions"

  const slug = verifyTenantToken(decodeURIComponent(token));
  if (!slug) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('invalid tenant token'); }

  // --- Probes (NOT proxied). Served WITHOUT decrypting the OpenRouter key so a
  // config poll never touches the secret (Codex #7). ---

  // /model — legacy back-compat: the single default model id. This DOES disclose
  // a model id to the tenant (accepted legacy behavior); /config never does.
  if (rest === '/model' || rest === '/model/') {
    const cfg = await readAiSettingsRaw();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ model: defaultModelOf(cfg) || '' }));
  }

  // /config — the task-type categories (names + descriptions, NO model ids),
  // global guidance, and whether a classifier is configured.
  if (rest === '/config' || rest === '/config/') {
    const cfg = await readAiSettingsRaw();
    const pub = publicAiConfig(cfg);
    // If the operator hasn't written custom guidance, serve the authored
    // project default from /rules so every tenant gets it automatically.
    if (!pub.guidance) pub.guidance = getDefaultGuidance();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(pub));
  }

  const secrets = await getSecrets();
  if (!secrets.openrouterKey) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('AI not configured'); }

  let body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRawBody(req);

  // --- Model resolution (Codex #1, #13, #14) ---
  const classify = String(req.headers['x-instatic-ai-classify'] || '') === '1';
  const categorySlug = String(req.headers['x-instatic-ai-category'] || '').trim() || null;
  const cfg = await readAiSettingsRaw();
  let resolvedModel = resolveRoutedModel(cfg, { classify, categorySlug });

  const isJson = !!body && String(req.headers['content-type'] || '').includes('json');
  if (isJson) {
    try {
      const payload = JSON.parse(body.toString('utf8'));
      if (payload && typeof payload === 'object') {
        if (resolvedModel) {
          // ALWAYS set the model on JSON chat bodies — even when the client
          // omitted `model` — so enforcement can't be bypassed (Codex #1).
          payload.model = resolvedModel;
          body = Buffer.from(JSON.stringify(payload), 'utf8');
        } else if (payload.model) {
          // Nothing configured operator-side: fall back to the tenant's own
          // model (legacy passthrough).
          resolvedModel = payload.model;
        } else {
          // No operator config AND no client model -> fail closed (Codex #13).
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          return res.end('AI model not configured');
        }
      }
    } catch {
      // Non-JSON body — forward unchanged.
    }
  }

  // Observability: one line per proxied model call so the operator can watch
  // routing live and cross-check which model actually ran each tenant message.
  // Two endpoints reach here: the classifier's cheap category pick uses
  // /chat/completions; the real answer call uses the OpenAI Responses API
  // (/responses). The classify call is logged quietly; the answer call is
  // logged prominently as "USING MODEL: <id>".
  const isModelCall = rest.endsWith('/chat/completions') || rest.endsWith('/responses');
  if (isModelCall) {
    if (classify) {
      console.log(`[ai-gateway] ${slug}: classifier picking category (via ${resolvedModel})`);
    } else {
      const route = categorySlug ? `category "${categorySlug}"` : 'default category';
      console.log(`[ai-gateway] ${slug}: ✦ USING MODEL: ${resolvedModel || '(tenant model)'}  — routed to ${route}`);
    }
  }

  let upstream;
  try {
    upstream = await fetch(`${OPENROUTER}${rest}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${secrets.openrouterKey}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
        'HTTP-Referer': 'http://127.0.0.1',
        'X-Title': `SiteAgent/${slug}`,
      },
      body,
    });
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end(`gateway upstream error: ${e.message}`);
  }

  const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
  // Echo the actually-routed model so the tenant can audit + price correctly
  // (Codex #10). Safe to expose to the tenant server (server-to-server).
  if (resolvedModel) headers['x-instatic-resolved-model'] = resolvedModel;
  res.writeHead(upstream.status, headers);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res); // streams SSE token-by-token
  } else {
    res.end();
  }
}
