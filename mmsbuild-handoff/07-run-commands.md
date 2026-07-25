# Run Commands

There is **no root-level orchestration** — no root `package.json`, no root docker-compose, no
workspace spanning the three apps. Local dev needs **three terminals**. Each app uses a **different
package manager**.

> ⚠️ The repo lives on a **UNC-mapped `S:` drive (SMB share)**. This breaks things: SQLite cannot run
> on the share (OD forces `OD_DATA_DIR` to local disk), and file watching needs polling
> (`WATCHPACK_POLLING` / `CHOKIDAR_USEPOLLING` are forced in `start-open-design.sh`).

## Install

| App | Manager | Command |
|---|---|---|
| OpenDesign | pnpm (`pnpm@10.33.2`, node ~24) | `pnpm install` |
| Instatic | bun (`>=1.3.0 <1.4.0`) | `bun install` |
| Operator | npm (node >=20) | `npm install` **and** `npm --prefix ui install` |

## Dev server

| App | Command | Notes |
|---|---|---|
| OpenDesign | `start-open-design.cmd` (wraps `start-open-design.sh` via Git Bash) | The intended entry `pnpm tools-dev run web` is **replaced** by this script on the SMB share. Root `package.json` has no `dev` script. |
| Instatic | `bun run dev` | Runs `scripts/dev.ts` — starts the Bun CMS server + Vite together. |
| Operator | `npm run dev` | Runs `dev.mjs` — starts control-plane + Astro console + the `.serve` board (3 processes). |

Per-app OD scripts, if running pieces individually:
- `OpenDesign/apps/web` — `next dev --turbopack`
- `OpenDesign/apps/daemon` — `pnpm run build && node dist/cli.js --no-open`

## Build

| App | Command |
|---|---|
| OpenDesign | no root build. `apps/web`: `next build` — ⚠️ **currently fails** on an upstream Next.js 16.2.6 bug ("Expected workStore to be initialized"). `apps/daemon`: `tsc -p tsconfig.json` |
| Instatic | `bun run build` → `tsc -b && vite build` |
| Operator | no root build. Console: `npm run console:build` → `astro build` |

## Test

| App | Command |
|---|---|
| OpenDesign | no root test script. Per-app: `vitest run -c vitest.config.ts` (web uses `--maxWorkers=2`). Root has `pnpm run guard` (node --test) + `pnpm run typecheck`. |
| Instatic | `bun test`; E2E `bun run test:e2e` (Playwright); also `test:watch`, `test:coverage`, `test:bundle` |
| Operator | **none — no test script exists** in `Operator/package.json` or `Operator/ui/package.json` |

> ⚠️ **pnpm and vitest are known to fail on this UNC drive** (cmd.exe cannot use a UNC cwd). Use bun,
> or invoke tsc/node directly.

## Local URLs

Development (single-developer, not per-tenant):

- **App / Operator control-plane:** `http://127.0.0.1:4400` (`CONTROL_PLANE_PORT`)
- **Operator console (Astro):** `http://127.0.0.1:3000/operator` (`OPERATOR_CONSOLE_PORT`, Astro `base: '/operator'`)
- **Project-plan board:** `http://127.0.0.1:8091` (hardcoded in `.serve/server.cjs`)
- **Instatic:** `http://localhost:5173` — Vite editor UI, **this is the one you open** (`VITE_PORT`, strictPort)
- **Instatic API:** `http://localhost:3001` (`PORT`) — proxied from Vite via `/admin/api`, `/uploads`, `/_instatic`; not opened directly
- **Open Design:** `http://127.0.0.1:7457` — web UI, **this is the one you open** (`OD_WEB_PORT`)
- **Open Design daemon/API:** `http://127.0.0.1:7456` (`OD_DAEMON_PORT`); health gate at `/api/health`
- **Postgres (optional, docker):** host `5433` → container 5432

Per-tenant port ranges allocated by the control-plane at provisioning:

- Instatic tenants: from `TENANT_BASE_PORT` = **3101**
- OD daemons: from `OD_BASE_PORT` = **7500**
- OD web servers: from `OD_WEB_BASE_PORT` = **8100**

Public gateway (one origin funnels everything):

- `GATEWAY_PORT` 443, Tailscale funnel origin `https://siteagent.tailbbb0d2.ts.net`
- Routing: `/operator/*` → Astro console (**unauthenticated**); `/od/<slug>/*` → that tenant's OD;
  everything else → the Instatic of the tenant in the `sa_hub` cookie
- Test funnel: `TEST_FUNNEL_PORT` 10000
