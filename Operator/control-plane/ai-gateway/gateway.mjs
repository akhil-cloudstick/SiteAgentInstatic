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
import { Readable, Transform } from 'node:stream';
import { askForUsage, capDecision, costOf, createUsageScanner } from '../lib/aiSpend.mjs';
import { pricesForModel } from '../lib/aiPrices.mjs';
import { capAndSpend, recordSpend } from '../registry/aiSpend.mjs';
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

/**
 * Upstream paths this gateway will proxy (security item E2).
 *
 * `rest` is whatever followed the signed token in the request path, and it was
 * forwarded to OpenRouter verbatim — so a tenant could pick which endpoint the
 * OPERATOR'S key was spent on. These three are what the clients actually use,
 * read from the code rather than guessed:
 *
 *   /v1/responses         — the answer call (openrouter driver, `${base}/responses`)
 *   /v1/models            — the catalogue fetch (`listModels`, `${base}/models`)
 *   /v1/chat/completions  — the classifier's cheap category pick
 *
 * MMS Design calls `/ai/<token>/design/v1/...`, and `/design` is stripped before
 * this check, so both products land on the same three.
 *
 * A refusal is logged with the path that was asked for, so an endpoint this list
 * has missed shows up as a named 403 in the operator's terminal rather than as a
 * silent failure somewhere downstream.
 */
