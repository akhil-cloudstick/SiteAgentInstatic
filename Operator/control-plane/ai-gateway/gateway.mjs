// AI Gateway — reverse proxy to OpenRouter that injects the single global key
// AND resolves which model runs per request from the operator's task-type map.
// Each tenant's Instatic points its OpenRouter base URL at:
//   http://127.0.0.1:<cp>/ai/<signed-tenant-token>/v1
// The real key lives ONLY here; it is never stored in a tenant instance.
//
// Routing headers (set by the tenant SERVER, never the browser):
//   x-instatic-ai-classify: 1        -> use the cheap classifier model
//   x-instatic-ai-vision: 1          -> the request carries an image; use the
//                                       Design (multimodal) model, overriding
//                                       the text-classified category
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
  designModelOf,
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
  let rest = slash === -1 ? '' : pathAfterAi.slice(slash); // "/v1/chat/completions"

  const slug = verifyTenantToken(decodeURIComponent(token));
  if (!slug) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('invalid tenant token'); }

  // Which PRODUCT is calling. The CMS uses /ai/<token>/v1/... ; MMS Design uses
  // /ai/<token>/design/v1/... . This is a path segment rather than a header on
  // purpose: OpenDesign's model traffic is emitted by an `opencode` child
  // process through @ai-sdk/openai-compatible, so its base URL is the one thing
  // we can pin — its headers are an upstream detail we don't own. A header
  // would also be spoofable by the sibling CMS, which holds the same token.
  // The token is "<slug>.<hmac>" (no slash), so the split above still holds.
  let product = 'cms';
  if (rest === '/design' || rest.startsWith('/design/')) {
    product = 'design';
    rest = rest.slice('/design'.length) || '/';
  }

  // --- Probes (NOT proxied). Served WITHOUT decrypting the OpenRouter key so a
  // config poll never touches the secret (Codex #7). ---

  // /model — legacy back-compat: the single default model id. This DOES disclose
  // a model id to the tenant (accepted legacy behavior); /config never does.
  // MMS Design polls this (via /ai/<token>/design/model) to learn the model the
  // operator picked, so a Settings change lands on the next run without any
  // restart. The CMS keeps its historical meaning: the single default model.
  if (rest === '/model' || rest === '/model/') {
    const cfg = await readAiSettingsRaw();
    const model = product === 'design' ? designModelOf(cfg) : defaultModelOf(cfg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ model: model || '' }));
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
  // The request carries an image. The tenant classifies on prompt text alone,
  // so without this a "rewrite this heading" prompt with a screenshot attached
  // would route to the text-only Content model and the image would be refused.
  const requiresVision = String(req.headers['x-instatic-ai-vision'] || '') === '1';
  const cfg = await readAiSettingsRaw();
  // MMS Design runs on ONE operator-set model: no classifier, no categories, and
  // no vision fallback (its model is required to be multimodal at pick time).
  let resolvedModel = product === 'design'
    ? designModelOf(cfg)
    : resolveRoutedModel(cfg, { classify, categorySlug, requiresVision });

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
        } else if (payload.model && product !== 'design') {
          // Nothing configured operator-side: fall back to the tenant's own
          // model (legacy passthrough). NOT for MMS Design — a tenant there has
          // no model of their own to fall back to, and silently running one the
          // operator never chose is exactly what this gateway exists to prevent.
          resolvedModel = payload.model;
        } else {
          // No operator config AND no usable client model -> fail closed
          // (Codex #13). The operator gets the diagnostic here; the tenant only
          // ever sees the plain "contact your operator" copy.
          console.log(`[ai-gateway] ${slug} · ${product}: ✗ BLOCKED — no model configured`);
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
    if (product === 'design') {
      // One line per turn of the agent loop, so an operator watching this
      // terminal can confirm every tenant /design call runs on the model they
      // set — and nothing else.
      console.log(`[ai-gateway] ${slug} · design: ✦ USING MODEL: ${resolvedModel}  — MMS Design (operator-set)`);
    } else if (classify) {
      console.log(`[ai-gateway] ${slug} · cms: classifier picking category (via ${resolvedModel})`);
    } else {
      const route = requiresVision
        ? `category "design" (image attached${categorySlug ? `, text classified as "${categorySlug}"` : ''})`
        : categorySlug ? `category "${categorySlug}"` : 'default category';
      console.log(`[ai-gateway] ${slug} · cms: ✦ USING MODEL: ${resolvedModel || '(tenant model)'}  — routed to ${route}`);
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
        // Splits CMS from Design spend per tenant on OpenRouter's activity page.
        'X-Title': `SiteAgent/${slug}/${product}`,
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
