// Serve the operator-facing MCP guide at /operator/mcp/documentation.
//
// The page is a plain HTML file in `docHTML/` at the repo root, deliberately
// kept out of the Astro console: it is documentation, not an app screen, and an
// operator should be able to open, print or hand it around without the console
// running a build. The control-plane serves it directly, ahead of the gateway
// proxy that would otherwise send every /operator/* path to Astro.
//
// Read fresh on each request rather than cached at boot, so editing the file
// shows up on refresh with no restart.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Operator/control-plane/mcp -> repo root -> docHTML
const DOC_PATH = resolve(HERE, '..', '..', '..', 'docHTML', 'connect-an-ai-agent.html');

export const MCP_DOC_PATH = '/operator/mcp/documentation';

function plain(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

/** Returns true when this request was claimed. */
export async function serveMcpDocumentation(req, res, method, path) {
  // Tolerate the trailing slash — an operator typing the URL by hand should not
  // land on the console's 404.
  if (path !== MCP_DOC_PATH && path !== `${MCP_DOC_PATH}/`) return false;
  if (method !== 'GET' && method !== 'HEAD') {
    plain(res, 405, 'Method not allowed');
    return true;
  }

  let html;
  try {
    html = await readFile(DOC_PATH, 'utf8');
  } catch {
    plain(res, 404, `MCP documentation not found. Expected it at ${DOC_PATH}`);
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  if (method === 'HEAD') return res.end(), true;
  res.end(html);
  return true;
}
