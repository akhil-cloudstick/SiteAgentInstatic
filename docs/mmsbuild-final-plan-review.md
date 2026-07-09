# MMSBUILD — The Plan, Explained Simply

_This is not a new plan. It's me reading the plan your client sent (`mmsbuild-project-plan.md` and `mmsbuild-user-cycle-flowchart.md`, both shared 2026-07-06) and explaining it back to you in plain words, with one running example, so we build what the client actually meant — not something different._

**How to use this file:** wherever you see a line that says `> Your question:`, just type your question or comment right under it (in your own copy / when you send it back). I'll read every one and answer it before we write any real build plan.

Confirmed so far (from our conversation):
- The current SiteAgent project is the foundation — MMSBUILD means **upgrading this project**, not starting a separate one.
- "MMS" = **MapMyShops** ([mapmyshops.com](https://www.mapmyshops.com/)) — a separate, bigger product the client is already building (image/video content delivery + local business promotion). The hand-off to it ("MMS Bridge") is future work, not part of this build.
- Whether tenants keep logging into Instatic directly, or get a fully separate simple screen — **you'll confirm this later**.
- fal.ai / Firecrawl / WhatsApp accounts are **not set up yet** — free tiers where they exist, otherwise deferred.

---

## 1. The one-paragraph version

A local business (say, a hair salon) has an old, dead, or embarrassing website. MMSBUILD takes that business through one guided journey: read their old site, rebuild it using ready-made professional sections (not from a blank page), let AI write the copy and touch up photos, let the owner approve everything through a simple screen (not the real CMS), publish it, tell them what changed, and then keep quietly improving it every month with a short report. None of the "automatic" steps are actually hands-off, though — it's an **assisted factory**: the backend does most of the work, but an operator on your team reviews and approves at every stage before the client ever sees it. Salons and beauty businesses first. Clinics, restaurants, and other local shops come after. If a business later wants deeper tools (image/video content, local business promotion), that's a hand-off to a separate, bigger product called **MMS (MapMyShops)** — not part of this build.

> Your question:

---

## 2. The big map — what we already have vs. what's new

This is the most important table in this file. It tells us how much of MMSBUILD is "connect the pieces we already built" vs. "build from zero."

| The plan calls it... | What it actually does | Where we stand today |
|---|---|---|
| **Instatic Adapter** | Creates a tenant's site, publishes it, gets the live link | **Already have.** This is our whole `operator/control-plane` + `instatic/vendor` today — a tenant gets a real, working Instatic instance and Publish already ships to Cloudflare. |
| **Resource Control Plane** (AI + media budgets) | Limits/tracks how much AI, images, and video each client uses, and what it costs | **Half have.** Our AI Gateway already hides the API key and controls AI chat per tenant. It does **not** yet control images/video, because there's no image/video generator connected at all. |
| **Client Lite Hub** | The simple screen the business owner actually uses | **Doesn't exist.** Today the owner logs straight into Instatic itself — there is no simplified separate screen. |
| **Operator Hub** | Your team's internal screen — clients, jobs, QA, publishing queue | **Basic version only.** Today's Operator Console just has Settings + a Tenants list. No client/project records, no job queue, no QA checklist. |
| **Import Engine** (Firecrawl + visual-reconstruction) | Automatically reads an old website and pulls out its content | **Doesn't exist.** Today, rebuilding an old site is done **by hand** (a person or an AI agent follows `docs/templateRule.md` and rebuilds the site), then it's imported into Instatic. That import step works — the automatic "read the old site for me" step doesn't exist yet. |
| **Template Library Engine / Site Agent Library** | Ready-made page sections (hero, service list, testimonials...) so AI isn't building from a blank page | **Partly have.** Instatic already has a real plugin system and reusable Visual Components/Templates — the mechanism exists and works. The actual salon-ready library of sections doesn't exist yet. |
| **fal.ai Adapter** | Generates images and short videos | **Doesn't exist.** Nothing today generates images or video. |
| **Asset Vault** | Stores every photo/video used, with its cost and history | **Doesn't exist.** |
| **Approval Engine** | Lets the owner approve or reject before anything goes live | **Doesn't exist.** Today, changes just get published directly — there's no "please approve this" step. |
| **Report Engine** | The monthly "here's what changed" message | **Doesn't exist.** |
| **WhatsApp** | Approvals and leads over WhatsApp | **Doesn't exist anywhere in the current build.** |
| **MMS Bridge** | Hands the client off to a bigger business suite later | **Defined, but future work.** MMS = MapMyShops (mapmyshops.com), a separate product the client is already building (image/video content delivery + local business promotion). Not part of this build yet. |

> Your question:

---

## 3. The client's journey — with one example (Rosa's Salon)

The flowchart your client sent has 10 steps. Here's what they mean using one imaginary business, "Rosa's Salon."

1. **Discover Problem** — Rosa's website hasn't changed since 2016. It looks bad on a phone, and nobody calls from it.
2. **Client Lite Onboarding** — Rosa fills a short form: her business name, her old website link, what she offers (haircuts, coloring, bridal packages), her phone/WhatsApp number, and what she wants ("more WhatsApp bookings").
3. **Website Diagnosis** — Mostly automated: the system crawls Rosa's old site and finds what's missing (no service pages, few photos, no WhatsApp button, slow to load, SEO gaps). Then your team reviews the diagnosis so it's actually accurate before moving on.
4. **Revival Plan** — Semi-automated: the backend suggests what to rebuild (homepage, service pages, FAQs, WhatsApp CTA, images, local SEO). Your operator approves or edits that plan before Rosa ever sees it.
5. **Build Draft** — Backend/agent-assisted: the system uses templates, a content engine, an SEO engine, a media engine, and Instatic to assemble the first draft. Your team QAs and polishes it before Rosa sees the preview.
6. **Generate Assets** — AI writes better copy, touches up or generates photos, maybe a short video loop of the salon interior.
7. **Review and Approve** — Rosa (or your team, on her behalf) sees a preview and either approves it or asks for changes.
8. **Publish Website** — The real site goes live: fast, clean, with a WhatsApp "Book Now" button and her services clearly listed.
9. **Launch Report** — Rosa gets a message: "Here's your new site, here's what we changed, here's what we made for you."
10. **Monthly Freshness** — Every month, small improvements happen and Rosa gets a short report. If she later wants deeper tools (like managing bookings in a CRM), that's where "MMS" would come in — but since MMS isn't defined yet, we treat this last step as not built for now.

> Your question:

---

## 4. The build order — phase by phase

Your client's plan lays out 9 phases (Phase 0 through Phase 8). Here's each one, in plain words, with what we already have and what's genuinely new.

### Phase 0 — Foundation Decisions
**In plain words:** before writing any code, lock down the basic choices — exactly how each piece will talk to each other, what the pricing tiers are (Lite/Growth/Pro), and which business type comes first.
**Example:** deciding "salon is first" and "the Lite plan = 20 AI tasks + 20 images + 15 video seconds a month" happens here, on paper.
**Where we stand:** we already did a version of this for SiteAgent itself (`docs/PLAN.md` and friends) — but not yet for MMSBUILD's new pieces (Firecrawl, fal.ai, Approval Engine, Report Engine).

> Your question:

### Phase 1 — Hub MVP
**In plain words:** build the "control center" shell — a place your team can see every client and their status (Operator Hub), and a place a client can answer onboarding questions and see progress (Client Lite Hub).
**Example:** Rosa fills the onboarding wizard here; your team sees "Rosa's Salon — status: building draft" on a screen.
**Where we stand:** today's Operator Console (Settings + Tenants) is a rough sketch of "Operator Hub," but has no client/project records, no onboarding wizard, and no status beyond "is the tenant's instance running." Client Lite Hub doesn't exist at all yet.

> Your question:

### Phase 2 — Instatic Integration
**In plain words:** connect the Hub to Instatic so it can create a tenant's draft site, publish it, and grab the preview link to show the client.
**Where we stand:** this is mostly done already — the Provisioner already spins up a tenant's Instatic instance, and Publish already ships it live to Cloudflare. This phase is mostly "wire what already exists into the new Hub's own client/project records," not build from zero.

> Your question:

### Phase 3 — Site Agent Library Proof
**In plain words:** build one real, reusable plugin inside Instatic holding ready-made sections (a salon hero, a service grid) so every business gets the same well-designed building blocks instead of AI starting from a blank page each time.
**Where we stand:** the mechanism for this — Instatic's plugin system and reusable Visual Components/Templates — already exists and works today. The actual salon-specific library of sections doesn't exist yet; that's new.

_Note: your client's plan calls this the "Site Agent Library." That's a different thing from this project's own name, "SiteAgent" — just flagging so we don't mix the two up while talking._

> Your question:

### Phase 4 — Import Engine
**In plain words:** automatically read an old website — find its pages, pull out text and photos — instead of a person rebuilding it by hand. For a few important pages (like the homepage), do a more careful copy pass to match the exact look.
**Example:** feed in Rosa's old website link, and the system finds her services, photos, and contact details on its own.
**Where we stand:** the "import it into Instatic" half already works today (Super Import). What's missing is the automatic reading step before that — right now a person still has to rebuild the old site by hand following `docs/templateRule.md`. This phase can't really start until Firecrawl is set up (still pending, per our conversation).

> Your question:

### Phase 5 — Template Library Engine
**In plain words:** teach the system which ready-made sections fit which business type (a salon needs a service grid; a restaurant needs a menu section) so the AI has real structure to fill in.
**Where we stand:** the underlying Instatic mechanism exists; the actual "which template for which business" decision rules don't exist yet.

> Your question:

### Phase 6 — Resource Control Plane and fal.ai
**In plain words:** put a meter and a safety limit on every AI and media request, so no client (or bug) can run up a huge bill, and every generated photo/video is tracked — what it cost, which tool made it, where it's used.
**Where we stand:** our AI Gateway already does exactly this for AI chat (hides the key, limits usage per tenant, has a cost guard). It does not do this for images/video yet, because fal.ai isn't connected. This phase can't start for real until a fal.ai account exists (still pending).

> Your question:

### Phase 7 — Reporting and Monthly Upkeep
**In plain words:** after a site is live, keep it fresh automatically and tell the owner what happened each month, in plain language.
**Where we stand:** nothing like this exists today — once a tenant is live, there's no automatic monthly report or freshness cycle.

**"Live" means:** the first time a tenant's site is actually published — a real public web address anyone can visit, not just a draft sitting inside Instatic.
**"Report" would mean, per the plan:** roughly once a month, a short plain-language summary (what changed, what was added, how many enquiries came in) sent to the owner — most likely over WhatsApp, since that's the plan's main channel for everything else. The plan doesn't say exactly when each month this fires (fixed calendar date vs. days-since-go-live) — not urgent, but worth confirming with the client eventually.

> Your question:

### Phase 8 — Scale and Hardening
**In plain words:** make sure everything holds up once there are many clients running at once — handle failures gracefully, watch for cost spikes, keep every client's data separate, keep a record of who did what.
**Where we stand:** we already have real pieces here — each tenant's data is properly walled off in Postgres (tested and proven), and a crash in one tenant doesn't take down the whole system. Still missing: the current setup only comfortably holds about 5-8 tenants before the database needs upgrading, and there's no cost-spike alerting yet.

> Your question:

---

## 5. What's still open

These are the things we agreed to leave open for now — flagging them again here so they don't get lost:

- ~~**"MMS"** — undefined.~~ **Resolved** — see the Q&A below. MMS = MapMyShops, a separate product, hand-off is future work.
- **Tenant workflow** — whether the business owner keeps logging into Instatic directly (today's way) or gets fully moved to a new simplified Client Lite Hub screen. This decides how big Phase 1 and Phase 2 really are. You said you'd confirm this later.
- **fal.ai / Firecrawl / WhatsApp** — none are set up yet. Free tiers will be used where they exist; Phases 4 and 6 can't really begin until at least a free/trial account exists for Firecrawl and fal.ai.

> Your question:

### Q&A — Can one Instatic instance serve both a "Lite" and an "Advanced" tenant?

**Yes — but the split isn't something Instatic's role system gives us by itself. It's two different mechanisms stacked together:**

1. **Instatic's own roles/capabilities** (already built, working today) — inside Instatic you can create a custom role by toggling ~36 individual permissions ("can edit content," "can manage plugins," "can see Data tables," etc.). This controls what an Instatic user can see/do, but they are still inside Instatic's own admin app. Good for an "Advanced" tenant, or a staff sub-user.
2. **The "Client Lite Hub"** (from the plan — doesn't exist yet, new work) — a completely separate, simple screen (wizard, "approve this," "here's your site," monthly report) that a Lite tenant uses *instead of* ever opening Instatic. It talks to that tenant's Instatic instance behind the scenes, but the owner never sees Instatic's real screens.

So "Lite vs Advanced" is decided **outside Instatic**, at the Hub/Console level — does this tenant get a login link to real Instatic (Advanced), or only a link to the Lite Hub (Lite) — while the exact same Instatic instance quietly powers both.

**Example:** Rosa (Lite) only ever sees "Approve your new homepage?" and never knows Instatic exists. A tech-savvy Advanced client gets real Instatic login and can drag sections around, edit CSS, use the AI chat directly — same tenant, same Instatic instance, different door in.

Your client's own plan already describes this split — section 4.3 calls Instatic "internal operator tool by default... optional advanced editor for power users... not the normal client portal." The genuinely new work is building the Lite Hub itself — Instatic's role system alone won't produce that calm, non-technical feel.

**Known gap:** today's tenant registry (the database table tracking each tenant) has no "plan" field at all — nothing currently records "this tenant is Lite, that one is Advanced." Small but real new work.

#### Follow-up: can the *Operator* assign the tenant's own role (Lite/Pro/Advanced), not just the tenant creating roles for their sub-users?

**Yes — but one hard rule matters here.** Today, custom roles are self-service: the Tenant Admin (logged in as **Owner**) creates roles for *their own* sub-users, after the fact. What you're describing is different — the Operator decides, at signup (like picking a subscription plan), what the tenant's own main account can see.

That's buildable with the same capability-toggle mechanism Instatic already has — **except Instatic's actual "Owner" role can never be restricted.** It's the one fixed, full-access role, reset to full permissions on every server restart (so nobody can lock themselves out of their own site). So:

- A **Lite** tenant must **not** get the real Owner account — they need a **custom role** instead (built from the same 36-capability toggle system), with only what Lite should allow (e.g. edit text/images, use AI chat — no plugins, no user management, no data tables, no direct publish).
- An **Advanced** tenant gets either the real Owner account, or a custom role missing only a couple of things.

So the Provisioner would need to create a plan-specific custom role and hand the tenant *that* login, instead of always creating Owner.

**What's genuinely missing to make this real:**
1. No "plan" field exists yet on a tenant in the registry.
2. Provisioning today only ever creates one thing — the Owner account. Creating a role based on the chosen plan is new work.
3. Upgrading a tenant later (Lite → Advanced) needs a way to change their role after the fact — not built yet.
4. Known open risk (already in your client's plan): Instatic re-creates its own default roles (Admin/Client/Member) on every restart, which could make "only show Lite/Advanced, hide everything else" messier than expected. Unresolved.

> Your question:

### Q&A — What is "MMS Bridge", and is Diagnosis/Plan/Draft automatic or manual?

Asked the client directly; here's their answer, cleaned up.

**What is MMS?** MMSBUILD is only about the website — reviving it, improving pages, SEO/AEO/GEO, WhatsApp enquiries, reports, monthly freshness. **MMS = MapMyShops** ([mapmyshops.com](https://www.mapmyshops.com/)) — a separate, bigger product the client is already building, specialised in image/video content delivery and local business promotion. The "MMS Bridge" hands a qualifying client over to that — explicitly **future work** ("we will be working on it soon next"), not part of this build.

**Is Website Diagnosis / Revival Plan / Build Draft automatic or manual?** None of the three are 100% automatic or 100% manual — the client calls it an **"assisted factory"**: the backend prepares and assembles most of the work, but an operator checks quality, fixes edge cases, and approves before anything reaches the client. Specifically:

- **Website Diagnosis** — mostly backend/automation. Crawls the old site, checks pages/content/SEO gaps/missing services/broken structure/weak CTAs/old images. Then the team reviews it so the diagnosis is accurate.
- **Revival Plan** — semi-automated. The backend suggests what to rebuild (homepage, service pages, FAQs, WhatsApp CTA, images, local SEO, content updates). The operator approves or edits the plan before the client sees it.
- **Build Draft** — backend/agent-assisted. Uses templates, components, a content engine, an SEO engine, a media engine, and Instatic to create the first draft. The team QAs and polishes it before the client sees it.

Early MVP will lean more manual (more operator involvement); automation increases over time. Worth remembering for later: this confirms every stage needs a built-in "operator review/approve" checkpoint — none of Phases 4/5/6 should be designed as fully hands-off, even once automated.

> Your question:

---

_If it's useful, I can also save your client's two original documents into this repo (e.g. under `docs/`) so there's a permanent record alongside this explainer — just say so._
