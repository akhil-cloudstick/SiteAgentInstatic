/**
 * Sign out of the MMS hub from inside MMS Design.
 *
 * Ending the OD session alone is not a sign-out. Every tenant is routed by the
 * hub's `sa_hub` cookie, and the daemon bounces an unauthenticated page load to
 * `/sso/design`, where the hub still recognises that cookie and hands back a
 * fresh session. So the only navigation that actually signs a user out is the
 * hub's own `/logout`, which expires all three cookies (`sa_hub`, `od_session`,
 * `instatic_admin_session`) with their correct paths.
 */

/**
 * Browser keys either product writes, swept by PREFIX so keys added later are
 * covered without anyone remembering to update this list.
 *
 * They all have to go, because every tenant is served from the SAME origin:
 * the hub cookie swaps the backend, never the browser's storage, and not one of
 * these keys is namespaced by tenant. Left behind, tenant A's last composer
 * prompt, workspace selection and view state reappear for tenant B.
 */
const TENANT_SCOPED_STORAGE_PREFIXES = [
  'open-design:',
  'od:',
  'od.',
  'instatic-',
  'spotlight:',
];

/** Best-effort: storage can throw, and that must never block the sign-out. */
export function clearTenantScopedStorage(): void {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (!store) continue;
      // Collected before removing: mutating while walking the live key list skips entries.
      const doomed = Object.keys(store).filter((key) =>
        TENANT_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
      );
      for (const key of doomed) store.removeItem(key);
    } catch {
      // Ignore — see above.
    }
  }
}

/** Purge local state, then hand off to the hub's logout. */
export function signOutOfHub(hubBaseUrl: string): void {
  clearTenantScopedStorage();
  // Hard navigation on purpose: it discards the whole SPA along with anything
  // still held in module memory.
  globalThis.location.assign(`${hubBaseUrl}/logout`);
}
