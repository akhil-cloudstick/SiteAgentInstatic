// Shared console helpers for the levels (Operator → Business → Project) and a
// project's people (Phase 1).
import type { AstroCookies } from 'astro';
import { INVITE_FLASH_COOKIE, cookiePath, cpLoad, sessionCookieOptions } from './cp';

/** The CMS's four roles, as the console names them (PRD: publisher / author). */
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Publisher',
  client: 'Author',
  member: 'Viewer',
};

export const ROLE_HINTS: Record<string, string> = {
  admin: 'Edits and publishes',
  client: 'Edits content, cannot publish',
  member: 'Can sign in and view',
};

export const INVITABLE_ROLES = ['admin', 'client', 'member'];

export type Scope = { level: 'platform' | 'operator' | 'business'; operatorId: string | null; businessId: string | null };

/**
 * A link shown once: an invite (person or administrator) rides a short-lived
 * HttpOnly cookie across the post-redirect-get, never the registry (NEW-1).
 */
export type OnceLink = { kind: 'person' | 'admin' | 'owner'; label: string; url: string; slug?: string };

export function flashLink(cookies: AstroCookies, request: Request, link: OnceLink): void {
  if (!link.url) return;
  cookies.set(INVITE_FLASH_COOKIE, link, sessionCookieOptions(request, 600));
}

export function takeLink(cookies: AstroCookies, keep = false): OnceLink | null {
  let link: OnceLink | null = null;
  try { link = (cookies.get(INVITE_FLASH_COOKIE)?.json() as OnceLink) ?? null; } catch { link = null; }
  if (link && !keep) cookies.delete(INVITE_FLASH_COOKIE, { path: cookiePath() });
  return link;
}

/** JSON body of a control-plane response, throwing its error message when not ok. */
export async function okJson(res: Response, fallback: string): Promise<any> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || `${fallback} (${res.status})`);
  return j;
}

/** A control-plane listing, shared across this request, error message included. */
export async function cpGet(cookies: AstroCookies, path: string, fallback: string): Promise<any> {
  const { ok, status, body } = await cpLoad(cookies, path);
  if (!ok || body.ok === false) throw new Error(body.error || `${fallback} (${status})`);
  return body;
}
