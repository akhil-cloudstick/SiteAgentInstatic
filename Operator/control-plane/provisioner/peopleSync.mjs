// Tell a project's CMS who its people are and what each may do (Phase 1).
//
// A person's CMS account is created on their first sign-in, with the role their
// hand-off carries. A later change — a new role, a removal — must reach the CMS
// even if that person never signs in again, or a removed person's open CMS
// session would keep working. So after every people change, and whenever a
// project's CMS starts, the control plane sends the full list; the CMS updates
// roles and suspends anyone no longer on it.
//
// Best effort by design: a project that is down is synced when it next starts.
import { getTenant } from '../registry/tenants.mjs';
import { peopleForSync } from '../registry/tenantUsers.mjs';
import { signForTenant } from '../lib/crypto.mjs';
import { waitPortOpen } from '../lib/ports.mjs';

export async function syncPeople(slug, { waitMs = 0 } = {}) {
  try {
    const t = await getTenant(slug);
    if (!t?.port || t.tier === 'lite' || t.status === 'removed') return { ok: true, skipped: true };
    if (waitMs && !(await waitPortOpen(t.port, waitMs))) return { ok: false, error: 'CMS not listening' };
    const people = await peopleForSync(slug);
    // The list rides inside the signed token, so the CMS acts only on exactly
    // what we sent, for exactly this project.
    const token = signForTenant(slug, { kind: 'people-sync', people }, 60);
    const res = await fetch(`http://127.0.0.1:${t.port}/cms/api/cms/sso/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[people-sync] ${slug}: HTTP ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, ...(await res.json().catch(() => ({}))) };
  } catch (e) {
    console.error(`[people-sync] ${slug}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Fire and forget, for callers that must not wait on a CMS. An open port is
 * not yet a serving CMS, so a failed attempt is retried a few times.
 */
export function syncPeopleSoon(slug, waitMs = 120_000) {
  (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await syncPeople(slug, { waitMs });
      if (r.ok) return;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  })().catch(() => {});
}
