/**
 * The control plane's append-only triggers, run against a real Postgres
 * (security class E9, AC-B9.4).
 * Run: `npm run test:triggers` (from Operator/). Needs a reachable Postgres.
 *
 * Until now these had never been executed. Every other selftest in this repo
 * says so in its own header — "no database, no network" — which is what makes
 * them fast and what left the SQL that actually protects the receipt chain
 * unverified. A store that is append-only because the code is careful is a
 * different guarantee from one the database refuses to break, and E9 is about
 * the second: the record must resist whoever holds the database console, not
 * merely whoever calls the API.
 *
 * WHY A SCRATCH DATABASE, and not the live one.
 *
 * The first plan for this was to insert under a throwaway slug and clean up
 * afterwards. That is impossible, and the reason is the thing under test: a
 * deploy receipt CANNOT BE DELETED, by anyone, including this test. Inserting
 * into the live database would leave a permanent forged receipt in the proof
 * chain — in the very store whose credibility the acceptance run rests on.
 *
 * So this creates its own database, runs `schema.sql` into it verbatim, and
 * drops the whole thing at the end. Same shape the relay's trigger test achieves
 * with SQLite `:memory:`, and it still tests the real schema file rather than a
 * restatement of it.
 *
 * IT FAILS RATHER THAN SKIPS when no Postgres is reachable. The board sets that
 * rule for this class, and it is the whole point: a check that cannot run must
 * never look like one that ran and found nothing.
 */
import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPERATOR = resolve(HERE, '..', '..');

