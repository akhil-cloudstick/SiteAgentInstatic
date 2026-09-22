// The console's view of a tenant row. Pure, so what an admin listing exposes is
// testable without a database (lib/new1.selftest.mjs).
//
// NEW-1: nothing here is a usable credential. The pending invite link is shown
// once, when it is minted, and never re-derived for a listing; the tenant's AI
// gateway token is not included at all (the tenant is handed its own at spawn).
import config from './env.mjs';

// Registry columns that hold secrets, their ciphertext or their hash
// (owner_password_enc, db_password_enc, secret_key_enc, connector_password_enc,
// secret_ref, invite_token_*). The listing selects `t.*`, so this is a pattern
// rather than a list: a secret column added later is dropped without anyone
// remembering to add it here.
const SECRET_COLUMN = /(_enc$|password|secret|token)/;

/**
 * @param {object} row a listTenants() row
 * @param {{ running: boolean, odRunning: boolean, published: boolean }} live
 */
export function decorate(row, { running, odRunning, published, studio }) {
  const hubActivated = row.hub_status === 'active';
  const inviteExpired = !!row.invite_expires_at && new Date(row.invite_expires_at) <= new Date();
  const view = {
    ...row,
    hub_activated: hubActivated,
    // True while a link is out and unaccepted. The link itself is not here.
    invite_pending: !hubActivated && !inviteExpired && !!row.has_invite,
    running,
    od_running: odRunning,
    // The studio's honest state (R16): not-provisioned | starting | ready |
    // failed | stopped, with `since`/`forMs` while starting and `why` when it
    // failed. `od_running` is kept because it answers a different, narrower
    // question — did we spawn a process — and the gateway still asks it.
    studio: studio ?? { state: 'not-provisioned' },
    published,
    admin_url: row.port ? `http://127.0.0.1:${row.port}/cms` : null,
    // One shared OD web serves every tenant; the tenant is resolved from the hub
    // session, so the reachable URL is the gateway's /design mount, not a
    // per-tenant localhost port. (The od_web_port column is legacy and unused.)
    od_url: row.od_port ? `${config.gatewayOrigin}/design` : null,
  };
  for (const k of Object.keys(view)) if (SECRET_COLUMN.test(k)) delete view[k];
  delete view.has_invite;
  return view;
}
