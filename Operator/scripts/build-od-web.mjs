// Pre-build tenants' OpenDesign web so they serve FAST via `next start` instead of
// the slow on-demand `next dev` compiler. Safe to run while the control plane is
// up — it builds to a separate `.next-prod-<slug>` dir and never touches projects.
//
// Usage:  node Operator/scripts/build-od-web.mjs [slug]
//   (no slug) -> build every advanced tenant that isn't built yet
//   <slug>    -> (re)build just that tenant (force)
import { listTenants, getTenant } from '../control-plane/registry/tenants.mjs';
import { buildWeb, isWebBuilt } from '../control-plane/runtime/odRuntime.mjs';

const only = (process.argv[2] ?? '').trim();

const list = only
  ? [await getTenant(only)].filter(Boolean)
  : (await listTenants()).filter((t) => t.od_web_port && t.od_port);

if (only && list.length === 0) {
  console.error(`No tenant "${only}".`);
  process.exit(1);
}

console.log(`OD web build — ${list.length} tenant(s): ${list.map((t) => t.slug).join(', ') || '(none)'}`);
for (const t of list) {
  if (!only && isWebBuilt(t.slug)) {
    console.log(`  ${t.slug}: already built — skipping (pass the slug to force a rebuild)`);
    continue;
  }
  process.stdout.write(`  ${t.slug}: building (daemon :${t.od_port})... `);
  try {
    await buildWeb(t.slug, t.od_port);
    console.log('done ✓');
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
  }
}
console.log('Finished. Restart the control plane so tenants start pre-built (fast).');
process.exit(0);
