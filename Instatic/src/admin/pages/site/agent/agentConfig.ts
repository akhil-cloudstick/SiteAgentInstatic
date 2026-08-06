/**
 * Site-editor agent network configuration.
 *
 * As of Phase 3 the site editor talks to the new AI runtime at
 * `/cms/api/ai/chat/site` (provider-agnostic, multi-driver). The browser
 * tool results are posted through the shared admin AI bridge API.
 *
 * Endpoints live under `/cms/api/` so the session cookie scoped to
 * `Path=/cms` is sent by the browser. Outside `/cms/`, the cookie
 * wouldn't be carried and the `requireCapability('ai.chat' /
 * 'ai.tools.write')` gates would 401 every request.
 */

/** Per-scope defaults endpoint — read at panel open to discover the active
    credential + model for new conversations. */
export const AI_DEFAULTS_PATH = '/cms/api/ai/defaults' as const

/** Conversations endpoint root — POST to create, GET list with `?scope=site`. */
export const AI_CONVERSATIONS_PATH = '/cms/api/ai/conversations' as const
