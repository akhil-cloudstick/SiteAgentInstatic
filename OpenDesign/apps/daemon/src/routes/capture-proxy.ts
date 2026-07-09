import type { Express } from 'express';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const TIMEOUT_MS = 10_000;

// Block loopback / private / link-local / reserved hosts so the capture proxy
// cannot be turned into an SSRF vector against the local network. This is a
// hostname-literal check; it does not resolve DNS, so a public name that
// resolves to a private IP is not caught — acceptable for a localhost-bound
// single-operator daemon, but do not widen this route's exposure without
// adding resolved-IP validation.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true; // IPv6 ULA / link-local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

// GET /api/capture-proxy?url=<encoded external image url>
// Fetches an external image server-side and returns its bytes same-origin, so
// the screenshot bridge can inline it as a data: URI. That is the only reliable
// way to keep the SVG-foreignObject capture canvas untainted for pages that use
// cross-origin images (e.g. Unsplash), because the foreignObject is rendered
// from a data: URL whose opaque origin taints even same-origin subresources.
export function registerCaptureProxyRoute(app: Express): void {
  app.get('/api/capture-proxy', async (req, res) => {
    // The srcDoc preview iframe is sandboxed without allow-same-origin, so its
    // fetch to this route is cross-origin (opaque origin). Allow it to read the
    // bytes; it is a no-credentials simple GET, so `*` is safe and no preflight
    // is involved.
    res.setHeader('Access-Control-Allow-Origin', '*');
    const raw = typeof req.query.url === 'string'
      ? req.query.url
      : Array.isArray(req.query.url) && typeof req.query.url[0] === 'string'
        ? req.query.url[0]
        : '';
    if (!raw) return res.status(400).json({ error: 'missing url query parameter' });

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'invalid url' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return res.status(400).json({ error: 'only http(s) urls are supported' });
    }
    if (isBlockedHost(target.hostname)) {
      return res.status(403).json({ error: 'host not allowed' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const upstream = await fetch(target.href, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'OpenDesign-capture-proxy' },
      });
      if (!upstream.ok) return res.status(502).json({ error: `upstream responded ${upstream.status}` });
      const contentType = upstream.headers.get('content-type') || '';
      if (!/^image\//i.test(contentType)) return res.status(415).json({ error: 'resource is not an image' });
      const declaredLength = Number(upstream.headers.get('content-length') || '0');
      if (declaredLength && declaredLength > MAX_BYTES) return res.status(413).json({ error: 'image too large' });

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) return res.status(413).json({ error: 'image too large' });

      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buf);
    } catch (err) {
      if (controller.signal.aborted) return res.status(504).json({ error: 'upstream timeout' });
      return res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      clearTimeout(timer);
    }
  });
}
