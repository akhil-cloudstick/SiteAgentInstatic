// Build the ONE shared OpenDesign web bundle so tenants serve it FAST via
// `next start` instead of the slow on-demand `next dev`.
//
// There is deliberately no per-tenant build: the bundle's Next basePath is a
// fixed, tenant-agnostic `/od`, and the gateway routes each request to the right
// daemon using the hub session cookie. One build serves every tenant — run this
// once per OpenDesign source upgrade, not once per tenant.
// See docs/opendesign/opendesign-shared-web-build.md.
//
// Safe to run while the control plane is up: it builds into a fresh versioned
// dir (`.next-prod-shared-<ms>`) and never touches the one currently being
// served or any tenant's projects.
//
// Usage:  node Operator/scripts/build-od-web.mjs [--force]
//   (no flag) -> build only if no shared build exists yet
//   --force   -> always rebuild (what you want after an OD source upgrade)
import { buildWeb, isWebBuilt } from '../control-plane/runtime/odRuntime.mjs';

const force = process.argv.slice(2).some((a) => a === '--force' || a === '-f');

if (!force && isWebBuilt()) {
  console.log('Shared OD web build already exists — skipping (pass --force to rebuild).');
  process.exit(0);
}

process.stdout.write(`Building shared OD web (basePath=/design)${force ? ' [forced]' : ''}... `);
try {
  await buildWeb();
  console.log('done ✓');
  console.log('Restart the control plane so the shared web serves the new build.');
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
}
process.exit(0);
