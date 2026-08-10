/**
 * On-disk storage for staged (uploaded-but-unapproved) plugin packages.
 *
 * The bytes live under `uploads/plugins/_staged/<pluginId>/<file>` — inside the
 * plugins tree so existing backup and volume-mount setups already cover them,
 * but under a `_staged` segment that can never collide with a real plugin id
 * (the manifest schema rejects ids containing `/`, and no id starts with `_`).
 *
 * Nothing here is ever executed, imported, or served: a staged package is
 * inert bytes plus a parsed manifest until an operator approves it, at which
 * point the normal install path takes over and this copy is deleted.
 *
 * Every path is re-asserted inside `uploadsDir` after `join` normalises it —
 * the same defense-in-depth the rest of the plugin subsystem applies, so a
 * corrupted stored id cannot turn a cleanup into an arbitrary delete.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertPathWithin } from '../util/pathWithin'

const STAGED_SEGMENT = 'plugins/_staged'

/** Relative path stored on the DB row, resolved against `uploadsDir` on read. */
export function stagedRelativePath(pluginId: string, fileName: string): string {
  // The file name comes from a browser upload. Only its extension carries
  // meaning downstream, so it is reduced to a safe slug rather than trusted —
  // a name like `../../etc/passwd` becomes `.._.._etc_passwd`.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'package.zip'
  return `${STAGED_SEGMENT}/${pluginId}/${safeName}`
}

function resolveStaged(uploadsDir: string, relativePath: string): string {
  const target = join(uploadsDir, relativePath)
  assertPathWithin(uploadsDir, target)
  return target
}

export async function writeStagedPackage(
  uploadsDir: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = resolveStaged(uploadsDir, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

export async function readStagedPackage(
  uploadsDir: string,
  relativePath: string,
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(resolveStaged(uploadsDir, relativePath)))
}

/**
 * Drop a plugin's whole staged directory. Safe to call for a plugin that has
 * nothing staged — `force: true` makes a missing directory a no-op, so uninstall
 * and discard can both call it unconditionally.
 */
export async function removeStagedPackage(uploadsDir: string, pluginId: string): Promise<void> {
  const target = join(uploadsDir, STAGED_SEGMENT, pluginId)
  try {
    assertPathWithin(uploadsDir, target)
  } catch (err) {
    console.error('[plugins] removeStagedPackage refused to delete escaping path:', err)
    return
  }
  await rm(target, { recursive: true, force: true })
}