// The connection string, loaded the way `lib/env.mjs` loads it — but WITHOUT
// importing that module, because importing it pulls in `registry/db.mjs`, which
// opens a pool against the LIVE database at import time. This test must never
// hold a connection to the real control plane.
try {
  const envFile = resolve(OPERATOR, '.env');
  if (typeof process.loadEnvFile === 'function' && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
} catch { /* env file optional — the default below is env.mjs's own */ }

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

/**
 * Where to reach Postgres. This URL is used to CONNECT and to issue CREATE/DROP
 * DATABASE; it never holds the test's data.
 */
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL
  || 'postgres://siteagent_admin:siteagent_admin_pw@127.0.0.1:5432/siteagent_platform';

const SCRATCH = `siteagent_e9_${Date.now()}`;

/** Run a statement and return the refusal message, or null when it succeeded. */
async function refusal(client, sql, params = []) {
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function adminUrlFor(database) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

let adminClient = null;
let scratchClient = null;

try {
  adminClient = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await adminClient.connect();
  } catch (err) {
    // The failure the board asks for. Not a skip, and the message says what to
    // do about it rather than only what went wrong.
    console.error('FAIL  a Postgres is reachable');
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    console.error('');
    console.error('      E9 is about what the DATABASE refuses, so it cannot be checked without one.');
    console.error('      Start Postgres, or set ADMIN_DATABASE_URL, and run this again.');
    process.exit(1);
  }
  console.log('ok    a Postgres is reachable');

  // CREATE DATABASE cannot run inside a transaction and takes no parameters.
  // The name is generated above and contains only [a-z0-9_], so it is safe to
  // interpolate; there is no other way to say it.
  await adminClient.query(`CREATE DATABASE ${SCRATCH}`);
  console.log(`ok    scratch database created (${SCRATCH})`);

  scratchClient = new pg.Client({ connectionString: adminUrlFor(SCRATCH) });
  await scratchClient.connect();

  // The real file, verbatim. If a trigger is ever dropped from it, these fail.
  const schema = readFileSync(resolve(HERE, 'schema.sql'), 'utf8');
  await scratchClient.query(schema);
  console.log('ok    schema.sql applied verbatim');

  // --- the test cannot pass by looking at nothing -----------------------------
  //
  // A schema test whose tables silently failed to appear would report every
  // refusal as a success, because every statement would error for the wrong
  // reason. So the tables are asserted before anything is attempted against
  // them.
  const { rows: tables } = await scratchClient.query(
    `select table_name from information_schema.tables
      where table_schema = 'siteagent_control'
        and table_name in ('deploy_receipts', 'ai_spend', 'admin_audit', 'mcp_agent_audit')
      order by table_name`,
  );
  check(
    'all four protected tables exist',
    tables.map((r) => r.table_name),
    ['admin_audit', 'ai_spend', 'deploy_receipts', 'mcp_agent_audit'],
  );

  // Enumerated rather than pattern-matched: the point is that a NAMED trigger is
  // present on a NAMED table, so a rename that quietly drops one is caught. A
  // `like '%_no_update'` would keep passing while the set shrank.
  const { rows: triggers } = await scratchClient.query(
    `select trigger_name from information_schema.triggers
      where trigger_schema = 'siteagent_control'
        and trigger_name in (
          'deploy_receipts_no_update', 'deploy_receipts_no_delete',
          'ai_spend_no_update', 'ai_spend_no_delete',
          'admin_audit_no_update', 'admin_audit_no_delete',
          'mcp_agent_audit_no_update', 'mcp_agent_audit_no_delete'
        )
      group by trigger_name order by trigger_name`,
  );
  check(
    'all eight immutability triggers are installed',
    triggers.map((r) => r.trigger_name),
    [
      'admin_audit_no_delete', 'admin_audit_no_update',
      'ai_spend_no_delete', 'ai_spend_no_update',
      'deploy_receipts_no_delete', 'deploy_receipts_no_update',
      'mcp_agent_audit_no_delete', 'mcp_agent_audit_no_update',
    ],
  );

  // --- deploy receipts ---------------------------------------------------------
  //
  // `tenant_slug` carries no foreign key and the address-stamping trigger leaves
  // NULLs for an unknown slug, so a receipt can be written without a tenant row.
  await scratchClient.query(
    `insert into siteagent_control.deploy_receipts
       (tenant_slug, content_hash, published_pages, cf_project, deploy_url, verification, kind)
     values ('e9-scratch', 'hash-1', 3, 'proj', 'https://example.test', 'verified', 'publish')`,
  );
  const { rows: receipt } = await scratchClient.query(
    `select id from siteagent_control.deploy_receipts where tenant_slug = 'e9-scratch'`,
  );
  check('a receipt can be written', receipt.length, 1);
  const receiptId = receipt[0].id;

  const editReceipt = await refusal(
    scratchClient,
    `update siteagent_control.deploy_receipts set verification = 'failed' where id = $1`,
    [receiptId],
  );
  check('a receipt cannot be edited', /immutable/.test(editReceipt ?? ''), true);
  // The message distinguishes the two operations through tg_op, so the wording
  // is checked rather than only that something threw.
  check('and the refusal says "edited"', /may not be edited/.test(editReceipt ?? ''), true);

  const deleteReceipt = await refusal(
    scratchClient,
    `delete from siteagent_control.deploy_receipts where id = $1`,
    [receiptId],
  );
  check('a receipt cannot be deleted', /immutable/.test(deleteReceipt ?? ''), true);
  check('and the refusal says "deleted"', /may not be deleted/.test(deleteReceipt ?? ''), true);

  // The row survived both attempts — a refusal that left a partial change would
  // be worse than no refusal at all.
  const { rows: stillThere } = await scratchClient.query(
    `select verification from siteagent_control.deploy_receipts where id = $1`,
    [receiptId],
  );
  check('the receipt is untouched after both attempts', stillThere[0]?.verification, 'verified');

  // --- the AI spend ledger -----------------------------------------------------
  await scratchClient.query(
    `insert into siteagent_control.ai_spend
       (month, tenant_slug, product, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
     values ('2026-09', 'e9-scratch', 'design', 'a-model', 10, 5, 15, 0.0015)`,
  );
  const { rows: spend } = await scratchClient.query(
    `select id from siteagent_control.ai_spend where tenant_slug = 'e9-scratch'`,
  );
  check('a spend row can be written', spend.length, 1);
  const spendId = spend[0].id;

  const editSpend = await refusal(
    scratchClient,
    `update siteagent_control.ai_spend set cost_usd = 0 where id = $1`,
    [spendId],
  );
  // The reason this one matters: a cap that can be made to fit by editing
  // history is not a cap.
  check('a spend row cannot be edited', /immutable/.test(editSpend ?? ''), true);

  const deleteSpend = await refusal(
    scratchClient,
    `delete from siteagent_control.ai_spend where id = $1`,
    [spendId],
  );
  check('a spend row cannot be deleted', /immutable/.test(deleteSpend ?? ''), true);

  const { rows: spendStill } = await scratchClient.query(
    `select cost_usd from siteagent_control.ai_spend where id = $1`,
    [spendId],
  );
  check('the spend row is untouched after both attempts', Number(spendStill[0]?.cost_usd), 0.0015);

  // --- the audit trail itself (gap 4, closed 2026-09-29) ----------------------
  //
  // These two were the gap this test used to merely ASSERT: the record of what
  // went live was protected by the database while the record of who ordered it
  // was not. They take different shapes, and both shapes are checked — including
  // the positive case, because a guard that is too strict here breaks the
  // platform rather than an attacker.

  await scratchClient.query(
    `insert into siteagent_control.admin_audit (admin_email, admin_level, action, tenant_slug, detail)
     values ('someone@example.test', 'platform', 'tenant.rollback', 'e9-scratch', '{"restoredFrom":"gen-1"}'::jsonb)`,
  );
  const { rows: audit } = await scratchClient.query(
    `select id from siteagent_control.admin_audit where tenant_slug = 'e9-scratch'`,
  );
  check('an admin audit row can be written', audit.length, 1);
  const auditId = audit[0].id;

  const editAudit = await refusal(
    scratchClient,
    `update siteagent_control.admin_audit set admin_email = 'someone-else@example.test' where id = $1`,
    [auditId],
  );
  // The attack this closes: an administrator taking an action and then editing
  // the row that says who took it.
  check('an admin audit row cannot be edited', /immutable/.test(editAudit ?? ''), true);
  check('and the refusal says "edited"', /may not be edited/.test(editAudit ?? ''), true);

  const deleteAudit = await refusal(
    scratchClient,
    `delete from siteagent_control.admin_audit where id = $1`,
    [auditId],
  );
  check('an admin audit row cannot be deleted', /immutable/.test(deleteAudit ?? ''), true);
  check('and the refusal says "deleted"', /may not be deleted/.test(deleteAudit ?? ''), true);

  const { rows: auditStill } = await scratchClient.query(
    `select admin_email from siteagent_control.admin_audit where id = $1`,
    [auditId],
  );
  check('the admin audit row is untouched after both attempts', auditStill[0]?.admin_email, 'someone@example.test');

  // --- mcp_agent_audit: frozen except its address ----------------------------
  //
  // This one needs a REAL tenant row, unlike the receipt above. The address
  // stamper resolves `business_id` from the project on every insert AND on every
  // update of the address columns, so without a tenant it would resolve to NULL
  // and the restamp assertion below could not tell "the guard allowed it" from
  // "nothing happened". The receipts section deliberately has no tenant, which is
  // why this uses its own slug rather than sharing one.
  // Real Operator and Business rows, because `tenants.business_id` carries a
  // foreign key — the ids are generated, not invented, so the move below is the
  // same operation the platform performs.
  const { rows: op } = await scratchClient.query(
    `insert into siteagent_control.operators (slug, name) values ('e9-op', 'E9 Operator') returning id`,
  );
  const { rows: biz } = await scratchClient.query(
    `insert into siteagent_control.businesses (slug, name, operator_id)
     values ('e9-biz-a', 'Business A', $1), ('e9-biz-b', 'Business B', $1) returning id`,
    [op[0].id],
  );
  const bizA = biz[0].id;
  const bizB = biz[1].id;

  await scratchClient.query(
    `insert into siteagent_control.tenants (slug, schema_name, db_role, business_id, operator_id)
     values ('e9-addressed', 'e9_addressed', 'e9_addressed_role', $1, $2)`,
    [bizA, op[0].id],
  );

  await scratchClient.query(
    `insert into siteagent_control.mcp_agent_audit (tenant_slug, key_id, tool, target, ok)
     values ('e9-addressed', 'key-1', 'cms_list_tables', 'pages', true)`,
  );
  const { rows: agentAudit } = await scratchClient.query(
    `select id, business_id from siteagent_control.mcp_agent_audit where tenant_slug = 'e9-addressed'`,
  );
  check('an agent audit row can be written', agentAudit.length, 1);
  // The stamper resolved the address from the project on insert, which is the
  // behaviour the guard below must not break.
  check('and was addressed from its project on insert', Number(agentAudit[0]?.business_id), Number(bizA));
  const agentAuditId = agentAudit[0].id;

  const editTool = await refusal(
    scratchClient,
    `update siteagent_control.mcp_agent_audit set tool = 'something_else' where id = $1`,
    [agentAuditId],
  );
  check('an agent audit row cannot have its tool rewritten', /immutable/.test(editTool ?? ''), true);

  const editOk = await refusal(
    scratchClient,
    `update siteagent_control.mcp_agent_audit set ok = false where id = $1`,
    [agentAuditId],
  );
  // Flipping `ok` would turn a successful call into a failed one after the fact.
  check('an agent audit row cannot have its outcome flipped', /immutable/.test(editOk ?? ''), true);

  const editSubject = await refusal(
    scratchClient,
    `update siteagent_control.mcp_agent_audit set tenant_slug = 'somewhere-else' where id = $1`,
    [agentAuditId],
  );
  check('an agent audit row cannot be reassigned to another project', /immutable/.test(editSubject ?? ''), true);

  const deleteAgentAudit = await refusal(
    scratchClient,
    `delete from siteagent_control.mcp_agent_audit where id = $1`,
    [agentAuditId],
  );
  check('an agent audit row cannot be deleted', /immutable/.test(deleteAgentAudit ?? ''), true);

  // THE POSITIVE CASE, and the reason this guard is column-scoped rather than
  // unconditional.
  //
  // Driven through the REAL path rather than a hand-written UPDATE: moving the
  // project to another Business fires `tenants_propagate_address()`, which
  // rewrites `business_id` on every audit row for that project. A guard that
  // refused it would break re-addressing a project — the platform failing, not an
  // attacker — and it would fail here, inside the trigger, where the error is a
  // long way from the cause. So this exercises the actual platform operation.
  const moved = await refusal(
    scratchClient,
    `update siteagent_control.tenants set business_id = $1 where slug = 'e9-addressed'`,
    [bizB],
  );
  check('moving the project to another Business still works', moved, null);

  const { rows: restamped } = await scratchClient.query(
    `select business_id, tool, ok from siteagent_control.mcp_agent_audit where id = $1`,
    [agentAuditId],
  );
  check('the audit row was re-addressed by the propagation', Number(restamped[0]?.business_id), Number(bizB));
  // And the guard did its job during that same update: the content is untouched.
  check('while its content stayed frozen', restamped[0]?.tool, 'cms_list_tables');
  check('including its outcome', restamped[0]?.ok, true);

} finally {
  if (scratchClient) await scratchClient.end().catch(() => {});
  if (adminClient) {
    // Drop whether or not the checks passed, so a failing run leaves no database
    // behind. `with (force)` disconnects anything still attached.
    await adminClient.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(async () => {
      await adminClient.query(`DROP DATABASE IF EXISTS ${SCRATCH}`).catch(() => {});
    });
    await adminClient.end().catch(() => {});
    console.log(`ok    scratch database dropped (${SCRATCH})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll append-only trigger checks passed.');
