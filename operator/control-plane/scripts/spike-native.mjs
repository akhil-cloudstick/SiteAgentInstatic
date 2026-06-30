// Live native-runtime smoke test: spin ONE Instatic instance via Bun against a
// Postgres schema and confirm it migrates into the tenant schema (not public).
// Run: node operator/control-plane/scripts/spike-native.mjs
import pg from 'pg';
import config from '../lib/env.mjs';
import * as rt from '../runtime/tenantRuntime.mjs';
import { genSecretKeyHex } from '../lib/crypto.mjs';

const { Pool } = pg;
const admin = new Pool({ connectionString: config.adminDatabaseUrl });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slug = 'nativespike';
const schema = 'nativespike';
const role = 't_nativespike';
const pw = 'spikepw_local_123';
const secret = genSecretKeyHex();
const port = 3199;

const sql = (q, p) => admin.query(q, p);

try {
  await sql(`drop schema if exists ${schema} cascade`);
  await sql(`drop role if exists ${role}`);
  await sql(`create role ${role} login password '${pw}'`);
  await sql(`create schema ${schema} authorization ${role}`);
  await sql(`alter role ${role} set search_path = ${schema}`);
  await sql(`grant connect on database ${config.pgDb} to ${role}`);
  console.log('[spike] schema + role minted');

  const rec = rt.start({ slug, port, dbRole: role, dbPassword: pw, secretKey: secret });
  console.log('[spike] spawned Instatic via Bun, pid=', rec.pid, 'on :', port);

  const ok = await rt.waitHealthy(port, 60000);
  console.log('[spike] instance healthy (HTTP responding):', ok);
  await sleep(4000); // let migrations settle

  const inSchema = await sql(
    `select table_name from information_schema.tables where table_schema=$1 order by 1`, [schema]);
  const inPublic = await sql(
    `select table_name from information_schema.tables where table_schema='public' order by 1`);
  console.log('[spike] tables in TENANT schema  :', inSchema.rows.map((r) => r.table_name).join(', ') || '(none)');
  console.log('[spike] tables in PUBLIC schema  :', inPublic.rows.map((r) => r.table_name).join(', ') || '(none)');

  const verdict = inSchema.rows.length > 0 && inPublic.rows.length === 0
    ? 'PASS — Instatic honors the tenant schema (schema-per-tenant works natively)'
    : (inSchema.rows.length > 0 ? 'PARTIAL — some tables in schema; check public' : 'FAIL — no tables in tenant schema');
  console.log('[spike] VERDICT:', verdict);
} catch (e) {
  console.error('[spike] ERROR:', e.message);
} finally {
  try { rt.stop(slug); } catch {}
  await sleep(2500);
  try {
    await sql(`drop schema if exists ${schema} cascade`);
    await sql(`drop role if exists ${role}`);
    console.log('[spike] cleaned up.');
  } catch (e) { console.error('[spike] cleanup note:', e.message); }
  await admin.end();
  process.exit(0);
}
