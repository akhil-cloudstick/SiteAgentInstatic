/**
 * useHubContext — the Product Hub scope this session was opened with.
 *
 * MMS Design is opened FROM Product Hub, and the shared-header contract
 * requires the route between them to carry the authorized scope so that
 * `Back to Product Hub` returns to the exact surface the user came from.
 *
 * `null` is a legitimate, terminal answer: run the app without a Hub in front
 * of it and there is nowhere to return to. The contract forbids substituting a
 * default client, project or Hub destination, so the header renders its no-Hub
 * shape rather than guessing — the same way MMS-CMS degrades.
 *
 * The scope is read from `window.__mmsHub`, which the gateway injects into the
 * document when a Hub origin is configured. Reading a global rather than
 * fetching keeps this a UI concern: no new endpoint, no daemon change, and
 * nothing to load before the header can paint.
 */
import { useSyncExternalStore } from 'react';
import type { HubContext, HubRole, HubUser } from '@mms/shell';

const HUB_ROLES: readonly HubRole[] = ['operator', 'agency', 'client', 'super-admin'];

declare global {
  interface Window {
    __mmsHub?: unknown;
  }
}

function asScope(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The identified user, or null. A name without initials (or the reverse) is a
 * half-answer: the avatar would have to invent the missing half, so the whole
 * user is dropped and the account control falls back to its anonymous shape.
 */
function parseHubUser(raw: unknown): HubUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const name = asScope(value.name);
  const initials = asScope(value.initials);
  if (!name || !initials) return null;
  return { name, initials: initials.slice(0, 2).toUpperCase() };
}

/**
 * Validates at the boundary. A partially-filled hand-off is not a reason to
 * invent the missing halves — anything short of an origin and a return URL
 * means we have no Hub, and the header says so.
 */
function parseHubContext(raw: unknown): HubContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const hubBaseUrl = asScope(value.hubBaseUrl);
  const returnUrl = asScope(value.returnUrl);
  const role = HUB_ROLES.find((candidate) => candidate === value.role);
  if (!hubBaseUrl || !returnUrl || !role) return null;
  return {
    hubBaseUrl,
    role,
    user: parseHubUser(value.user),
    client: asScope(value.client),
    project: asScope(value.project),
    site: asScope(value.site),
    origin: asScope(value.origin),
    returnUrl,
  };
}

// Resolved once per document: the gateway writes the global before the app
// boots and never changes it mid-session, so re-parsing on every render would
// only churn object identity and re-render the whole shell.
let cached: HubContext | null | undefined;

function snapshot(): HubContext | null {
  if (cached === undefined) {
    cached = typeof window === 'undefined' ? null : parseHubContext(window.__mmsHub);
  }
  return cached;
}

/** Never changes within a session; the subscribe half exists to satisfy the hook. */
function subscribe(): () => void {
  return () => {};
}

export function useHubContext(): HubContext | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Non-React read of the same snapshot, for module-level guards. */
export function getHubContext(): HubContext | null {
  return snapshot();
}

/** Test seam: place a session in a known Hub scope without a gateway. */
export function setHubContextForTests(next: HubContext | null): void {
  cached = next;
}
