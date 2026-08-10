# Product Hub header — the two-row shared shell

The admin chrome is two rows. **Row 1 is shared verbatim** with Product Hub and MMS Design; **row 2 belongs to this product alone.** This split is the MMSBUILD shared-header integration contract, and it is what lets a user cross between products without the chrome shifting under them.

```text
ROW 1 — SHARED ON EVERY PRODUCT                                   src/admin/shared/ProductHubHeader/
[MMSBUILD] [Product Hub › MMS-CMS] [role-scoped Hub nav]
                                    [Help][Bell][Theme][Settings][Account]

ROW 2 — ONLY INSIDE THIS PRODUCT                                  src/admin/pages/site/toolbar/Toolbar.tsx
[MMS-CMS · client · project · site] [Dashboard Site Content Data Media Plugins Users]
                                    [Open live page] [Back to Product Hub]

ROW 3 — SITE EDITOR ONLY                                          src/admin/pages/site/toolbar/WorkspaceToolbar.tsx
[Site › Home page] [Live edit | Focus section | Responsive review] [device / zoom]
```

---

## TL;DR

- **Row 1** is `ProductHubHeader`, mounted by all three layouts (`AdminCanvasLayout`, `AdminWorkspaceCanvasLayout`, `AdminPageLayout`). It owns the `banner` landmark.
- **Row 2** is `Toolbar` — reframed from the old single-row header. It is a labelled `navigation` region, not a second banner.
- **The five utilities appear exactly once, in this order:** Help → Notifications → Theme → Settings → Account. Row 2 must never add one back.
- **Row 2 renders exactly seven destinations:** Dashboard, Site, Content, Data, Media, Plugins, Users. AI settings live behind Settings and the `/cms/ai` URL, not an eighth tab.
- **`aria-current="page"` only ever lands on a row-2 link.** Inside this product, no Product Hub destination is current.
- **Without a Product Hub, row 1 degrades** to brand + context label + utilities. No Hub navigation, no return button — a link to a Hub that isn't there is the same failure as a wrong default.
- Geometry: `--hub-shell-height` (60/58/56 px) and `--product-row-height` (48/46/44 px) in `globals.css`. Both rows read the same `--toolbar-*` palette group.
- Gated by `src/__tests__/toolbar/sharedShellHeader.test.tsx` and `src/__tests__/toolbar/hubContextContract.test.ts`.

---

## Hub context — the authorized scope

Every route between Product Hub and a specialist product carries the complete authorized scope, and `Back to Product Hub` returns to the exact surface the user came from. That scope is `HubContext` (`src/core/hubContext.ts`), a pure schema leaf both sides import:

| Field | Meaning |
|-------|---------|
| `hubBaseUrl` | Origin the Hub is served from. Every Hub link resolves against it. |
| `role` | `operator` \| `agency` \| `client` \| `super-admin` — the user's portfolio-wide authority. |
| `client`, `project`, `site` | Scope labels, narrowest last. `null` when the Hub did not supply them. |
| `origin` | Originating Hub surface / module / panel, echoed back on return. |
| `returnUrl` | Absolute URL of the exact Hub view to return to. Always Hub-origin. |

### Why `role` is not the CMS role

Instatic's roles (`owner` / `admin` / `client` / `member`) are capability bundles scoped to **one site**. The Hub role describes authority across the **whole portfolio**. Only the Hub knows the latter, so it travels with the context and is never inferred locally. The two gate different things:

- Hub role → which links appear in **row 1**.
- CMS capabilities (`canAccessWorkspace`, `src/admin/access.ts`) → which links appear in **row 2**.

### The flow

```text
Operator control-plane                     Instatic
──────────────────────                     ────────
hub.mjs ssoUrl()
  /cms/api/cms/sso?token=…                 handlers/cms/sso.ts
    &hubRole&hubSite&hubOrigin      ─────▶   parseHubContextFromSso(url)
    &hubReturnUrl                             ↓ validates + pins returnUrl to the Hub origin
                                            createSession({ hubContext })
                                              ↓ sessions.hub_context_json  (migration 025)
                                            ─────────────────────────────
                                            GET /cms/api/cms/hub-context
                                              ↓ findSessionHubContext()
                                              ↓ readStoredHubContext() re-pins to the CURRENT origin
                                            useHubContext()  →  ProductHubHeader / Toolbar
```

### Security: `returnUrl` is pinned, not trusted

`returnUrl` arrives on a route whose only authenticator is a signed SSO token, and it ends up in a `window.location.assign`. `resolveReturnUrl` (`server/auth/hubContext.ts`) resolves it against the configured Hub origin and **discards anything that lands elsewhere**, falling back to the Hub root. Without that pin the hand-off would be an open redirect wearing a product feature's clothes.

`readStoredHubContext` re-pins on every read. If an operator moves the Hub between sign-in and page load, the stored *path* is carried across to the new origin — the view is still valid, only the host changed.

