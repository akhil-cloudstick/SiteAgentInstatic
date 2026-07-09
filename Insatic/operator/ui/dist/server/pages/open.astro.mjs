export { renderers } from '../renderers.mjs';

const CP = "http://127.0.0.1:4400";
const PUBLIC_TENANT_URL = (process.env.TEST_FUNNEL_ORIGIN || "https://siteagent.tailbbb0d2.ts.net:10000") + "/admin";
const GET = async ({ url }) => {
  const slug = url.searchParams.get("slug") || "";
  if (!/^[a-z0-9-]+$/.test(slug)) return new Response("bad slug", { status: 400 });
  try {
    const r = await fetch(`${CP}/api/tenants/${slug}/expose`, { method: "POST" });
    if (!r.ok) {
      const msg = await r.text().catch(() => "");
      return new Response(`Could not publish tenant "${slug}": ${msg || r.status}`, { status: 502 });
    }
  } catch (e) {
    return new Response(`Control plane unreachable: ${e.message}`, { status: 502 });
  }
  return new Response(null, { status: 302, headers: { Location: PUBLIC_TENANT_URL } });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  GET
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
