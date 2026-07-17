# OD ↔ CMS — Product Vision & the "Share to CMS" Contract

_This is the single source of truth for how OpenDesign (OD) and Instatic CMS relate, and what
"Share to CMS" must deliver. Read this before touching anything in the Share-to-CMS pipeline so the
intent never has to be re-explained._

## The origin story (why things are the way they are)

1. **Instatic CMS was built first.** It has a visual editor, an "Import Site" wizard, drafts,
   publishing to Cloudflare, etc.
2. **`templateRule.md` was written *based on how Instatic's import actually works*** — i.e. the rule
   is reverse-engineered from the importer so that any page built to the rule imports into Instatic
   **pixel-perfect and stays fully editable** (colors → editable color tokens, classes → editable
   style rules, nav/footer → shared Visual Components, etc.).
3. **OpenDesign (OD) was built afterward, as a *separate* module** whose one hard requirement is to
   **obey `templateRule.md` 100%**. OD is a design studio; it is NOT the CMS and is NOT merged into
   it.

## The proven manual flow (the gold standard we must match)

> Build a page in OD (or literally any tool) following `templateRule.md` → **download** the project →
> open Instatic → **Ctrl+K → Import Site → select the folder → Continue → Import** → the site appears
> **pixel-perfect and fully editable** in the CMS canvas.

This manual flow is the **accepted-correct baseline**. It has been verified to reproduce designs
faithfully. Whenever there is any doubt about what "Share to CMS" should do, the answer is: **exactly
what the manual download-then-Import-Site flow does.**

## What "Share to CMS" is (and is not)

**Share to CMS is glue that automates the manual flow — nothing more.** A tenant clicks one button
in OD instead of download-then-manual-import. Under the hood it must run **Instatic's own real import
pipeline** (the same `buildImportPlan` + `commitImportPlan` the manual wizard uses, in the tenant's
browser), never a separate/parallel re-implementation. There is exactly **one** import
implementation; Share-to-CMS and manual import both go through it, so they can never diverge.

**It is NOT** a second importer, NOT a server-side re-implementation, and NOT a place to
"approximately" convert the design.

## The non-negotiable acceptance bar

A Share-to-CMS result must be **identical to a manual Import-Site of the same project**, which means:

- **Pixel-perfect in the CMS *editable canvas*** — matching the OD canvas, immediately after import,
  before any publish. (Not just "renders without error.")
- **Pixel-perfect on the *published* Cloudflare page** too — and the canvas and published output must
  agree with each other.
- **Fully editable on both sides** — the tenant can edit in OD, and after import can also edit every
  block in the CMS canvas (text, images, buttons, Visual Components) and re-publish.
- **Responsive** — breakpoints behave the same as in OD.
- **All images load** — in the CMS canvas, in Preview, and on the published page (including any
  interactive image swaps), with no broken images and no manual refresh.
- **No duplicates on re-share** — re-sharing the same project reuses existing media (byte-identical →
  same row, only genuinely new images add rows) and rebuilds the design to **exactly match the
  current OD project** (a re-share never accumulates stale fonts/styles/pages from a previous share).
  OD is the **source of truth**; a re-share overwrites the CMS to match OD.

## Boundaries / invariants

- OD and Instatic stay **separate products** with separate runtimes. Do not merge them.
- The rule file (`Operator/rules/templateRule.md`) is read **live** by OD (`OD_CMS_RULE_FILE`,
  mtime-cached) — edit that one file and every tenant's OD picks it up with no redeploy.
- If OD produces something that imports imperfectly, prefer fixing it at the **source** — tighten
  `templateRule.md` and OD's compliance enforcement — so OD stops producing importer-hostile output,
  rather than adding fragile special-casing to the importer.
- The importer only rewrites **structured surfaces** (HTML `src`/`href`/`srcset`, CSS `url()`, fonts).
  It deliberately does NOT rewrite URLs inside `<script>` text — so pages must not hardcode asset
  paths in JS (read them from the DOM instead).

## Where the pieces live

- **[`docs/od-cms-compliance.md`](./od-cms-compliance.md)** — the core compliance logic (veg-kitchen: OD only builds what the CMS can import), the researched accept/block matrix, and the **future-failure playbook** (diagnose adherence-gap vs coverage-gap → fix → test). Read it before touching templateRule / the CMS contract / the gate.
- **`Operator/rules/templateRule.md`** — the build rule OD must obey (derived from the importer).
- **`Operator/rules/check-template-rule.mjs`** — standalone compliance checker (CLI).
- **`OpenDesign/apps/daemon/src/cms-compliance.ts`** — the same checks, run at OD's export boundary
  and by the build-time compliance gate (auto-corrects violations before a page can be shared).
- **`OpenDesign/apps/daemon/src/od-share-to-cms.ts`** + the `/api/projects/:id/push/instatic` route —
  OD's side of Share to CMS (build FileMap → stage into Instatic → redirect the browser into the
  wizard).
- **`Instatic/server/handlers/cms/importSiteHtml.ts`** — stages the FileMap for the browser wizard
  (`POST /import/site-html` → token; `GET /import/staged/:token` → burn-on-read).
- **`Instatic/src/admin/modals/SiteImport/SiteImportModal.tsx`** + the real
  `buildImportPlan`/`commitImportPlan` pipeline — the one true importer, shared by manual + automated.
