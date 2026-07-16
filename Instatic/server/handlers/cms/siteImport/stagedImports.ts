/**
 * Short-lived, single-use handoff for a FileMap posted by an external caller
 * (Share to CMS) that needs to reach the tenant's OWN BROWSER so the real
 * "Import Site" wizard (`SiteImportModal.tsx`) can run it — the same
 * analysis+commit code a manual drag-drop import uses, instead of a second
 * server-side reimplementation.
 *
 * Flow: `stageFileMap` (server-to-server POST, e.g. from the OpenDesign
 * daemon) stores the FileMap keyed by an unguessable token and returns it;
 * the caller redirects the tenant's browser (via the existing SSO route) to
 * `/admin/site?importToken=<token>`; the admin app fetches it ONCE
 * (`takeStagedFileMap` burns it on read) to hydrate the wizard.
 *
 * In-memory, per-process — Instatic runs one process per tenant, so this
 * never needs to survive a restart or be shared across instances. A short
 * TTL plus burn-on-read are the security properties, not durability.
 */
import { nanoid } from 'nanoid'
import type { FileMap } from '@core/siteImport'

const TTL_MS = 5 * 60 * 1000 // must outlive the SSO redirect + page load, nothing more

interface StagedEntry {
  fileMap: FileMap
  /** The user who staged it — `takeStagedFileMap` only returns it to the same user. */
  stagedByUserId: string
  expiresAt: number
}

const staged = new Map<string, StagedEntry>()

/** Drop expired entries. Called opportunistically so the map never grows unbounded. */
function sweepExpired(): void {
  const now = Date.now()
  for (const [token, entry] of staged) {
    if (entry.expiresAt <= now) staged.delete(token)
  }
}

/** Stage a FileMap for a one-time browser pickup. Returns the token. */
export function stageFileMap(fileMap: FileMap, stagedByUserId: string): string {
  sweepExpired()
  const token = nanoid(32)
  staged.set(token, { fileMap, stagedByUserId, expiresAt: Date.now() + TTL_MS })
  return token
}

/**
 * Retrieve and BURN a staged FileMap. Returns null if the token is unknown,
 * expired, or already consumed, or if `userId` doesn't match who staged it.
 */
export function takeStagedFileMap(token: string, userId: string): FileMap | null {
  const entry = staged.get(token)
  if (!entry) return null
  staged.delete(token) // single-use regardless of outcome below
  if (entry.expiresAt <= Date.now()) return null
  if (entry.stagedByUserId !== userId) return null
  return entry.fileMap
}
