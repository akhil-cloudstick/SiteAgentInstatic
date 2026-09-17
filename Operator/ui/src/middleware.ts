// R14: the console requires a signed-in administrator. Every page and endpoint
// except the sign-in page itself asks the control plane who the session
// belongs to; no answer (signed out, expired, disabled, or the control plane is
// down) sends the browser to sign in. The control plane checks the session
// again on every call, so this is the front door, not the only lock.
import { defineMiddleware } from 'astro:middleware';
import { basePath, cpFetch, safeNext } from './lib/cp';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const base = basePath();
  const path = ctx.url.pathname;
  if (path === `${base}login` || path === `${base}logout`) return next();

  let admin = null;
  try {
    const r = await cpFetch(ctx.cookies, '/api/admin/session');
    if (r.ok) admin = (await r.json()).admin ?? null;
  } catch {
    admin = null; // cannot verify: fail closed
  }
  if (!admin) {
    const back = safeNext(path + ctx.url.search);
    return ctx.redirect(`${base}login?next=${encodeURIComponent(back)}`, 303);
  }
  ctx.locals.admin = admin;
  return next();
});
