// Run the control-plane migrations. Usage: node operator/control-plane/registry/migrate.mjs
import { migrate, close } from './db.mjs';

try {
  await migrate();
  console.log('[migrate] siteagent_control schema is ready.');
} catch (e) {
  console.error('[migrate] FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