### Configuration

| Variable | Role |
|----------|------|
| `INSTATIC_HUB_BASE_URL` | Explicit Hub origin. |
| `INSTATIC_HUB_SSO_URL` | Injected by the control-plane; its origin is the fallback. The hub that mints our SSO tokens is the hub we return to. |

Neither set → `hubBaseUrl()` returns `''`, every Hub surface is inert, and `server/static.ts` omits the `window.__instaticHub` flag so the client **skips the context fetch entirely**. A self-hosted install spends no round-trip being told `null`.

---

## Row 1 — `ProductHubHeader`

`src/admin/shared/ProductHubHeader/`. Lives in `shared/` so all three layouts can mount it without one layout's module graph reaching into another's.

| Piece | Notes |
|-------|-------|
| `HubBrandLockup` | One artwork per theme (`public/mmsbuild-logo-{light,dark}.png`); the dark asset is drawn larger, so source and intrinsic size swap together. Links to the Hub dashboard when there is one, `/cms/dashboard` otherwise. |
| `HubContextControl` | `Product Hub › MMS-CMS`. The product half is `BRAND_NAME` from `@core/brand` — the white-label surface. Renders as a plain label when there is no Hub to navigate to. |
| `HubNavigation` | Role-scoped links from `hubNavigation.ts`. Absent without Hub context. Never marked active. |
| `HelpButton` | Opens the Cmd+K palette on its Help scope. One help surface, not two. |
| `NotificationsButton` | Unread count from `adminNotifications`. |
| `ThemeToggleButton` | Unchanged, moved from the old trailer. |
| `SettingsButton` | Restored as a top-level gear; the account menu's duplicate is gone. |
| `AccountMenuButton` | Unchanged, moved. |
| `CompactHubMenu` | Below 1100px: Hub nav + Help + Theme + Settings. |

### The role → navigation table

Transcribed verbatim from the contract (`hubNavigation.ts`). `operator` and `agency` share one set.

| Role | Links |
|------|-------|
| Operator / Agency | Home, Portfolio, Actions, Approvals, Reports |
| Client | Home, My Projects, My Actions, Approvals, Reports |
| Super Admin | Home, Governance, Global Library, Intelligence, Knowledge, Integrations, Health & Audit |

---

## Row 2 — `Toolbar`

Keeps its `section` / `adminNavigationSlot` / `overlay` / `rightSlot` contract. What changed when row 1 took over the shared half:

- Brand lockup → `ProductIdentity` (`BRAND_NAME` + client · project · site).
- Theme and Account moved out; `OpenLivePageButton` stayed as a **specialist** action.
- `BackToProductHubButton` added, rendering only with Hub context.
- `<header>` → `<div role="navigation">` so the page has one banner, not two.
- `DefaultAdminNavigation` dropped AI and gained Users, matching the seven.

**Unsaved work** on return is handled by the existing `beforeunload` flush in `usePersistence` — the return is a full-page navigation, so that handler runs. A second confirm layer here would double-prompt against it.

---

## Responsive

| Width | Row 1 | Row 2 |
|-------|-------|-------|
| ≥1101px | Full: brand, context, Hub nav, five utilities | Full: identity, seven tabs, actions |
| ≤1100px | Brand, context, Bell + Account, compact menu (Hub nav, Help, Theme, Settings) | Identity, tabs scroll horizontally |
| ≤620px | Brand shrinks; context shows the product name only | Icon-only tabs (labels stay in the accessible name) |

The bell and the avatar survive the compact breakpoint deliberately: an unread count that only exists inside a closed menu is not a count, and hiding who you are signed in as behind a hamburger is a downgrade.

**The two menus never merge.** The contract requires row 2 to stay a separately labelled specialist navigation, and forbids repeating any utility across the two.

---

## Open items

These are specified but cannot be fully satisfied until Product Hub exists as an application. The build degrades cleanly and is ready to receive them:

- **Role-scoped Hub navigation stays hidden** until a Hub origin is configured and Product Hub serves those routes. `hubNavigation.ts` already holds the destinations.
- **`client` and `project` render only once Operator models them.** `Operator/control-plane/registry/schema.sql` is infrastructure-only today (slug, ports, status, tier) — no client name, project, or brief. `hub.mjs` sends `hubRole=operator` and `hubSite=<slug>`, which is what it actually holds.

---

## Related

- [`editor.md`](../editor.md) — the admin shell, layouts, routing
- [`design.md`](../design.md) — tokens, surfaces, primitives
- [`auth-and-access.md`](auth-and-access.md) — sessions, capabilities, step-up
- Source of truth:
  - `src/core/hubContext.ts` — the wire shape
  - `server/auth/hubContext.ts` — parsing, origin pinning, env
  - `src/admin/state/hubContext.ts` — the client store
  - `src/admin/shared/ProductHubHeader/` — row 1
  - `src/admin/pages/site/toolbar/Toolbar.tsx` — row 2
