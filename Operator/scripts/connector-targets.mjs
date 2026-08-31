// Print the MMS_TARGETS line for the connector, built from the tenant registry.
//
// Every value the connector needs already exists in the control plane: each
// tenant's slug, the port its own Instatic listens on, and the owner login
// stored encrypted at rest. Assembling that by hand invites a typo in a port or
// a mismatched credential, and the failure surfaces much later as a confusing
// auth error — so this reads it from the source of truth instead.
//
// Only `active` tenants are included. A removed tenant still has a row, a port
// and a stored credential, so including it would produce a target that looks
// valid and fails at connect time against an instance that is no longer there.
//
// Deliberately prints to the terminal and writes nothing. The output contains
// live credentials: paste it into the window that runs the connector, and do not
// commit it, screenshot it, or send it through chat.
//
//   node scripts/connector-targets.mjs            # ready-to-paste PowerShell
//   node scripts/connector-targets.mjs --json     # just the JSON value
//   node scripts/connector-targets.mjs --list     # slugs and ports, no secrets
//
// Targets point at each tenant's own Instatic port rather than the public
// gateway. The gateway multiplexes tenants by the browser's `sa_hub` cookie,
// which a server-to-server caller never has, so addressing the port directly is
// what makes "which tenant" unambiguous.

import { query, close } from '../control-plane/registry/db.mjs';
import { decrypt } from '../control-plane/lib/crypto.mjs';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const listOnly = args.has('--list');

const { rows } = await query(
  `select slug, port, owner_email, owner_password_enc, status, provision_state
     from siteagent_control.tenants
    where slug is not null
      and status = 'active'
    order by slug`,
);

if (rows.length === 0) {
  console.error('No tenants found in siteagent_control.tenants.');
  await close();
  process.exit(1);
}

if (listOnly) {
  console.log('slug'.padEnd(24) + 'port'.padEnd(8) + 'owner email'.padEnd(32) + 'status');
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log(
      String(r.slug).padEnd(24) +
        String(r.port ?? '—').padEnd(8) +
        String(r.owner_email ?? '—').padEnd(32) +
        String(r.status ?? '—'),
    );
  }
  await close();
  process.exit(0);
}

const targets = {};
const skipped = [];

for (const r of rows) {
  // A tenant with no port has not been provisioned yet; one with no owner
  // credential cannot be logged into. Either way, including it would produce a
  // target that fails at connect time rather than at configuration time.
  if (!r.port || !r.owner_email || !r.owner_password_enc) {
    skipped.push(
      `${r.slug} (${!r.port ? 'no port' : !r.owner_email ? 'no owner email' : 'no stored password'})`,
    );
    continue;
  }
  let secret;
  try {
    secret = decrypt(r.owner_password_enc);
  } catch (err) {
    skipped.push(`${r.slug} (password will not decrypt — wrong ENC_KEY?)`);
    continue;
  }
  targets[r.slug] = {
    url: `http://127.0.0.1:${r.port}`,
    email: r.owner_email,
    secret,
  };
}

const json = JSON.stringify(targets);

if (asJson) {
  console.log(json);
} else {
  console.log('# Paste this into the SAME PowerShell window that will run the connector.');
  console.log('# Environment variables only reach a process started AFTER they are set.\n');
  console.log(`$env:MMS_TARGETS = '${json.replace(/'/g, "''")}'\n`);
  console.log(`# Configured targets: ${Object.keys(targets).join(', ') || '(none)'}`);
}

if (skipped.length > 0) {
  console.error(`\n# Skipped: ${skipped.join('; ')}`);
}

await close();
