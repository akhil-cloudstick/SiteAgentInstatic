// R14: the console requires a signed-in administrator. Every page and endpoint
// except the sign-in page itself asks the control plane who the session
// belongs to; no answer (signed out, expired, disabled, or the control plane is
// down) sends the browser to sign in. The control plane checks the session
// again on every call, so this is the front door, not the only lock.
import { defineMiddleware } from 'astro:middleware';
import { basePath, consoleOriginAllowed, cpLoad, safeNext } from './lib/cp';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const base = basePath();
  const path = ctx.url.pathname;

  // E7: refuse a cross-origin state change before anything else looks at the
  // session. Gated here rather than per page for the same reason the admin
  // check is — nine handlers carry state-changing intents (act-as, remove and
  // expose among them) and any one of them could forget.
  //
  // Ahead of the auth lookup deliberately: a forged request must be refused on
  // its origin, not answered with a redirect to sign-in that reveals whether a
  // session existed. It also means the refusal costs no control-plane call.
  if (STATE_CHANGING.has(ctx.request.method) && !consoleOriginAllowed(ctx.request)) {
    return new Response('Forbidden: invalid origin', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  // Signing in, signing out, and an invited administrator setting a password
  // are the only pages reachable without a session.
  if (path === `${base}login` || path === `${base}logout` || path === `${base}accept`) return next();

  let admin = null;
  try {
    // cpLoad, not cpFetch: the layout needs this same answer for the brand and
    // for any open act-as grant, and one request should not ask twice.
    const r = await cpLoad(ctx.cookies, '/api/admin/session');
    if (r.ok) admin = r.body.admin ?? null;
  } catch {
    admin = null; // cannot verify: fail closed
  }
  if (!admin) {
    const back = safeNext(path + ctx.url.search);
    return ctx.redirect(`${base}login?next=${encodeURIComponent(back)}`, 303);
  }
  ctx.locals.admin = admin;
  const level = admin.scope?.level;
  const is = (page: string) => path === `${base}${page}` || path === `${base}${page}/`;
  // The landing page follows the setup order: administrators above a single
  // Business start at Organisation; a Business administrator starts at its
  // Projects.
  if (path === base || path === base.replace(/\/$/, '')) {
    return ctx.redirect(`${base}${level === 'business' ? 'projects' : 'org'}`, 302);
  }
  // Organisation is for administrators above a single Business.
  if (is('org') && level === 'business') return ctx.redirect(`${base}projects`, 303);
  // Platform-wide configuration is for platform administrators; the API
  // refuses the rest anyway, so send them somewhere useful instead.
  if (is('settings') && level !== 'platform') return ctx.redirect(`${base}projects`, 303);
  return next();
});
