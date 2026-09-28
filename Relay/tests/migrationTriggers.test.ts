/**
 * The append-only triggers, run against a real database (security class E9).
 *
 * Until now they never had been. Every other test in this suite uses the
 * in-memory store, which enforces append-only in TypeScript — so the SQL that
 * actually protects the deployed relay had never once been executed by a test.
 * A store that is append-only because the code is careful is a different
 * guarantee from one that is append-only because the database refuses, and E9
 * is about the second: the record must resist whoever holds the database
 * console, not merely whoever calls the API.
 *
 * D1 is SQLite, so the migrations are run here verbatim against `bun:sqlite`.
 * No mocks and no re-statement of the rules: if a trigger is dropped from a
 * migration, or its WHEN clause stops covering a column, these fail.
 *
 * It fails rather than skips when the engine is missing, which is the rule the
 * board sets for this class — a check that cannot run must never look like one
 * that ran and found nothing.
 */
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS = resolve(import.meta.dir, '..', 'migrations')

/** A fresh database with every migration applied, in filename order. */
function migrated(): Database {
  const db = new Database(':memory:')
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  // If the folder is empty the suite would pass by doing nothing, which is the
  // one outcome a test about a database schema must not have.
  expect(files.length).toBeGreaterThanOrEqual(3)
  for (const file of files) db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'))
  return db
}

