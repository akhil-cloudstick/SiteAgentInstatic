// AI Gateway — reverse proxy to OpenRouter that injects the single global key.
// Each tenant's Instatic points its OpenRouter base URL at:
//   http://127.0.0.1:<cp>/ai/<signed-tenant-token>/v1
// The real key lives ONLY here; it is never stored in a tenant instance.
import { Readable } from 'node:stream';
import { getSecrets } from '../registry/settings.mjs';
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

  const secrets = await getSecrets();
  if (!secrets.openrouterKey) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('AI not configured'); }

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRawBody(req);
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
  res.writeHead(upstream.status, headers);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res); // streams SSE token-by-token
  } else {
    res.end();
  }
}
