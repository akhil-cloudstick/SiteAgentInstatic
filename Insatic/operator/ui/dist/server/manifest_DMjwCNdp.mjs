import 'piccolore';
import { q as decodeKey } from './chunks/astro/server_D03FvIM3.mjs';
import 'clsx';
import { N as NOOP_MIDDLEWARE_FN } from './chunks/astro-designed-error-pages_CxJb1rnx.mjs';
import 'es-module-lexer';

function sanitizeParams(params) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")];
      }
      return [key, value];
    })
  );
}
function getParameter(part, params) {
  if (part.spread) {
    return params[part.content.slice(3)] || "";
  }
  if (part.dynamic) {
    if (!params[part.content]) {
      throw new TypeError(`Missing parameter: ${part.content}`);
    }
    return params[part.content];
  }
  return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]");
}
function getSegment(segment, params) {
  const segmentPath = segment.map((part) => getParameter(part, params)).join("");
  return segmentPath ? "/" + segmentPath : "";
}
function getRouteGenerator(segments, addTrailingSlash) {
  return (params) => {
    const sanitizedParams = sanitizeParams(params);
    let trailing = "";
    if (addTrailingSlash === "always" && segments.length) {
      trailing = "/";
    }
    const path = segments.map((segment) => getSegment(segment, sanitizedParams)).join("") + trailing;
    return path || "/";
  };
}

function deserializeRouteData(rawRouteData) {
  return {
    route: rawRouteData.route,
    type: rawRouteData.type,
    pattern: new RegExp(rawRouteData.pattern),
    params: rawRouteData.params,
    component: rawRouteData.component,
    generate: getRouteGenerator(rawRouteData.segments, rawRouteData._meta.trailingSlash),
    pathname: rawRouteData.pathname || void 0,
    segments: rawRouteData.segments,
    prerender: rawRouteData.prerender,
    redirect: rawRouteData.redirect,
    redirectRoute: rawRouteData.redirectRoute ? deserializeRouteData(rawRouteData.redirectRoute) : void 0,
    fallbackRoutes: rawRouteData.fallbackRoutes.map((fallback) => {
      return deserializeRouteData(fallback);
    }),
    isIndex: rawRouteData.isIndex,
    origin: rawRouteData.origin
  };
}

function deserializeManifest(serializedManifest) {
  const routes = [];
  for (const serializedRoute of serializedManifest.routes) {
    routes.push({
      ...serializedRoute,
      routeData: deserializeRouteData(serializedRoute.routeData)
    });
    const route = serializedRoute;
    route.routeData = deserializeRouteData(serializedRoute.routeData);
  }
  const assets = new Set(serializedManifest.assets);
  const componentMetadata = new Map(serializedManifest.componentMetadata);
  const inlinedScripts = new Map(serializedManifest.inlinedScripts);
  const clientDirectives = new Map(serializedManifest.clientDirectives);
  const serverIslandNameMap = new Map(serializedManifest.serverIslandNameMap);
  const key = decodeKey(serializedManifest.key);
  return {
    // in case user middleware exists, this no-op middleware will be reassigned (see plugin-ssr.ts)
    middleware() {
      return { onRequest: NOOP_MIDDLEWARE_FN };
    },
    ...serializedManifest,
    assets,
    componentMetadata,
    inlinedScripts,
    clientDirectives,
    routes,
    serverIslandNameMap,
    key
  };
}

