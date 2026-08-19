// HTTP entry point for the MCP gateway.
//
//   POST /mcp/<tenant-slug>     the MCP endpoint agents connect to
//   GET  /mcp/<tenant-slug>     405 + a human-readable hint (this transport is
//                               JSON-response Streamable HTTP, not SSE)
//
// One doorway: content, media and design all arrive here under one bearer key,
// and the gateway routes each tool to the right backend behind the scenes.
import { findAgentKeyByToken } from '../registry/mcpAgents.mjs';
import { handleRpcPayload } from './protocol.mjs';

const MAX_BODY_BYTES = 64 * 1024 * 1024; // headroom for a base64 media upload

function send(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function unauthorized(res, message) {
  send(
    res,
    401,
    { jsonrpc: '2.0', id: null, error: { code: -32001, message } },
    { 'www-authenticate': 'Bearer realm="mms-mcp"' },
  );
}

function bearerFrom(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Returns true when this request was claimed. `server.mjs` mounts it ahead of
 * the tenant proxy so `/mcp/*` never reaches a tenant backend.
 */
export async function handleMcpGateway(req, res, method, path) {
  const match = path.match(/^\/mcp\/([a-z0-9-]+)\/?$/);
  if (!match) return false;
  const slug = match[1];

  if (method === 'GET' || method === 'HEAD') {
    send(res, 405, {
      error:
        'This MCP endpoint speaks Streamable HTTP with JSON responses. POST JSON-RPC here with an ' +
        'Authorization: Bearer mmsmcp_… header.',
    });
    return true;
  }
  if (method !== 'POST') {
    send(res, 405, { error: `Method ${method} not allowed` });
    return true;
  }

  const token = bearerFrom(req);
  if (!token) {
    unauthorized(res, 'Missing Authorization: Bearer <agent key>');
    return true;
  }

  const profile = await findAgentKeyByToken(token);
  // Unknown, revoked and expired keys are deliberately indistinguishable.
  if (!profile) {
    unauthorized(res, 'Invalid, revoked, or expired agent key');
    return true;
  }

  // A key is bound to exactly one tenant. Reject rather than silently serving
  // the key's own tenant, so a misconfigured client fails loudly.
  if (profile.tenantSlug !== slug) {
    unauthorized(res, 'This agent key is not valid for that site');
    return true;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : null;
  } catch (err) {
    send(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` },
    });
    return true;
  }
  if (payload === null) {
    send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Empty request body' } });
    return true;
  }

  try {
    const response = await handleRpcPayload(payload, { slug, profile });
    // Notifications produce no response body.
    if (response === null) {
      res.writeHead(202);
      res.end();
      return true;
    }
    send(res, 200, response);
  } catch (err) {
    console.error('[mcp]', err);
    send(res, 500, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: err && err.message ? err.message : 'Internal gateway error' },
    });
  }
  return true;
}
