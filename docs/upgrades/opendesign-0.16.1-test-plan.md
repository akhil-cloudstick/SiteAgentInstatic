# OpenDesign test plan — v0.16.1 upgrade + shared web build

_Run top to bottom, cheapest-failure-first: if step N fails, later steps are meaningless. Covers both
changes landed 2026-08-03/04: the **v0.14.0 → v0.16.1** upgrade and the **one shared web build**._

**URLs** — gateway `https://siteagent.tailbbb0d2.ts.net` · OD `<gateway>/design` (no slug — the tenant
comes from your hub session) · CMS `<gateway>/admin` (rename to /cms pending a decision) · operator console `<gateway>/operator`

**Logs** — OD daemon: `%TEMP%\siteagent-od\<slug>\daemon.log` · shared web:
`%TEMP%\siteagent-od\_shared-web\web.log` · control plane: the `npm run dev` terminal.

---

## 0. Start

```
cd s:\SiteAgentHub\Operator
npm run dev
```

✅ `shared web: PRE-BUILT (next start — fast) on :8100` and `[od] listening on http://127.0.0.1:7500`.

❌ `DEV (next dev — build it for speed)` → no shared build found. Run
`node Operator/scripts/build-od-web.mjs --force` from the repo root and restart.

❌ `EADDRINUSE :8100` → an orphan web from the old per-tenant model is still holding the port. Find it:
`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*next*' }`

> **Expect exactly ONE `next` process** no matter how many tenants are running. That is the whole
> point of the change — previously it was one per tenant.

## 1. You are on the new version

Log in, open OD from the hub.
✅ A **notification bell / message centre** is visible — that component did not exist before v0.16.1.
❌ No bell → the shared build is stale; rebuild with `--force`.

## 2. Tenant SSO (one login)

✅ Clicking through from the hub lands you in the OD workspace — no second login. The URL is
`<gateway>/design/…` with **no slug**.
❌ Bounced to `/login` → expected when the session expired; after signing in you should land back
on the SAME page. Landing on `/hub` instead means the `next` round-trip broke.

> Hitting `<gateway>/design` **without** logging in *should* fail — that is the gate working.

## 3. Gateway serving (fixed base path + API routing)

✅ Styling correct, icons load, project list populates, navigation keeps you under `/design/…`.
❌ Unstyled page or 404s on `/design/_next/…` → basePath mismatch; confirm the build's
`required-server-files.json` says `"basePath": "/design"`.
❌ Empty project list / `/design/api` errors → the gateway is not reaching your daemon.

## 4. MMS theme

✅ Cream canvas (`#f8f1df`), navy text (`#082a38`), green CTA. Product name reads **MMS Design**
everywhere — never "Open Design". Check desktop **and** ~900px.

## 5. AI follows templateRule

Ask for a simple page (e.g. *"a landing page for a coffee shop"*), then view source.
✅ Inline `<style>`, **no Tailwind utility classes**.
❌ Full of `flex`/`mb-4` → the CMS output contract is not reaching the model. Report immediately.

> `Operator/rules/templateRule.md` is hot-reloaded — edits apply on the next run, no restart.

## 6. Share to CMS — happy path

✅ Compliant page shares, imports, renders with images intact.

## 7. Share to CMS — the GUARD (most important)

Ask for *"rebuild this page using Tailwind utility classes"*, then Share to CMS.
✅ **Refused** with the *"one quick fix"* dialog. Nothing imports.
✅ **Fix it** → agent repairs it *without redesigning* (same layout/colours/content), then share succeeds.
❌ A Tailwind page imports → the gate is bypassed. Stop and report.

## 8. The stripped-stylesheet regression (fixed 2026-08-04)

Ask the agent to *"give the About page a completely different style"* and let the automatic
compliance turn run.
✅ The page keeps its **styled header/nav** afterwards.
❌ Unstyled bullet-list nav → the agent deleted a `<link>` without inlining it. The new
**"Styles present for markup"** rule should now block exactly this.

## 9. Re-share does not duplicate

✅ Sharing the same page twice **updates** the CMS page in place — no second copy.

## 10. Annotate / screenshot / manual edit

✅ Draw a mark → screenshot attaches, agent responds about **that element**. Manual edits persist on reload.

## 11. Composer placeholder caret (fixed 2026-08-04)

✅ Clicking the chat box shows **one** caret, at the left. The decorative blinking bar at the end of
the rotating suggestion disappears on focus.
✅ With the box empty, **Send** still submits the shown suggestion.

## 12. ⚠️ Multi-tenant isolation — REQUIRED before real multi-tenant use

**Cannot be run with only one tenant.** Provision a second tenant, then:

1. Sign in as A in one browser, B in another (or a private window).
2. In each, confirm the project list shows only that tenant's projects.
3. Confirm `/design/api/*` calls land on the right daemon (`%TEMP%\siteagent-od\<slug>\daemon.log`).
4. Sign out of A and into B **in the same browser** — confirm B never sees A's data (stale
   `od_session` must not pin you to A).

This is the one test the shared-build change makes essential; routing is now decided by the `sa_hub`
cookie rather than the URL.

## Known / expected — not bugs

- **AMR balance dialogs** are back (upstream 0.16 rebuilt the run-start path around them).
- **`promptCoreVariant` pinned to `classic`** deliberately; upstream ships a validation-only `slim` default.
- **`od_web_port`** in the registry is legacy and unused.
- Old `.next-prod-<slug>-*` / `.next-<slug>` build dirs are dead weight — deletable once nothing serves them.

## Rollback

Nothing is committed. `git checkout -- OpenDesign/ Operator/` restores both changes, or restore the
pre-upgrade tree from `C:\od-upgrade\backup-od-0.13.0` (the folder name reflects the original,
incorrect version estimate; contents are the true pre-upgrade tree).
