import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createDbClient, type DbClient } from '../../../server/db'
import { runMigrations } from '../../../server/db/runMigrations'

export interface TestDb {
  db: DbClient
  cleanup: () => Promise<void>
}

/**
 * Create a fresh DB for tests. Defaults to an isolated temp-file SQLite DB
 * with all migrations applied. Each call produces a unique, independent DB.
 *
 * Set `DB=postgres TEST_POSTGRES_URL=postgres://...` to run against a real
 * Postgres instance instead. The helper supports that mode at the type level;
 * connection-pool teardown is left to process exit, since the Postgres client
 * does not implement the optional `close()` and nothing on disk needs freeing.
 *
 * @example
 * const { db, cleanup } = await createTestDb()
 * try {
 *   // use db
 * } finally {
 *   await cleanup()
 * }
 */
export async function createTestDb(): Promise<TestDb> {
  if (process.env['DB'] === 'postgres') {
    const url = process.env['TEST_POSTGRES_URL']
    if (!url) throw new Error('TEST_POSTGRES_URL must be set when DB=postgres')
    const { db, migrations } = createDbClient(url)
    await runMigrations(db, migrations)
    return {
      db,
      cleanup: async () => {
        // TODO: extend DbClient with a close() method to properly terminate the
        // Postgres connection pool. For now the process-level teardown is enough
        // for the opt-in PG test mode.
      },
    }
  }

  // Default: SQLite at a unique per-test temp file. createDbClient creates the
  // parent directory automatically via mkdirSync, so no pre-creation needed.
  const tmpFile = path.join(os.tmpdir(), `cms-test-${crypto.randomUUID()}`, 'test.db')
  const { db, migrations } = createDbClient(`sqlite:${tmpFile}`)
  await runMigrations(db, migrations)

  return {
    db,
    cleanup: async () => {
      // Close BEFORE removing. Windows refuses to delete a file with an open
      // handle, so leaving the connection open failed teardown on every case in
      // a file — the identical code being harmless on macOS and Linux, where an
      // open file can be unlinked.
      db.close?.()
      // Still tolerant of a failed removal. A leaked temp directory is a
      // housekeeping matter the OS eventually resolves; a throw here fails a
      // test whose assertions all passed, which reports a product bug that does
      // not exist and hides any real failure underneath it.
      try {
        await fs.rm(path.dirname(tmpFile), { recursive: true, force: true })
      } catch {
        // ignore — see above
      }
    },
  }
}
