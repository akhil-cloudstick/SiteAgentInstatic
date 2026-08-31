# Pre-merge baseline (captured 2026-08-20, BEFORE any upgrade merge)
These failures exist on the CURRENT tree. They are NOT upgrade regressions.

## Instatic (`bunx tsc -b`) - 9 errors
- src/admin/pages/dashboard/widgets/PreflightWidget.tsx (50,53,57,62,62,120) - DashboardResource<T> property access
- src/ui/cn.ts(9,20) - Cannot find module '@mms/shell'
- src/ui/components/Button/index.ts(12,24) and (13,34) - Cannot find module '@mms/shell'

## OpenDesign (`pnpm typecheck`)
- @open-design/landing-page typecheck FAILS (`astro check`) -> ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

## Known dead code (from planning)
- getAgentDef('amr') returns null: integrations/vela.ts:867, runtimes/amr-model-probe.ts:47, routes/vela.ts:252
- stale refs to deleted components: e2e/lib/playwright/visual.ts, e2e/ui/visual-workspace.test.ts,
  apps/web/tests/styles/inline-model-switcher.test.ts
