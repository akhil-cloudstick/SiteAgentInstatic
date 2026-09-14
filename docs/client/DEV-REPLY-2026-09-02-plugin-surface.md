# Reply — the plugin surface · 2026-09-02

All seven answered from the source, with the numbers. Two of them change your design, one
of them the way you already guessed.

**Your §2a was right and is fixed** — we tightened the gate rather than the sentence. §2a.

---

## 1. Yes, the runtime is live on the tenants you are using

Measured with your own 401-vs-404 technique, on `sheeltron`:

| Request, no auth | Result |
|---|---|
| `/cms/api/cms/plugins` | **401** — the route exists |
| `/cms/api/cms/not-a-real-route` | **404** |

Every tenant runs the same build and nothing disables the runtime. **You have never seen a
plugin screen because you have never been able to open the admin UI at all** — that is the
invite-link defect, fixed in the note alongside this one. Log in with the link we just sent
and Plugins is there.

So this is a build conversation, not a roadmap conversation.

## 2. Who installs — a human, and we just made that firmer

**Today: no programmatic path, and you read the code correctly.** Install is HTTP-only,
behind `plugins.install` plus step-up. You already verified `installPlugin()` has no caller
outside the handler and tests, and the connector's 34 tools do not touch plugins.

After the fix in §2a it is firmer still: step-up on those routes now ignores the user
preference, so an install requires a **fresh password entry** at the moment of installing.
An agent cannot satisfy that without holding the owner's password, which is not a design we
would endorse.

**But "permanent" is the wrong answer to your actual problem**, so we would rather not give
it to you.

The human gate is worth having on *"is this code allowed to run in a CMS"*. It is worth
nothing on *"type the same approval fifty times"* — the fiftieth click is not a decision,
it is fatigue, and fatigue is how a bad plugin gets waved through. Those are two different
acts and today we conflate them.

The shape that keeps the boundary and removes the repetition: **approve once, apply many.**
A human approves a specific plugin *version* — a manifest hash and its permission set —
with step-up, once. That approval is then redeemable across named tenants without a
re-approval, because the decision has already been made and nothing about it changes per
site. Anything not matching that exact hash and permission set falls back to a fresh human
approval, so a plugin that gains `network.outbound` in v1.4 stops the line.

Your `staged` endpoints are already half of this: they separate "uploaded and inspected"
from "approved and running". The missing half is making one approval apply to more than one
site.

**We have not built it and are not proposing it as part of your three plugins.** It is worth
doing at the point you have enough clients for the repetition to be real, and we would
rather build it then, with your fifty-client shape in front of us, than guess at it now.
Tell us when you are approaching that and it becomes a real conversation.

## 2a. §2a — confirmed, and fixed by tightening the gate

Your reading of the code was exactly right. The dispatcher called
`requireStepUp(req, db, user)` with no options, so it took `policy: 'user'`, which returns
`null` when the caller's `stepUpAuthMode` is `'disabled'`. Every `plugins.install` route
fell back to the capability alone for anyone who had turned the preference off.

You offered it as an observation and said you would accept the softer reading. **We took
the other option**: the docs described the boundary correctly, so we made the
implementation match rather than qualify the sentence.

Install, zip upgrade, pack install and uninstall now use `policy: 'always'` — they ignore
the user preference entirely. The reasoning is the one you implied: on those four routes
the step-up is not protecting a user from their own convenience trade-off, it is the
boundary protecting every site on the instance from a stolen session. **The same rule
already applied to the route that changes the setting**; this extends it to the other
action that cannot be undone by learning about it afterwards.

Deliberately unchanged: `inspect-package` and the staging endpoints still honour the
preference, because neither runs anything. Lifecycle routes (enable / disable / restart)
also keep it — those run hooks of code approved at install, and folding them in would have
been a scope change nobody reviewed. Say if you think that line is in the wrong place.

Four tests pin it, including that a bare `requireStepUp(req, db, user)` cannot come back.
The docs now state the qualifier explicitly.

**On the approver being Admin and not only Owner** — correct, `adminCapabilities` includes
`plugins.install`. That is deliberate, and worth you knowing when you decide who at a
client holds Admin.

## 3. Budgets — and yes, you must queue

The numbers:

| Surface | Budget |
|---|---|
| Server entrypoint eval (hooks, filters) | **5,000 ms** in-VM |
| Module pack eval | 2,000 ms |
| Host-side worker RPC | 30,000 ms |
| **Schedules** | the schedule's own declared `maxDurationMs`, plus 10 s RPC slack |

Per invocation, not per worker.

