import type { APIRoute } from 'astro';

// CLIENT-TEST ONLY (see pending.md). The frozen client console links its tenant
// "open" buttons here (only when PUBLIC_CONSOLE=1). This publishes the requested
// tenant on the shared public funnel port and redirects the client's browser to
// it. Only ONE tenant is public at a time — opening another repoints the funnel.
const CP = 'http://127.0.0.1:4400';
const PUBLIC_TENANT_URL =
  (process.env.TEST_FUNNEL_ORIGIN || 'https://siteagent.tailbbb0d2.ts.net:10000') + '/admin';

export const GET: APIRoute = async ({ url }) => {
  const slug = url.searchParams.get('slug') || '';
  if (!/^[a-z0-9-]+$/.test(slug)) return new Response('bad slug', { status: 400 });
  try {
    const r = await fetch(`${CP}/api/tenants/${slug}/expose`, { method: 'POST' });
    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      return new Response(`Could not publish tenant "${slug}": ${msg || r.status}`, { status: 502 });
    }
  } catch (e) {
    return new Response(`Control plane unreachable: ${(e as Error).message}`, { status: 502 });
  }
  return new Response(null, { status: 302, headers: { Location: PUBLIC_TENANT_URL } });
};
