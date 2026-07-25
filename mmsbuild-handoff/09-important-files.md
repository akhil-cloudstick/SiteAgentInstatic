# Important Files

Paths relative to repo root (`S:\SiteAgentHub`). Line numbers from 2026-07-20, branch
`Instatic_opendesign` @ `a6db789`.

## Open Design connection (OD side of Share-to-CMS)

- **`OpenDesign/apps/web/src/components/FileViewer.tsx`**
  - what it does: the UI trigger. `pushProjectToCms` (`:1214`) opens `about:blank` first (popup-blocker
    safety), POSTs to the daemon, then redirects that tab to the returned `redirectUrl`. Buttons at
    `:5467` and `:10780`. Also hosts the `CmsBlockedDialog` + `buildFixVisibleMessage` /
    `buildFixInstruction` for the compliance failure path.
  - main functions: `pushProjectToCms`, `buildFixVisibleMessage`, `buildFixInstruction`

- **`OpenDesign/apps/daemon/src/server.ts:2809`** — `POST /api/projects/:id/push/instatic`
  - what it does: the whole share pipeline in five stages: `materializeProjectImages()` (`:2824`) →
    `collectSiteFiles()` (`:2829`) → `normalizeSiteFiles()` (`:2841`, non-blocking, falls back to raw
    on error) → **compliance gate** (`:2851`, hard `422 CMS_COMPLIANCE_FAILED`) → two outbound
    `fetch()` calls (`:2874` SSO, `:2883` push). Returns `{ ok, redirectUrl }`; `redirectUrl` points
    at the **public gateway origin** (`:2898-2902`), not `OD_INSTATIC_URL`, because a remote browser
    can't reach the localhost URL.
  - main functions: the route handler; emits the hidden `context.agentInstruction` channel on 422

- **`OpenDesign/apps/daemon/src/od-share-to-cms.ts`**
  - what it does: `collectSiteFiles` (`:45`) walks the project on disk and returns
    `{ "<webPath>": { base64, mimeType } }`. `:73` strips the `public/` prefix so keys mirror a web root.
  - payload shape: `{ files: { "<path>": { base64: string, mimeType?: string } } }`

- **`OpenDesign/apps/daemon/src/tenant-sso.ts`** — validates the control-plane-signed SSO token
  (`:19` secret, `:51` `timingSafeEqual`, `:79-80` target/slug namespacing)

## Instatic CMS connection (receiving side)

- **`Instatic/server/handlers/cms/importSiteHtml.ts`** — two routes, both gated on capability `data.import`
  - `:47` `POST /admin/api/cms/import/site-html` → base64-decodes to `Uint8Array` (`:63`) →
    `stageFileMap` → returns `{ token }` 201. **It does not import.**
  - `:70` `GET /admin/api/cms/import/staged/:token` → **single-use, burned on read**

- **`Instatic/server/handlers/cms/siteImport/stagedImports.ts`**
  - what it does: the staging store — in-memory `Map`, 5-min TTL (`:21`), `nanoid(32)` token.
    `takeStagedFileMap` (`:52`) enforces **same-user** pickup and calls `staged.delete()` *before* any
    validation.
  - ⚠️ per-process in-memory: fine at one-process-per-tenant, silently breaks under horizontal scaling.

- **`Instatic/src/admin/pages/site/hooks/useStagedSiteImportHandoff.ts:33`**
  - what it does: the browser pickup. Reads `?importToken=`, strips it from the URL immediately
    (`:48-52`) so a reload never re-fetches a burned token, then hydrates `SiteImportModal`.

- **`Instatic/server/auth/tenantSso.ts`** — mints the Owner session (`:26` secret, `:38`
  `timingSafeEqual`, `:51-52` target/slug). See §Security note below.

## Template/design control

- **`Operator/rules/templateRule.md`** — **the authoritative build contract.** Reverse-engineered from
  the importer. Read **live** by OD via `OD_CMS_RULE_FILE` (mtime-cached) → edit this one file and
  every tenant's OD picks it up with no redeploy.
- **`Operator/rules/check-template-rule.mjs`** — standalone CLI compliance checker (kept in lockstep
  with `cms-compliance.ts`).
- **`OpenDesign/apps/daemon/src/prompts/cms-contract.ts`** — injects the rule into OD's system prompt.
  `renderCmsOutputContract`, hard-requirements shortlist, silent self-audit, offline fallback.
  `:82` brand colors as `:root --…` tokens; `:133`/`:186` `--font-*` tokens; `:169` one semantic class
  per component; `:85` bans shorthand `background:` (the importer drops the declaration).
- **`OpenDesign/apps/daemon/src/cms-compliance.ts`** — the gate checker, incl. rule 14 "content visible
  without JavaScript".