/** Run a statement and return the refusal message, or null if it succeeded. */
function refusal(db: Database, sql: string, ...params: unknown[]): string | null {
  try {
    db.query(sql).run(...(params as never[]))
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const now = '2026-09-28T00:00:00.000Z'

function seedTicket(db: Database, id = 'T-000001'): void {
  db.query(
    `INSERT INTO tickets (id, seq, type, title, body, state, created_by, created_at, updated_at, state_since)
     VALUES (?, 1, 'ticket', 'A title', 'A body', 'open', 'builder@example.test', ?, ?, ?)`,
  ).run(id, now, now, now)
}

describe('the migrations apply at all', () => {
  test('every migration runs against a real SQLite engine', () => {
    const db = migrated()
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name)

    // The three record stores this class is about.
    expect(tables).toContain('tickets')
    expect(tables).toContain('approvers')
    expect(tables).toContain('test_properties')
    db.close()
  })

  test('the seq counter row exists, because every write allocates from it', () => {
    const db = migrated()
    const row = db.query<{ value: number }, []>("SELECT value FROM seq WHERE name = 'global'").get()
    expect(row?.value).toBe(0)
    db.close()
  })
})

describe('a ticket', () => {
  test('cannot be deleted', () => {
    const db = migrated()
    seedTicket(db)
    expect(refusal(db, 'DELETE FROM tickets WHERE id = ?', 'T-000001')).toContain('never deleted')
    expect(db.query('SELECT COUNT(*) AS n FROM tickets').get()).toEqual({ n: 1 })
    db.close()
  })

  test('cannot have its identity or text rewritten', () => {
    const db = migrated()
    seedTicket(db)
    // The whole point of the frozen-fields trigger: a ticket's state moves, and
    // nothing else does.
    expect(refusal(db, 'UPDATE tickets SET title = ? WHERE id = ?', 'Something else', 'T-000001')).toBeTruthy()
    expect(refusal(db, 'UPDATE tickets SET body = ? WHERE id = ?', 'Rewritten', 'T-000001')).toBeTruthy()
    expect(refusal(db, 'UPDATE tickets SET id = ? WHERE id = ?', 'T-999999', 'T-000001')).toBeTruthy()
    db.close()
  })

  test('may still move state, which is the one thing that changes', () => {
    const db = migrated()
    seedTicket(db)
    // If this failed the trigger would be too strict, and the relay could not
    // work at all — worth asserting so the rule is pinned from both sides.
    expect(refusal(db, 'UPDATE tickets SET state = ?, updated_at = ? WHERE id = ?', 'confirmed', now, 'T-000001')).toBeNull()
    db.close()
  })
})

describe('messages and transitions', () => {
  test('are append-only, both ways', () => {
    const db = migrated()
    seedTicket(db)
    db.query(
      `INSERT INTO messages (id, seq, ticket_id, author, kind, body, created_at)
       VALUES ('M-000001', 2, 'T-000001', 'builder', 'comment', 'hello', ?)`,
    ).run(now)

    expect(refusal(db, "UPDATE messages SET body = 'edited' WHERE id = 'M-000001'")).toContain('append-only')
    expect(refusal(db, "DELETE FROM messages WHERE id = 'M-000001'")).toContain('append-only')
    db.close()
  })
})

describe('an approver registration', () => {
  const insert = (db: Database, id = 'AP-000001') =>
    db
      .query(
        `INSERT INTO approvers (id, seq, property, level, covers, public_key, fingerprint,
                                effective_from, retired_at, registered_by, reason, created_at)
         VALUES (?, 3, 'sheeltron', 'project', NULL, 'pk', 'fp', ?, NULL, 'owner@example.test', NULL, ?)`,
      )
      .run(id, now, now)

  test('cannot be deleted — it explains past approvals', () => {
    const db = migrated()
    insert(db)
    expect(refusal(db, "DELETE FROM approvers WHERE id = 'AP-000001'")).toContain('never deleted')
    db.close()
  })

  test('cannot have its key or property rewritten', () => {
    const db = migrated()
    insert(db)
    // Rewriting the key would change who could approve, retroactively — the
    // exact thing the append-only registry exists to prevent.
    expect(refusal(db, "UPDATE approvers SET public_key = 'other' WHERE id = 'AP-000001'")).toBeTruthy()
    expect(refusal(db, "UPDATE approvers SET property = 'elsewhere' WHERE id = 'AP-000001'")).toBeTruthy()
    db.close()
  })

  test('may be retired exactly once, and never un-retired', () => {
    const db = migrated()
    insert(db)

    expect(refusal(db, 'UPDATE approvers SET retired_at = ? WHERE id = ?', now, 'AP-000001')).toBeNull()
    // Retiring again, or reversing it, both hit the same guard: the row already
    // carries a retirement stamp.
    expect(refusal(db, 'UPDATE approvers SET retired_at = ? WHERE id = ?', now, 'AP-000001')).toContain('once')
    expect(refusal(db, 'UPDATE approvers SET retired_at = NULL WHERE id = ?', 'AP-000001')).toContain('once')
    db.close()
  })

  test('one live row per property, enforced by the index rather than by code', () => {
    const db = migrated()
    insert(db, 'AP-000001')
    // A second live registration for the same property must be impossible at
    // the database, not merely avoided by the handler.
    const second = refusal(
      db,
      `INSERT INTO approvers (id, seq, property, level, covers, public_key, fingerprint,
                              effective_from, retired_at, registered_by, reason, created_at)
       VALUES ('AP-000002', 4, 'sheeltron', 'project', NULL, 'pk2', 'fp2', ?, NULL, 'owner@example.test', NULL, ?)`,
      now,
      now,
    )
    expect(second).toBeTruthy()
    db.close()
  })
})

describe('a test-property designation', () => {
  const insert = (db: Database, id: string, seq: number, designated: 0 | 1) =>
    db
      .query(
        `INSERT INTO test_properties (id, seq, property, designated, at, by_subject, reason, created_at)
         VALUES (?, ?, 'acceptance-scratch', ?, ?, 'owner@example.test', NULL, ?)`,
      )
      .run(id, seq, designated, now, now)

  test('cannot be edited or deleted — both are added rows instead', () => {
    const db = migrated()
    insert(db, 'TP-000001', 5, 1)

    expect(refusal(db, "UPDATE test_properties SET designated = 0 WHERE id = 'TP-000001'")).toContain('immutable')
    expect(refusal(db, "DELETE FROM test_properties WHERE id = 'TP-000001'")).toContain('never deleted')
    db.close()
  })

  test('undesignating is a new row, and the newest wins', () => {
    const db = migrated()
    insert(db, 'TP-000001', 5, 1)
    insert(db, 'TP-000002', 6, 0)

    // The read the relay actually performs.
    const live = db
      .query<{ property: string }, []>(
        `SELECT property FROM test_properties t
          WHERE designated = 1
            AND seq = (SELECT MAX(seq) FROM test_properties x WHERE x.property = t.property)`,
      )
      .all()
    expect(live).toEqual([])

    // And the history survives, which is the point of doing it this way.
    expect(db.query('SELECT COUNT(*) AS n FROM test_properties').get()).toEqual({ n: 2 })
    db.close()
  })

  test('only 0 or 1 is a designation', () => {
    const db = migrated()
    expect(
      refusal(
        db,
        `INSERT INTO test_properties (id, seq, property, designated, at, by_subject, reason, created_at)
         VALUES ('TP-000009', 9, 'acceptance-scratch', 2, ?, 'owner@example.test', NULL, ?)`,
        now,
        now,
      ),
    ).toBeTruthy()
    db.close()
  })
})

describe('a GO', () => {
  test('can be stamped consumed once, and never unstamped', () => {
    const db = migrated()
    seedTicket(db, 'DR-000001')
    db.query(
      `INSERT INTO gos (ticket_id, seq, nonce, payload, owner_key_fingerprint, granted_at, consumed_at)
       VALUES ('DR-000001', 7, 'nonce-1', '{}', 'fp', ?, NULL)`,
    ).run(now)

    expect(refusal(db, 'UPDATE gos SET consumed_at = ? WHERE ticket_id = ?', now, 'DR-000001')).toBeNull()
    // A second consumption is the replay this trigger exists to stop, and it is
    // stopped in the database rather than only in the handler.
    expect(refusal(db, 'UPDATE gos SET consumed_at = ? WHERE ticket_id = ?', now, 'DR-000001')).toContain('once')
    expect(refusal(db, "DELETE FROM gos WHERE ticket_id = 'DR-000001'")).toContain('never deleted')
    db.close()
  })
})