const UPSTREAM_ALLOWED = new Set([
  '/v1/responses',
  '/v1/models',
  '/v1/chat/completions',
]);

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

  // /spend — what this project has left of its AI limit this month.
  //
  // A probe, like /model and /config above: no upstream call, and the operator's
  // key is never decrypted to answer it. It exists so the daemon can refuse to
  // START a run that the gateway would only refuse partway through — the
  // enforcement is the same either way, but a run that never starts is a far
  // better thing for a tenant to be told about than one that dies mid-sentence.
  //
  // Carries no numbers the tenant cannot already infer and no model ids.
  if (rest === '/spend' || rest === '/spend/') {
    let state = null;
    try {
      state = await capAndSpend(slug);
    } catch {
      // Unreadable. capDecision decides what that means, and it is not the same
      // answer for a capped project as for an uncapped one.
      state = { cap: undefined, spent: null };
    }
    const decision = capDecision({ cap: state?.cap, spent: state?.spent });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        allow: decision.allow,
        level: decision.level,
        reason: decision.reason,
        percent: decision.fraction === null ? null : Math.round(decision.fraction * 100),
      }),
    );
  }

  // /media-spend — the daemon reporting an image, video or speech generation.
  //
  // Media never passes through this gateway: the operator's provider keys are
  // injected into each daemon and those calls go straight out. So the daemon
  // reports them here instead, which makes media COUNTED and (via the /spend
  // probe above) CAPPED, but not priced — providers do not return a cost and
  // there is no per-model table for them. The row is written with an unknown
  // cost rather than a guessed one, and the ledger reports how many such calls
  // a month holds.
  if (rest === '/media-spend' && req.method === 'POST') {
    const raw = await readRawBody(req).catch(() => null);
    let detail = {};
    try {
      detail = raw ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      // A malformed report is not worth failing over; it is still a call that
      // happened, and the surface/model are only labels.
    }
    recordSpend({
      slug,
      product: 'media',
      model: typeof detail?.model === 'string' ? detail.model.slice(0, 200) : null,
      usage: null,
      costUsd: null,
    });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ recorded: true }));
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
          // A streamed OpenAI-compatible response reports no usage unless it is
          // asked to. Without this the ledger would be empty and the cap would
          // have nothing to count. Free here, because the body is already being
          // re-serialised to pin the model.
          askForUsage(payload);
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
      // A body that CLAIMS to be JSON and will not parse is blocked, not
      // forwarded.
      //
      // This used to fall through to "forward unchanged", which meant the one
      // thing this gateway exists to guarantee — that a tenant call runs on the
      // operator's model — was skipped for any body the parser choked on. The
      // branch twelve lines above already refuses when no model can be resolved,
      // for exactly this reason; forwarding an unpinnable body was the same
      // failure wearing a different hat.
      console.log(`[ai-gateway] ${slug} · ${product}: ✗ BLOCKED — body declared JSON but did not parse`);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Malformed JSON body');
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

  // Only these upstream paths (security item E2).
  //
  // `rest` is whatever followed the token in the request path and was forwarded
  // verbatim, so the tenant chose which OpenRouter endpoint the operator's key
  // was spent on. The key is the operator's and the allowlist is the operator's
  // too: an endpoint nobody put on this list is refused rather than proxied.
  if (!UPSTREAM_ALLOWED.has(rest)) {
    console.log(`[ai-gateway] ${slug} · ${product}: ✗ BLOCKED — upstream path not allowed: ${rest}`);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Upstream path not allowed');
  }

  // --- the spending cap (E4) ---------------------------------------------
  //
  // Checked HERE, before the upstream request, and that position does two jobs
  // the owner asked for without any extra machinery:
  //
  //   * "finish the reply in progress" — a turn whose upstream fetch has already
  //     returned is committed and streams to its end. The cap stops the NEXT
  //     turn, never one mid-sentence.
  //   * "never block editing, publishing, or the live site" — only AI traffic
  //     passes through this gateway at all, so a cap cannot reach the CMS, a
  //     publish, or a deployed page even in principle.
  //
  // The classifier is exempt. It is a cheap non-agentic call that serves CMS
  // editing, and editing is the thing that must keep working.
  let spendState = null;
  if (isModelCall && !classify) {
    try {
      spendState = await capAndSpend(slug);
    } catch (e) {
      // The read failed. `capDecision` decides what that means, and it is not
      // the same answer for a capped project as for an uncapped one.
      console.error(`[ai-gateway] ${slug}: could not read the spending ledger: ${e.message}`);
      spendState = { cap: undefined, spent: null };
    }
    const decision = capDecision({ cap: spendState?.cap, spent: spendState?.spent });
    if (!decision.allow) {
      console.log(
        `[ai-gateway] ${slug} · ${product}: ✗ BLOCKED — ${decision.level} ` +
          `(spent ${decision.spent ?? '?'} of ${decision.cap ?? '?'})`,
      );
      // Plain language, no status codes and no model ids: the tenant cannot act
      // on any of those, and the only useful action is to tell the operator.
      // 402 rather than 429: a rate-limit status invites the agent's client to
      // back off and retry, and a spending cap is not a thing retrying fixes.
      res.writeHead(402, { 'Content-Type': 'text/plain' });
      return res.end(decision.reason);
    }
    if (decision.level === 'warn') {
      console.warn(
        `[ai-gateway] ${slug} · ${product}: ⚠ ${Math.round(decision.fraction * 100)}% of the monthly AI limit`,
      );
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
    const source = Readable.fromWeb(upstream.body);

    // Metered by TEEING, never by buffering. The agent loop depends on tokens
    // arriving as they are produced, so the usage is read from the frames as
    // they pass rather than by awaiting the whole body. A scanner that throws,
    // or a stream that carries no usage at all, costs the tenant nothing.
    if (isModelCall && upstream.ok) {
      const scanner = createUsageScanner();
      const meter = new Transform({
        transform(chunk, _enc, done) {
          scanner.push(chunk);
          done(null, chunk);
        },
      });
      meter.on('end', async () => {
        const usage = scanner.result();
        if (!usage) return;
        try {
          const prices = await pricesForModel(resolvedModel, secrets.openrouterKey);
          recordSpend({ slug, product, model: resolvedModel, usage, costUsd: costOf(usage, prices) });
        } catch (e) {
          console.error(`[ai-gateway] ${slug}: could not record spend: ${e.message}`);
        }
      });
      source.pipe(meter).pipe(res);
    } else {
      source.pipe(res); // streams SSE token-by-token
    }
  } else {
    res.end();
  }
}