- **`OpenDesign/apps/daemon/src/cms-normalize.ts`** — lossless mechanical normalizer +
  `makeVisibleWithoutJs`. `utilityToDeclarations` (`:120`, tables at `:64-119`) is the Tailwind→longhand
  converter. Never rewrites genuine design choices.
- **`OpenDesign/apps/daemon/src/cms-image-materialize.ts`** — the deterministic image guarantee: capture
  external URL (SSRF-guarded) / fetch keyless Lorem Picsum / write SVG placeholder. Wired into both the
  preview serve and the share pipeline. Provider-free.
- **Instatic token parsers:** `src/core/siteImport/colorTokens.ts`, `fontTokens.ts`, `rootScope.ts` —
  parse OD's tokens back out into editable CMS tokens.

## Publish/preview flow

- **`Instatic/src/core/siteImport/buildPlan.ts:57`** — `buildImportPlan`, headless and pure.
- **`Instatic/src/core/siteImport/commitPlan.ts:63`** — `commitImportPlan`. Three steps (`:5-8`):
  upload assets → rewrite refs → **one** `adapter.commit` = one undo snapshot.
  - `:125` and `:477` — `<nav>/<header>/<footer>` structurally identical across ≥2 pages are promoted
    to a `VisualComponent`; each page's section node is replaced with a `base.visual-component-ref`
    module (`:518`).
- **`Instatic/src/core/siteImport/types.ts:556`** — `ImportPlan` shape: pages, styleRules,
  fonts/googleFonts, conditions, assets, colors (`:222`), fontTokens (`:234`), scripts, stylesheets,
  globalSections.
- **`Instatic/src/admin/modals/SiteImport/SiteImportModal.tsx`** — the one true import wizard UI, shared
  by manual Ctrl+K and the automated handoff.
- **`Instatic/server/handlers/cms/publish.ts:37`** — `POST /admin/api/cms/publish`. Requires capability
  `pages.publish` **and** `requireStepUp` (`:41`). Status at `:69`. `:59` fires the fire-and-forget
  `INSTATIC_DEPLOY_WEBHOOK` → control-plane → Cloudflare. Only on explicit publish, never autosave.
- **`Instatic/server/handlers/cms/importPreview.ts:35`** — preview.

## Control plane / gateway (Operator)

- **`Operator/control-plane/server.mjs`** — the single public entry. Provisions tenants, spawns
  per-tenant OD daemons, hosts the key-hiding AI gateway (`:115`), opens the funnel after the gated
  server listens (`:226`) and closes it first on shutdown (`:232`).
- **`Operator/control-plane/runtime/odRuntime.mjs:55-95`** — **this is where the two systems are
  actually wired together.** Injects the whole linkage as env into each tenant's OD daemon.
  `:81` sets `OD_INSTATIC_URL` **only when `tenant.instaticUrl` exists** → **lite tenants get an inert
  Share button**. `:87` passes `OD_CMS_RULE_FILE`. `:91-94` managed-AI vars — provider keys never enter
  the OD process.
- **`Operator/control-plane/gateway/proxy.mjs`** — one public origin, three routes: `:109` `/operator/*`
  → Astro console (**no auth**); `:116` `/od/<slug>/*` → per-tenant OD, with daemon paths (`/api`,
  `/sso`, `/artifacts`, `/frames` — `isDaemonPath:73`) bypassing Next; `:143` everything else →
  Instatic for the `sa_hub` cookie's tenant. Notable hacks: `:58` `odSlugFromReferer` (the OD SPA emits
  base-less absolute URLs), `:44` `rewriteLocation`, `:134` `Sec-Fetch-Dest: document` exclusion.
  WebSocket upgrades pass at `:167`.
- **`Operator/control-plane/gateway/funnel.mjs:23`** — shells out to `tailscale funnel --bg`.
- **`Operator/control-plane/lib/env.mjs:48-80`** — all gateway/port/secret env names.

## Security notes worth surfacing to Codex

1. **SSO pre-satisfies step-up.** `Instatic/server/handlers/cms/sso.ts` mints an Owner session with
   **both MFA and step-up already satisfied** (`stepUpExpiresAt: expiresAt`; comment at `:47-51`
   explains the hub is the IdP so local re-auth is impossible). Consequence: **anything holding the SSO
   secret can mint a session that passes the Publish step-up gate** — i.e. publish *is*
   programmatically triggerable through this side door.
2. **`/operator/*` is explicitly unauthenticated** while sitting on the same public funnel as tenant
   traffic (`proxy.mjs:109`).
3. **Staged imports are per-process in-memory** — breaks under horizontal scaling.
4. **Secrets on disk:** `Operator/.env` holds real values (`SETTINGS_ENC_KEY`, `ADMIN_DATABASE_URL`)
   and `Instatic/_creds.ts` exists. **Neither is included in this handoff.** Worth a hygiene pass.
