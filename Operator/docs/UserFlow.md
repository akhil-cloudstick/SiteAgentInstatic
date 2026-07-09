# UserFlow: SiteAgent — The Human Journey
_The end-to-end experience for both actors. Terms per [`CONTEXT.md`](CONTEXT.md); the runtime behind each step is in [`Architecture.md`](Architecture.md)._

## Goal
Describe what each person *sees and does*, beat by beat — onboarding a Tenant, building a site (by hand or with AI), publishing it live, and running the fleet — so the UI and the control-plane agree on every state and message.

## Two ways a Tenant builds a site

**Path A — Build from scratch inside Instatic**
The Tenant uses Instatic's visual editor and AI agent to build pages from scratch. No external files needed.

**Path B — Import a replica of an existing website**
Someone (a developer, an AI agent, the Operator, or the Tenant themselves — **not SiteAgent's concern**) rebuilds the client's old website following `docs/templateRule.md`. The output is a standard project folder (e.g. `dist/`). The Tenant imports that folder into their Instatic, where it becomes fully editable — they can change content, restyle, add or remove pages, use the AI, and publish. SiteAgent's only role here is providing the rule and the Instatic instance.

## Actors
- **Operator** — runs SiteAgent from the Console. Never touches tenant content.
- **Tenant Admin** — the Instatic Owner of one instance. Builds/edits and publishes the site.
- **Sub-user** — an additional person inside a Tenant, scoped by a custom role.

## Visible state model (what a Tenant can perceive)
- **Building** — editing in the canvas or via the agent; nothing public yet.
- **Draft changes pending** — *"● Draft changes not yet live"*.
- **Publishing** — *"Baking &amp; deploying…"* (transient).
- **Live** — *"✅ Live — view site"* with the URL.
- **Publish problem** — *"⚠️ Publish hit a problem — your site is unchanged. Try again."* (auto-safe; the previous live site stays up).

## Flows
### Flow 0 — Operator onboards a Tenant
1. Operator opens **Tenants → Add Tenant** — fills a short form (*tenant name, owner email, site name*).
2. Clicks **Create**. The Console shows *"Provisioning…"* and walks the saga (schema+role → container → first-run → Cloudflare project).
3. On success: *"Tenant ready"* with a **share link + login credentials** to hand over. On failure: a clear error and **automatic cleanup** (no half-made tenant, no leaked Cloudflare project).

### Flow 1 — Tenant first login → workspace
1. Tenant opens the share link, logs in with **email + password**.
2. Prompted to **set up their own 2FA** (their phone, their secret — the Operator never holds it). *(If Instatic forces 2FA at creation, provisioning handles it; otherwise it's opt-in here.)*
3. Lands in the Instatic workspace: visual canvas + AI chat, ready to build.

### Flow 2 — Build / edit by hand (visual canvas)
1. Tenant edits text, images, sections directly on the canvas.
2. Changes accumulate as **drafts** — *"● Draft changes not yet live"*.
3. Nothing is public until Publish.

### Flow 3 — Build / edit by AI prompt
1. Tenant types a request to the agent (*"add a pricing section with three tiers"*).
2. The agent works **inside the Tenant's instance**; its OpenRouter calls go through the **AI Gateway** — the Tenant never sees the key.
3. The canvas updates; the Tenant reviews and keeps or tweaks. (The agent needs the browser open — it's interactive, not headless.)

### Flow 4 — Import a replica site (Path B)
1. Someone has rebuilt the client's old website following `docs/templateRule.md` — the output is a project folder (e.g. `dist/`) built with Astro, with CSS inlined in the HTML, JS libraries from CDN, and images in `public/`.
2. Tenant opens their Instatic, presses **Ctrl + K → Import Site**, and selects the `dist/` folder.
3. Instatic imports all pages. Because the rule requires CSS to be inlined in the HTML, styles arrive with the import — the site looks as built.
4. From here the Tenant has full control: edit text and images, add or remove components, restyle, change colors, add new pages (e.g. a blog that didn't exist before), remove pages, and use the AI agent for help — all inside Instatic, no developer needed.
5. When ready → **Publish** → live on Cloudflare (same as Flow 6).

> **Who builds the replica is not SiteAgent's concern.** It could be the Operator, the Tenant, a developer, or an AI agent — SiteAgent provides the rule (`templateRule.md`) and the Instatic instance. Nothing else.

### Flow 5 — Preview review
1. Tenant previews the draft in Instatic's canvas — exactly what will go live.
2. Satisfied → Publish. Not satisfied → keep editing (drafts persist).

### Flow 6 — Publish (happy path)
1. Tenant clicks **Publish**. UI: *"Baking &amp; deploying…"*.
2. Instatic bakes the static site; the **Deployer** waits for the **finished** marker, then uploads the immutable folder to Cloudflare (a few seconds + upload time).
3. UI: *"✅ Live — view site"* with the URL. The Registry records the deploy.

### Flow 7 — Publish failure (auto-safe)
1. If the bake or upload fails, the Tenant sees *"⚠️ Publish hit a problem — your site is unchanged. Try again."*
2. The previously live site stays up; nothing partial ships. The failure is logged and (for the Operator) raised as an **alert**.

### Flow 8 — Sub-users &amp; roles (Tenant Admin)
1. Tenant Admin opens **Roles**, builds a custom role with per-permission toggles (e.g. *Editor* = edit, no publish).
2. Invites a sub-user with that role; the **per-user audit log** records their activity. Only "Tenant Admin" + custom roles show (Instatic's extra system roles are suppressed).

### Flow 9 — Operator monitors the fleet
1. The **Usage/Health** dashboard shows per-Tenant storage, pages/users, **AI usage (tokens/cost)**, deploys + last publish + live URL, container health.
2. A provision/deploy/health failure raises an **alert**; editing for healthy tenants is unaffected.

### Flow 10 — Custom domain
1. Operator (or Tenant, if exposed) attaches a custom domain to the Tenant's Cloudflare project.
2. The Console shows the **DNS record to add** and verifies **Active/Pending**; until attached, the site stays on `*.pages.dev`.

### Flow 11 — Suspend / remove a Tenant (Operator)
1. **Suspend** locks the Tenant out (their instance is paused); **resume** restores it.
2. **Remove** tears down cleanly: drop the schema + role, stop/remove the container + `tenants/<slug>/`, and (opt-in) delete the Cloudflare project — with a typed-slug confirmation. Other tenants are untouched.

## Key decisions &amp; tradeoffs
- **2FA belongs to the Tenant** — admin creates email+password only; the Tenant enables 2FA → no lock-out, no shared secret.
- **AI is interactive, key hidden** — the agent runs in the browser; the key lives only in the Gateway.
- **Publish is all-or-nothing** — only a *complete* bake deploys; failures never change the live site.
- **One active editing surface per Tenant** — the Instatic canvas is the single source of truth for a Site.

## Risks / open questions
- Whether Instatic forces 2FA at first-run (spike #2) shapes Flow 1.
- Whether the agent's calls are server-side vs browser-side shapes Flow 3's key-hiding (spike #4).
- Super-Import animation fidelity (Flow 4) is confirmed by a dedicated spike before it's promised to tenants.

## Out of scope
Self-serve signup; billing/plans; multi-site per Tenant; live form submissions (forms publish as markup; wiring a backend is deferred).

## Review status
Flows reflect the locked decisions; the Instatic-dependent steps (first-run 2FA, AI key path, import fidelity) are confirmed by their spikes before launch.
