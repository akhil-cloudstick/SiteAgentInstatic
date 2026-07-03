# PENDING — remove before production

These changes exist **only to let a remote client test over a public URL**
(`https://siteagent.tailbbb0d2.ts.net:8443`). They are **not** meant for
production. Before going live, remove/replace everything in **Section 1** and
review **Section 2**. Things in **Section 3** are real fixes/features — **keep them.**

Date started: 2026-07-03.

---

## 1. CLIENT-TEST ONLY — REMOVE for production

### 1a. Tenant "remote test" exposure feature
Publishes ONE tenant's Instatic editor on the spare Tailscale funnel port (:10000)
so a remote client can log in and edit it. In the console, when reached over the
funnel, a tenant's "open" link publishes that tenant and redirects the client to it
(one tenant public at a time). Production instead gives each tenant its own real
domain, so this whole mechanism goes away.

- **`operator/control-plane/lib/env.mjs`** — remove `testFunnelPort` and
  `testFunnelOrigin` config lines.
- **`operator/control-plane/runtime/tenantRuntime.mjs`** — remove the
  `VITE_ALLOWED_ORIGIN: config.testFunnelOrigin` line (the tenant env entry that
  makes Instatic's CSRF check trust the funnel origin). `PUBLIC_ORIGIN` stays as the
  plain localhost value.
- **`operator/control-plane/provisioner/provision.mjs`** — remove
  `import { spawn }`, and the `runTailscale` + `pointTestFunnel` functions.
- **`operator/control-plane/server.mjs`** — remove `pointTestFunnel` from the
  import; remove `expose` from the action regex; remove the `expose` action handler.
- **`operator/ui/src/pages/index.astro`** — remove the `viaFunnel` block that sets
  `t.instance_url`, and change the Instance `<td>` link/copy back from
  `t.instance_url` to `t.admin_url`.
- **`operator/ui/src/pages/open.ts`** — delete the whole file (the publish+redirect
  endpoint).

Note on the CSRF fix: tenants run from a mapped network drive (`S:` → `\\ZAISERVER`),
which makes Bun load `server/auth/security.ts` twice — so the funnel origin placed in
`PUBLIC_ORIGIN`/`publicOrigins` isn't visible at request time (localhost still works via
the Host-header fallback). The reliable workaround is `VITE_ALLOWED_ORIGIN` (a static
`DEV_ORIGIN_ALLOWLIST` const, identical in both module copies). Remove it for production
(where each tenant has its own real domain and there's no double-load).

### 1b. Public Tailscale exposure (infra — not in git)
- Turn the funnels off:
  `tailscale funnel --https=8443 off` (console),
  `tailscale funnel --https=10000 off` (tenant test).
  (`:443 → :8080` is the separate "roadmap" page — leave unless you want it gone.)
- The tailnet node was renamed `roadmap` → `siteagent` (`tailscale set --hostname=…`).
- **`operator/ui/astro.config.mjs`** — the `allowedHosts: ['.ts.net']` line only
  exists so the funnel can reach the dev server; remove if not exposing publicly.

### 1c. Astro CSRF check disabled
- **`operator/ui/astro.config.mjs`** — `security: { checkOrigin: false }` was added
  because the Tailscale funnel changes the Origin/Host, which made Astro reject every
  form POST ("Cross-site POST form submissions are forbidden"). Re-enable (remove this
  line) for a production/authed setup that isn't behind the funnel.

### 1d. Hardcoded funnel hostname
`siteagent.tailbbb0d2.ts.net` (:8443, :10000) is hardcoded in `env.mjs`
(`testFunnelOrigin`) and in the funnel setup. In production these become the real
domain(s).

### 1e. ⚠️ SECURITY: the console + control-plane have NO login
Nothing gates the operator console or the `:4400` API. It is currently public with
no password. **Do not ship this.** Before production either add auth or keep it
private (tailnet-only / VPN). Tracked here so it isn't forgotten.

---

## 2. REVIEW (config that leaned on the test setup)

- Port **4400** for the control-plane (see Section 3 — this is a real fix, keep it,
  but confirm the production host doesn't also need 4000 free).

---

## 3. KEEP — real fixes/features (do NOT remove)

- **Control-plane port 4400** (was 4000): `.env`, `operator/control-plane/lib/env.mjs`,
  and the `CP` constant in `operator/ui/src/pages/index.astro` + `settings.astro`.
  Reason: port 4000 is permanently used by the separate IzoraFoodApp backend.
- **Global AI guidance editor**: `operator/control-plane/registry/settings.mjs`
  (`saveDefaultGuidance`), `operator/control-plane/server.mjs`
  (`POST /api/ai-guidance-default`), and the "Global AI guidance" card + scrollbar
  in `operator/ui/src/pages/settings.astro`. This is a genuine feature.
