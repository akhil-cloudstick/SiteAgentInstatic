/**
 * Managed AI mode — the pieces both the server and the admin UI need.
 *
 * When an operator runs this instance FOR a tenant, the tenant gets exactly one
 * synthetic credential pointing at the operator's AI Gateway. The server mints
 * it (`server/ai/managed.ts`) and the admin picker renders it, so the id has to
 * be shared rather than duplicated on each side.
 */

/** The synthetic credential id used everywhere in managed mode. */
export const MANAGED_AI_CREDENTIAL_ID = 'managed'
