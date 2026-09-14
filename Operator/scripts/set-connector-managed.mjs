/**
 * Mark tenants as connector-managed, or list who owns what.
 *
 *   node scripts/set-connector-managed.mjs                     # list
 *   node scripts/set-connector-managed.mjs <slug> [<slug>...]  # mark as managed
 *   node scripts/set-connector-managed.mjs --off <slug>        # hand back to us
 *
 * `connector_managed` means "the partner holding the connector token created
 * this site, so it is theirs". Those tenants enrol themselves as connector
 * targets without an allowlist entry and without a restart, which is what makes
 * onboarding one call instead of two.
 *
 * A flag that grants reachability deserves a deliberate command rather than a
 * hand-written UPDATE: it is the difference between the partner seeing a site
 * and not, and getting it wrong on the wrong slug exposes a client's content to
 * another client's agent.
 *
 * Sites created through `connector_create_site` set this themselves. This
 * script is for the ones that predate the flag, and for correcting a mistake.
 */
import { query, close } from '../control-plane/registry/db.mjs';

const args = process.argv.slice(2);
const turningOff = args[0] === '--off';
const slugs = (turningOff ? args.slice(1) : args).filter(Boolean);

async function list() {
  const { rows } = await query(
    `select slug, status, connector_managed, port,
            (coalesce(connector_password_enc, owner_password_enc) is not null) as has_credential
       from siteagent_control.tenants
      where status <> 'removed'
      order by slug`,
  );
  console.table(rows);
  console.log('\nconnector_managed = reachable by the partner without an allowlist entry.');
  console.log('Everything else must be named in Operator/connector-targets.json.');
}

try {
  if (slugs.length === 0) {
    await list();
  } else {
    for (const slug of slugs) {
      const { rows } = await query('select slug from siteagent_control.tenants where slug = $1', [slug]);
      // Checked one at a time so a typo names itself instead of silently
      // updating zero rows and reporting success.
      if (rows.length === 0) throw new Error(`Unknown tenant "${slug}" — nothing was changed.`);
    }
    const { rowCount } = await query(
      'update siteagent_control.tenants set connector_managed = $2, updated_at = now() where slug = any($1)',
      [slugs, !turningOff],
    );
    console.log(
      `${turningOff ? 'Cleared' : 'Set'} connector_managed on ${rowCount} tenant(s): ${slugs.join(', ')}`,
    );
    console.log('Restart the stack for the connector to pick this up as a start-up target.\n');
    await list();
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