**So your instinct is right and you should build the queued version from the start.** A 3-30
second call to your SEO engine cannot run inside a `publish.before` hook or a
`content.entry.cells` filter — 5 seconds is the ceiling and 30 seconds is not close. The
shape that works is the one you sketched: `cms.schedule` does the calling with a
`maxDurationMs` you set, results are stored, and the hook or filter only reads what is
already there.

That also means a `publish.before` that merely *checks* a field is fine — that is a fast
local read, not a network call.

## 4. `content.entry.cells` **persists**

The filter runs **before persistence**, in both write paths (`data/rows.ts`,
`data/tables.ts`). The returned cell map is what gets written.

So you get the version you wanted: the generated `seoTitle` is sitting in the field when
the client opens the CMS, they can edit it, they can overrule you, and the value that
publishes is the value they saw. No decorate-at-render divergence to audit.

You may still prefer `cms.content.write` on a schedule for the SEO engine specifically —
because of §3, not because of this. The filter is the right tool for something fast and
deterministic; the slow network call belongs in the schedule either way.

## 5. Per-site, all of it

Each tenant is a **separate Instatic process** with its own database schema and its own
uploads directory — `UPLOADS_DIR` is set per tenant by the control plane. So:

- `uploads/plugins/<id>/<version>/` is **inside that tenant's own uploads directory**.
  Installing on one site does not install on another.
- Plugin rows and `settings_json` — including `secret: true` values — live in **that
  tenant's schema**, not a shared one.

**A plugin holding one client's engine key cannot be reached from another client's site**,
because the other site is a different process, a different database and a different
directory. The boundary you were designing around already exists as process isolation
rather than as a scoping rule that could be got wrong.

The corollary is the operational cost: fifty clients means fifty installs — which is your
§2, answered above: a human does each one today, and "approve once, apply many" is the shape
that fixes it without lowering the gate.

## 6. Private hosts are blocked, regardless of the manifest

`isBlockedAddress` rejects loopback, RFC1918 private, link-local, CGNAT, unique-local and
unspecified ranges. The allowlist and the address check are **both** applied, and re-applied
on **every redirect hop** — so a public host that redirects to `10.x` is refused at the hop,
not just at the first request. There is no override, no environment escape.

So **put the narrow public shim in front of each engine**, as you anticipated. `fetch()`
resolves the host and checks the resolved addresses, so a public DNS name pointing at a
private address is refused too — the shim needs to be genuinely reachable, not just
publicly named.

## 7. `frontend.assets[]` is baked into the published HTML

It is spliced in by the publish pipeline (`publishedHtmlPipeline`, and the same path on
republish), not injected by a runtime. The tag is in the static file the CDN serves.

The CSP is relaxed for exactly those declared assets, which is also why they have to be in
the manifest rather than added at runtime.

**So your analytics plugin works.** The public callback route you sketched is
`cms.routes.public`, which is served by the tenant's own instance rather than the CDN — so
the tag is static and the callback is dynamic, which is the split you want anyway.

---

## Your three sketches

**SEO plugin — right, with §3 applied.** Schedule calls the engine, writes through
`cms.content.write`, `publish.before` does a fast local check for an empty
`seoDescription` or a mismatched canonical. Nothing generated goes live without appearing
in the CMS first, which §4 gives you for free. We would build exactly this.

**Marketing-data plugin — the safest of the three, and deliberately so.** A `resource`-kind
admin page stays host-rendered, so you ship no unsandboxed admin code and never need
`editor.code`. Read-only, no publish hooks. "A panel, not an author" is the right framing
and we would not change anything.

**Analytics plugin — unblocked by §7.** Build it.

## On the disclosure you volunteered

We think you are right, and the shape you describe is the one we would want too.

Today the install flow captures **granted-equals-declared** permission grants, and
`networkAllowedHosts` is visible in the manifest — so the *facts* are all present at the
moment of approval. What is missing is the sentence: nothing renders "this plugin will send
content to `seo.yourdomain.com`" in the language of the person approving it.

That belongs in the install confirmation, next to the permission list, and we would rather
build the surface than have each plugin describe itself in its own words in a README nobody
opens. If you sketch what you would want it to say for the SEO plugin — the one that
genuinely does send client content outward — we will build the surface to fit it.

You raised it unprompted, in the same shape as the `create_site` boundary we raised at you.
That symmetry is worth keeping.

---

## Verified

| | |
|---|---|
| Plugin runtime live on tenants | 401 on the route, 404 on a bogus one |
| Install step-up | `policy: 'always'` on all four RCE routes |
| Step-up tests | 4 new, plus the existing account-security suite — **20 pass** |
| Instatic typecheck | clean |

Nothing here needed a restart to answer. The step-up change ships with the next one.
