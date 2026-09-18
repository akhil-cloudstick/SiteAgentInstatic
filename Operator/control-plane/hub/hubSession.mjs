// The hub session: WHO is signed in (a person), not just which project.
//
// Phase 1 (R3): the `sa_hub` cookie names the person (`uid`) and the version of
// their row (`v` = updated_at). A role change, a removal or a password reset
// bumps the row, which ends the session; a cookie from before Phase 1 (project
// only, no person) is treated as signed out.
import { signValue, verifyValue } from '../lib/crypto.mjs';
import { findActivePerson } from '../registry/tenantUsers.mjs';

export const SESSION_COOKIE = 'sa_hub';
export const SESSION_TTL_SEC = 7 * 24 * 3600;
const CHOOSER_TTL_SEC = 5 * 60;

export function parseCookieHeader(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* skip */ }
  });
  return out;
}

export const personVersion = (person) => new Date(person.updated_at).getTime();

export function signHubSession(person) {
  return signValue(
    { sub: person.tenant_slug, kind: 'hub', uid: String(person.id), v: personVersion(person) },
    SESSION_TTL_SEC,
  );
}

/** { slug, uid, v } from a cookie value, or null (bad, expired, or pre-Phase-1). */
export function readHubSession(token) {
  const p = verifyValue(token);
  if (!p || p.kind !== 'hub' || typeof p.sub !== 'string') return null;
  if (typeof p.uid !== 'string' || !/^\d+$/.test(p.uid) || typeof p.v !== 'number') return null;
  return { slug: p.sub, uid: p.uid, v: p.v };
}

export const hubSessionOf = (req) => readHubSession(parseCookieHeader(req.headers.cookie)[SESSION_COOKIE]);

/**
 * The signed-in person, while their row is active, unchanged since sign-in and
 * still in the project the cookie names.
 */
export async function currentPerson(req, find = findActivePerson) {
  const s = hubSessionOf(req);
  if (!s) return null;
  const person = await find(s.uid);
  if (!person || person.tenant_slug !== s.slug || personVersion(person) !== s.v) return null;
  return person;
}

// The gateway asks on every proxied request; a short cache keeps that off the
// database while still ending a removed person's access within seconds.
const CACHE_MS = 30_000;
const cache = new Map(); // `${uid}:${v}` -> { at, person }

export async function currentPersonCached(req, find = findActivePerson, now = Date.now()) {
  const s = hubSessionOf(req);
  if (!s) return null;
  const key = `${s.uid}:${s.v}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.person && hit.person.tenant_slug === s.slug ? hit.person : null;
  const person = await currentPerson(req, find);
  cache.set(key, { at: now, person });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return person;
}

// ---- The project chooser --------------------------------------------------
// One email, several projects: the password was checked once; the chooser
// carries the matching person ids, signed and short-lived, so picking one does
// not re-ask for the password and cannot pick a project that did not match.
export function signChooser(people) {
  return signValue({ kind: 'hub-choose', uids: people.map((p) => String(p.id)) }, CHOOSER_TTL_SEC);
}

export function readChooser(token) {
  const p = verifyValue(token);
  if (!p || p.kind !== 'hub-choose' || !Array.isArray(p.uids)) return null;
  const uids = p.uids.filter((u) => typeof u === 'string' && /^\d+$/.test(u));
  return uids.length ? uids : null;
}
