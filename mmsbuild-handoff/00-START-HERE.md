# MMSBUILD Handoff — Start Here

Collected 2026-07-20 from `S:\SiteAgentHub`, branch `Instatic_opendesign` @ `a6db789`.

## Read in this order

1. **`10-integration-summary.md`** — plain-English: what OpenDesign and Instatic each control, how data
   moves, what's automated vs manual, and **what changed vs the old plan**. Start here.
2. **`11-questions-answered.md`** — the 14 questions, answered against the code. Q13/Q14 are the direct
   input for the plan rewrite.
3. **`09-important-files.md`** — every integration file with line numbers, plus a security-notes section.
4. **`07-run-commands.md`** — install/dev/build/test per app, ports, local URLs.
5. **`screenshots/README.md`** — what was captured from the live stack, and what couldn't be (with reasons).
6. **`08-open-design-instatic-search.txt`** — 937 scoped source hits on the integration symbols.
7. **`06-file-list.txt`** — 14,244 files, `node_modules`/build output excluded.

Supporting: `01`–`05` (location, root listing, git status/branch/log), `package.*.json`,
`README.*.md`, `env.example.instatic.txt`.

## The five things that most change the plan

1. **OpenDesign is a real, connected, first-class spoke.** The current plan
   (`docs/mmsbuild-project-plan.md`, 2026-07-06) mentions it **once, in passing, in §9**. It is absent
   from the Hub & Spokes diagram. That diagram is materially wrong.
2. **Design → CMS is solved and idempotent.** One click, verified end-to-end, **no duplicate pages on
   re-share** (match by slug → `overwritePage` → upsert). Phase 2 is largely done.
3. **The load-bearing mechanism is a *contract*, not an engine.** `templateRule.md` + three enforcement
   layers (prompt prevention → deterministic share-time repair → gate with one-click AI self-heal)
   keeps a generative design tool producing importer-safe output. The plan has no counterpart for this,
   and it displaces much of the "Template Library Engine" premise.
4. **Source-of-truth conflict is unresolved.** OD is declared authoritative and a re-share **overwrites**
   the CMS — but tenants can also edit in the CMS canvas, and those edits are silently destroyed on the
   next share. No merge-back, no conflict detection, no warning. **This needs a product decision.**
5. **The "Hub" that exists is an *infrastructure* control-plane** (processes, identity, keys, ports,
   deploys) — not the *product* hub the plan describes (clients, projects, workflow state, approvals,
   reports). Decide if these are one system or two.

## ⚠️ Two in-repo docs are stale — do not plan from them

`docs/phase5-share-to-cms-design.md` and the **2026-07-10** CHANGELOG entry describe a **server-side**
importer. That was built, then **deleted** in commit `9e13bf1` (2026-07-16) — `applyPlan.ts` (-382),
`classLinking.ts` (-97), `domPolyfill.ts` (-47) removed; `stagedImports.ts` (+59) and
`useStagedSiteImportHandoff.ts` (+67) added.

The shipped design is a **stage-then-browser-handoff**: OD pushes bytes server-to-server, Instatic
stages them and returns an opaque single-use token (5-min TTL), OD redirects the *tenant's browser*,
and the browser runs Instatic's own existing import wizard. `docs/od-cms-vision.md` describes this
correctly.

## Not included, deliberately

- **No `.env` files, no secrets, no tokens, no passwords.** Only variable *names* appear anywhere.
- **No source zip** (optional section 9 was **skipped on purpose**): `Operator/.env` contains real
  values (`SETTINGS_ENC_KEY`, `ADMIN_DATABASE_URL`) and `Instatic/_creds.ts` exists on disk. A
  `Compress-Archive -Path .\*` would have swept both in, plus ~1GB of `node_modules` and `.git`. The
  files above are sufficient for a plan update. **Separately: these two files are worth a secrets-hygiene
  pass.**
- **No authenticated screenshots** — tenant Owner credentials are stored encrypted by the control-plane
  and were not extracted or used. See `screenshots/README.md`.

## Prompt for Codex

> Here is the dev project handoff. Please inspect it and update:
> 1. `mmsbuild-project-plan.md`
> 2. `mmsbuild-prd.md`
> 3. `mmsbuild-project-plan-visual.html`
> 4. `mmsbuild-prd.html`
>
> Reflect that Open Design and Instatic CMS are now connected and improve design control / CMS control.
> Read `00-START-HERE.md` first, then `10-integration-summary.md` and `11-questions-answered.md`
> (Q13 = what to remove, Q14 = what to add). Promote OpenDesign to a first-class spoke in the Hub &
> Spokes diagram — it is currently absent. Note that `docs/phase5-share-to-cms-design.md` and the
> 2026-07-10 changelog entry are stale and describe a deleted server-side design.
