export interface DbResult<Row = Record<string, unknown>> {
  rows: Row[]
  rowCount: number
}

/** Which SQL dialect the backing database speaks. */
export type Dialect = 'postgres' | 'sqlite'

/**
 * Dialect-aware positional placeholder for `db.unsafe()` SQL strings.
 * Postgres uses `$1, $2, …`; SQLite uses a bare `?`. This is the canonical
 * home for the helper — repositories that splice shared column lists into
 * `db.unsafe()` (see `DATA_ROW_COLUMNS`, `USER_JOINED_COLUMNS`) build their
 * WHERE clauses through it so the same SQL string works on both dialects.
 */
export function placeholder(dialect: Dialect, index: number): string {
  return dialect === 'postgres' ? `$${index}` : '?'
}

/**
 * The shared DB client interface. Used by repositories and handlers.
 * Tagged-template callable returning DbResult, plus:
 *   - .unsafe(...) — execute raw SQL strings (e.g. stored migration blocks)
 *   - .transaction(fn) — runs a callback inside a DB transaction
 *   - .dialect      — which SQL dialect the backing database speaks
 *   - .close?()     — release the underlying handle, where the driver has one
 */
export interface DbClient {
  <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>>
  unsafe<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbResult<Row>>
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>
  readonly dialect: Dialect
  /**
   * Release the underlying database handle.
   *
   * Optional because long-lived server clients never close — the process
   * outlives them, and a `close()` reachable from handler code is a way to
   * take the site down from a request. It exists for callers that create a
   * database, finish with it, and need the file back: tests, one-shot scripts.
   *
   * Windows is the reason it is not merely tidy. An open handle there makes
   * the file undeletable, so a test that removed its temp directory while the
   * connection was still open failed teardown on every case in the file — the
   * same code being harmless on macOS and Linux, where an open file can be
   * unlinked.
   *
   * Idempotent. Using the client after closing it is a programming error.
   */
  close?(): void
}
