// Postgres access for the control plane (connects as the admin role).
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../lib/env.mjs';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.adminDatabaseUrl, max: 10 });

export async function query(text, params) {
  return pool.query(text, params);
}

// Apply the (idempotent) control-plane schema.
export async function migrate() {
  const sqlPath = resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function close() {
  await pool.end();
}
