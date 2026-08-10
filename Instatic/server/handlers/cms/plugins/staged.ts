/**
 * Staged plugin packages — upload-now, approve-later.
 *
 *   POST   /cms/api/cms/plugins/:id/staged   — stage an inspected package
 *   DELETE /cms/api/cms/plugins/:id/staged   — discard it
 *
 * Staging is deliberately NOT an install: no code runs, no permission is
 * granted, no plugin row is touched. It records that a package was uploaded and
 * passed inspection, so the operator who approves it does not have to be the
 * same person, in the same tab, in the same session as the one who uploaded it.
 * Approval still goes through `POST /plugins/package` with its own
 * `plugins.install` capability and step-up.
 *
 * Because staging holds bytes but grants nothing, it carries the install
 * capability (only someone who could install should be able to park a package
 * on the host) but no step-up: the step-up belongs on the act that runs code.
 */
import type { DbClient } from '../../../db/client'
import type { AuthUser } from '../../../repositories/users'
import {
  deleteStagedPackage,
  upsertStagedPackage,
} from '../../../repositories/pluginStagedPackages'
import {
  removeStagedPackage,
  stagedRelativePath,
  writeStagedPackage,
} from '../../../plugins/stagedStorage'
import { getInstalledPlugin } from '../../../repositories/plugins'
import { readPluginPackage } from '../../../plugins/package'
import { readPluginPackageForm } from './shared'
import { badRequest, jsonResponse, methodNotAllowed } from '../../../http'
import { type CmsHandlerOptions } from '../shared'
import { getErrorMessage } from '@core/utils/errorMessage'

/**
 * Stage an uploaded package. The multipart body is the same shape the install
 * endpoint accepts, and it goes through the same read + parse + sandbox-scan
 * path — a package that would be refused at install is refused here too, rather
 * than sitting on disk waiting to fail later.
 */
export async function handleStagePackage(
  req: Request,
  db: DbClient,
  options: CmsHandlerOptions,
  user: AuthUser,
  pluginId: string,
): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()
  if (!options.uploadsDir) {
    return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })
  }

  const { file } = await readPluginPackageForm(req)
  if (!file) return badRequest('Missing plugin package')

  // Same read + manifest-parse + sandbox-scan path the install endpoint uses.
  // A package that would be refused at install is refused here, rather than
  // sitting on disk waiting to fail at approval time.
  let manifest
  try {
    manifest = (await readPluginPackage(file)).manifest
  } catch (err) {
    return badRequest(getErrorMessage(err, 'Invalid plugin package'))
  }

  if (manifest.id !== pluginId) {
    return badRequest(
      `Package declares plugin id "${manifest.id}" but was staged under "${pluginId}".`,
    )
  }

  const existing = await getInstalledPlugin(db, pluginId)
  const fromVersion = existing?.kind === 'ok' ? existing.plugin.version : null

  const bytes = new Uint8Array(await file.arrayBuffer())
  const relativePath = stagedRelativePath(pluginId, file.name)
  try {
    await writeStagedPackage(options.uploadsDir, relativePath, bytes)
  } catch (err) {
    console.error(`[plugin:${pluginId}] could not write staged package:`, err)
    return jsonResponse({ error: 'Could not store the uploaded package' }, { status: 500 })
  }

  await upsertStagedPackage(db, {
    pluginId,
    fileName: file.name,
    fileSize: bytes.byteLength,
    storagePath: relativePath,
    manifest,
    fromVersion,
    uploadedBy: user.id,
  })

  return jsonResponse({ ok: true })
}

/**
 * Discard a staged package — the row and its bytes. Idempotent: discarding
 * something that was never staged succeeds, so a client that lost track of
 * state can always clean up.
 */
export async function handleDiscardStagedPackage(
  _req: Request,
  db: DbClient,
  options: CmsHandlerOptions,
  pluginId: string,
): Promise<Response> {
  await deleteStagedPackage(db, pluginId)
  // The row is the source of truth for "something is staged"; the bytes are
  // only reachable through it. With no uploads dir configured there is nothing
  // on disk to remove, and dropping the row is still the right outcome.
  if (options.uploadsDir) {
    await removeStagedPackage(options.uploadsDir, pluginId)
  }
  return jsonResponse({ ok: true })
}

/**
 * Drop any staged package for a plugin. Called from the install and uninstall
 * paths — an approved package is no longer waiting, and a removed plugin's
 * pending update is meaningless. Never throws: a failed sweep must not turn a
 * successful install or uninstall into an error.
 */
export async function sweepStagedPackage(
  db: DbClient,
  uploadsDir: string,
  pluginId: string,
): Promise<void> {
  try {
    await deleteStagedPackage(db, pluginId)
    await removeStagedPackage(uploadsDir, pluginId)
  } catch (err) {
    console.error(`[plugin:${pluginId}] could not sweep staged package:`, err)
  }
}
