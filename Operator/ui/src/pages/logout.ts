import type { APIRoute } from 'astro';
import { ADMIN_COOKIE, INVITE_FLASH_COOKIE, basePath, cookiePath } from '../lib/cp';

// Sign out of the console. The session is stateless, so ending it here means
// dropping the cookie; resetting the password (npm run admin:create) ends every
// session everywhere.
const signOut: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(ADMIN_COOKIE, { path: cookiePath() });
  cookies.delete(INVITE_FLASH_COOKIE, { path: cookiePath() });
  return redirect(`${basePath()}login`, 303);
};

// POST only. The `GET` export that used to sit here was unused — the shell
// signs out through a hidden `method="POST"` form (ConsoleShell.tsx) — and a
// state-changing GET is reachable from a cross-site `<img src=".../logout">`,
// which would sign an administrator out without their asking. The middleware's
// origin gate covers the POST.
export const POST = signOut;