const manifest = deserializeManifest({"hrefRoot":"file:///S:/InstaticSiteAgent/operator/ui/","cacheDir":"file:///S:/InstaticSiteAgent/operator/ui/node_modules/.astro/","outDir":"file:///S:/InstaticSiteAgent/operator/ui/dist/","srcDir":"file:///S:/InstaticSiteAgent/operator/ui/src/","publicDir":"file:///S:/InstaticSiteAgent/operator/ui/public/","buildClientDir":"file:///S:/InstaticSiteAgent/operator/ui/dist/client/","buildServerDir":"file:///S:/InstaticSiteAgent/operator/ui/dist/server/","adapterName":"@astrojs/node","routes":[{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"page","component":"_server-islands.astro","params":["name"],"segments":[[{"content":"_server-islands","dynamic":false,"spread":false}],[{"content":"name","dynamic":true,"spread":false}]],"pattern":"^\\/_server-islands\\/([^/]+?)\\/?$","prerender":false,"isIndex":false,"fallbackRoutes":[],"route":"/_server-islands/[name]","origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"endpoint","isIndex":false,"route":"/_image","pattern":"^\\/_image\\/?$","segments":[[{"content":"_image","dynamic":false,"spread":false}]],"params":[],"component":"node_modules/astro/dist/assets/endpoint/node.js","pathname":"/_image","prerender":false,"fallbackRoutes":[],"origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"route":"/open","isIndex":false,"type":"endpoint","pattern":"^\\/open\\/?$","segments":[[{"content":"open","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/open.ts","pathname":"/open","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/settings.PayTSG7-.css"},{"type":"inline","content":":root{--bg:#0e1216;--panel:#161b22;--panel2:#1b2330;--ink:#e9eef3;--mut:#8b949e;--line:#2a313a;--accent:#58a6ff;--ok:#2ea043;--warn:#d29922;--bad:#e5534b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}a{color:var(--accent);text-decoration:none}header{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:22px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--panel)}.brand{font-weight:700;font-size:16px;color:var(--ink)}nav{display:flex;gap:16px}nav a{color:var(--mut)}nav a.active,nav a:hover{color:var(--ink)}main{max-width:1000px;margin:0 auto;padding:28px 24px 80px}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 22px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin:0 0 18px}label{display:block;font-size:12px;color:var(--mut);margin:12px 0 4px}input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:9px 11px;font:inherit}button{background:var(--accent);color:#04121f;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}button.ghost{background:var(--panel2);color:var(--ink);border:1px solid var(--line)}button.danger{background:transparent;color:var(--bad);border:1px solid #5a2a2a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.pill{font-size:11px;border-radius:20px;padding:1px 9px;border:1px solid var(--line)}.pill.ok{color:var(--ok);border-color:#1f4a2a}.pill.bad{color:var(--bad);border-color:#5a2a2a}.pill.warn{color:var(--warn);border-color:#5a4a1f}.row-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.row-actions form{display:inline}.hint{color:var(--mut);font-size:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.banner{padding:10px 12px;border-radius:8px;margin-bottom:16px;font-size:13px}.banner.ok{background:#13261b;border:1px solid #1f4a2a;color:#9be9b0}.banner.err{background:#2a1416;border:1px solid #5a2a2a;color:#f3a0a8}code{background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:0 5px}\n"}],"routeData":{"route":"/settings","isIndex":false,"type":"page","pattern":"^\\/settings\\/?$","segments":[[{"content":"settings","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/settings.astro","pathname":"/settings","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"inline","content":"dialog.modal{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:12px;padding:20px;max-width:420px;width:calc(100% - 40px)}dialog.modal.wide{max-width:560px}dialog.modal::backdrop{background:#0000008c}.bar{position:relative;height:8px;background:var(--panel2);border:1px solid var(--line);border-radius:20px;overflow:hidden}.bar .fill{height:100%;background:var(--accent);transition:width .4s ease}.bar.indet:after{content:\"\";position:absolute;top:0;left:0;height:100%;width:40%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:sheen 1.1s linear infinite}@keyframes sheen{0%{transform:translate(-100%)}to{transform:translate(350%)}}.prog{color:var(--mut);font-size:13px;margin:10px 0 0}.dots:after{content:\"\";animation:dots 1.2s steps(4,end) infinite}@keyframes dots{0%{content:\"\"}25%{content:\".\"}50%{content:\"..\"}75%{content:\"...\"}to{content:\"\"}}.spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);display:inline-block;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.dlg-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}dl.kv{display:grid;grid-template-columns:130px 1fr;gap:8px 14px;margin:0}dl.kv dt{color:var(--mut);font-size:12px}dl.kv dd{margin:0;font-size:13px;word-break:break-all}.err-text{color:var(--bad)}label.check{display:flex;align-items:center;gap:8px;color:var(--ink);font-size:13px;margin:6px 0 0;cursor:pointer}label.check input[type=checkbox]{width:auto;margin:0}button.iconbtn{background:transparent;border:0;padding:2px;color:var(--mut);cursor:pointer;display:inline-flex;align-items:center;line-height:0}button.iconbtn:hover{color:var(--ink)}button.iconbtn.ok{color:var(--ok)}\n:root{--bg:#0e1216;--panel:#161b22;--panel2:#1b2330;--ink:#e9eef3;--mut:#8b949e;--line:#2a313a;--accent:#58a6ff;--ok:#2ea043;--warn:#d29922;--bad:#e5534b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}a{color:var(--accent);text-decoration:none}header{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:22px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--panel)}.brand{font-weight:700;font-size:16px;color:var(--ink)}nav{display:flex;gap:16px}nav a{color:var(--mut)}nav a.active,nav a:hover{color:var(--ink)}main{max-width:1000px;margin:0 auto;padding:28px 24px 80px}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 22px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin:0 0 18px}label{display:block;font-size:12px;color:var(--mut);margin:12px 0 4px}input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:9px 11px;font:inherit}button{background:var(--accent);color:#04121f;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}button.ghost{background:var(--panel2);color:var(--ink);border:1px solid var(--line)}button.danger{background:transparent;color:var(--bad);border:1px solid #5a2a2a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.pill{font-size:11px;border-radius:20px;padding:1px 9px;border:1px solid var(--line)}.pill.ok{color:var(--ok);border-color:#1f4a2a}.pill.bad{color:var(--bad);border-color:#5a2a2a}.pill.warn{color:var(--warn);border-color:#5a4a1f}.row-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.row-actions form{display:inline}.hint{color:var(--mut);font-size:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.banner{padding:10px 12px;border-radius:8px;margin-bottom:16px;font-size:13px}.banner.ok{background:#13261b;border:1px solid #1f4a2a;color:#9be9b0}.banner.err{background:#2a1416;border:1px solid #5a2a2a;color:#f3a0a8}code{background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:0 5px}\n"}],"routeData":{"route":"/","isIndex":true,"type":"page","pattern":"^\\/$","segments":[],"params":[],"component":"src/pages/index.astro","pathname":"/","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}}],"base":"/","trailingSlash":"ignore","compressHTML":true,"componentMetadata":[["S:/InstaticSiteAgent/operator/ui/src/pages/index.astro",{"propagation":"none","containsHead":true}],["S:/InstaticSiteAgent/operator/ui/src/pages/settings.astro",{"propagation":"none","containsHead":true}]],"renderers":[],"clientDirectives":[["idle","(()=>{var l=(n,t)=>{let i=async()=>{await(await n())()},e=typeof t.value==\"object\"?t.value:void 0,s={timeout:e==null?void 0:e.timeout};\"requestIdleCallback\"in window?window.requestIdleCallback(i,s):setTimeout(i,s.timeout||200)};(self.Astro||(self.Astro={})).idle=l;window.dispatchEvent(new Event(\"astro:idle\"));})();"],["load","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).load=e;window.dispatchEvent(new Event(\"astro:load\"));})();"],["media","(()=>{var n=(a,t)=>{let i=async()=>{await(await a())()};if(t.value){let e=matchMedia(t.value);e.matches?i():e.addEventListener(\"change\",i,{once:!0})}};(self.Astro||(self.Astro={})).media=n;window.dispatchEvent(new Event(\"astro:media\"));})();"],["only","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).only=e;window.dispatchEvent(new Event(\"astro:only\"));})();"],["visible","(()=>{var a=(s,i,o)=>{let r=async()=>{await(await s())()},t=typeof i.value==\"object\"?i.value:void 0,c={rootMargin:t==null?void 0:t.rootMargin},n=new IntersectionObserver(e=>{for(let l of e)if(l.isIntersecting){n.disconnect(),r();break}},c);for(let e of o.children)n.observe(e)};(self.Astro||(self.Astro={})).visible=a;window.dispatchEvent(new Event(\"astro:visible\"));})();"]],"entryModules":{"\u0000@astro-page:src/pages/index@_@astro":"pages/index.astro.mjs","\u0000@astro-page:src/pages/open@_@ts":"pages/open.astro.mjs","\u0000@astro-page:src/pages/settings@_@astro":"pages/settings.astro.mjs","\u0000@astrojs-ssr-virtual-entry":"entry.mjs","\u0000@astro-renderers":"renderers.mjs","\u0000noop-middleware":"_noop-middleware.mjs","\u0000virtual:astro:actions/noop-entrypoint":"noop-entrypoint.mjs","\u0000@astro-page:node_modules/astro/dist/assets/endpoint/node@_@js":"pages/_image.astro.mjs","\u0000@astrojs-ssr-adapter":"_@astrojs-ssr-adapter.mjs","\u0000@astrojs-manifest":"manifest_DMjwCNdp.mjs","S:/InstaticSiteAgent/operator/ui/node_modules/astro/dist/assets/services/sharp.js":"chunks/sharp_Bjjperdd.mjs","S:/InstaticSiteAgent/operator/ui/node_modules/unstorage/drivers/fs-lite.mjs":"chunks/fs-lite_COtHaKzy.mjs","astro:scripts/before-hydration.js":""},"inlinedScripts":[],"assets":["/_astro/settings.PayTSG7-.css","/favicon.svg"],"buildFormat":"directory","checkOrigin":false,"allowedDomains":[],"actionBodySizeLimit":1048576,"serverIslandNameMap":[],"key":"eBDERPXQ9PBfAJo6CVSj+w3YLY086kYBDvoExuYA9qk=","sessionConfig":{"driver":"fs-lite","options":{"base":"S:\\InstaticSiteAgent\\operator\\ui\\node_modules\\.astro\\sessions"}}});
if (manifest.sessionConfig) manifest.sessionConfig.driverModule = () => import('./chunks/fs-lite_COtHaKzy.mjs');

export { manifest };
