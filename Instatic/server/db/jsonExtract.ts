/**
 * Dialect-aware JSON field extraction helper.
 *
 * Produces SQL fragments for extracting a scalar field from a JSON column,
 * normalised across the two supported dialects:
 *
 *   Postgres : `column->>'field'`          (jsonb text extraction operator)
 *   SQLite   : `json_extract(column, '$.field')`
 *
 * Usage:
 *   const expr = jsonField('settings_json', 'theme', db.dialect)
 *   // Pass expr.sql into a db.unsafe() call's SQL string; keep values parameterised.
 *
 * The returned `JsonFieldExpr` is a frozen, branded object. Callers cannot
 * construct one directly — they must go through `jsonField`, which validates
 * both identifiers. This prevents arbitrary SQL from being smuggled through the
 * helper's escape hatch.
 *
 * @see server/db/client.ts — DbClient.dialect
 * @see src/__tests__/architecture/json-extract-egress.test.ts — egress gate
 */

import type { Dialect } from './client'

// Re-export Dialect so callers can import it from this module alongside JsonFieldExpr.


/**
 * Branded SQL fragment produced by `jsonField`.
 * The `.sql` string is safe for insertion into `db.unsafe()` SQL because it
 * was validated and constructed exclusively by `jsonField`. Values are kept
 * parameterised by the caller.
 */
type JsonFieldExpr = { readonly __brand: 'JsonFieldExpr'; readonly sql: string }

/** Column and field names must be plain ASCII identifiers — no dots, no quotes, no hyphens. */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Build a dialect-correct SQL fragment that extracts a scalar text value from
 * a JSON column.
 *
 * @param column  - The SQL column name (must match /^[a-zA-Z_][a-zA-Z0-9_]*$/).
 * @param field   - The top-level JSON key to extract (same identifier rules).
 * @param dialect - Which SQL dialect to emit (`db.dialect`).
 * @returns A frozen `JsonFieldExpr` whose `.sql` may be spliced into a `db.unsafe()` call.
 * @throws If either identifier fails validation.
 *
 * @example
 *   const expr = jsonField('settings_json', 'theme', db.dialect)
 *   const result = await db.unsafe(
 *     `SELECT id FROM installed_plugins WHERE ${expr.sql} = ?`,
 *     [themeValue],
 *   )
 */
export function jsonField(column: string, field: string, dialect: Dialect): JsonFieldExpr {
  if (!IDENT_RE.test(column)) {
    throw new Error(`[db/jsonExtract] invalid column identifier: ${column}`)
  }
  if (!IDENT_RE.test(field)) {
    throw new Error(`[db/jsonExtract] invalid field identifier: ${field}`)
  }
  const sql =
    dialect === 'postgres'
      ? `${column}->>'${field}'`
      : `json_extract(${column}, '$.${field}')`
  return Object.freeze({ __brand: 'JsonFieldExpr', sql } as const)
}

/**
 * The same extraction, compared as a NUMBER on both dialects.
 *
 * `jsonField` is not type-normalised, whatever the header of this file says.
 * Postgres `->>` always yields text; SQLite `json_extract` yields the JSON
 * value's native type. So a numeric cell filtered with `{ price: { gt: 100 } }`
 * compares numerically on SQLite and lexicographically on Postgres — where
 * `'9' > '100'` is true. Every test runs SQLite, so the dialect that is wrong is
 * the one nobody tests.
 *
 * `cast(… as numeric)` is ANSI and understood by both. It is deliberately NOT
 * the default: casting a text cell to numeric is an error on Postgres, so this
 * is used only where the caller's own bound value is a number and a numeric
 * comparison is unambiguously what was asked for.
 *
 * Both dialects are given the same spelling so there is one behaviour to reason
 * about rather than two that happen to agree on the cases anyone tried.
 */
export function jsonFieldNumeric(column: string, field: string, dialect: Dialect): JsonFieldExpr {
  const base = jsonField(column, field, dialect)
  return Object.freeze({ __brand: 'JsonFieldExpr', sql: `cast(${base.sql} as numeric)` } as const)
}

// DbClient is imported as a type so that downstream code can write
// convenience wrappers that accept a DbClient and read its .dialect.
// The import is type-only and erased at runtime; it does not create a
// circular dependency.

