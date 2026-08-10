/**
 * Product Hub context read-back.
 *
 *   GET /cms/api/cms/hub-context
 *
 * Returns the authorized scope the current session was opened with, or
 * `{ hubContext: null }` when there is none. The admin shell's Product Hub
 * header row calls this once per session to decide whether to render the
 * role-scoped Hub navigation and the `Back to Product Hub` return affordance.
 *
 * `null` is a success, not an error: a plain self-hosted install has no Hub in
 * front of it, and the header degrades to logo + context label + utilities. The
 * shared-header contract forbids inventing a default client or project to fill
 * the gap, so this endpoint never synthesises scope it wasn't handed.
 *
 * Self-targeted and read-only, so it needs authentication but no capability —
 * the same posture as `/me`. It reports the scope the caller already arrived
 * with; it cannot widen it.
 */
import type { DbClient } from '../../db/client'
import { getSessionHash, requireAuthenticatedUser } from '../../auth/authz'
import { findSessionHubContext } from '../../auth/sessions'
import { jsonResponse, methodNotAllowed } from '../../http'
import { CMS_API_PREFIX } from './shared'

export async function handleHubContextRoutes(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/hub-context`) return null
  if (req.method !== 'GET') return methodNotAllowed()

  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user

  const sessionHash = await getSessionHash(req)
  if (!sessionHash) return jsonResponse({ hubContext: null })

  return jsonResponse({ hubContext: await findSessionHubContext(db, sessionHash) })
}
