# Moving the platform to Cloudflare Workers — the four answers

Asked on relay T-000011, inbox 0053, and re-scoped by 0054: the move is a
**possibility the owner wants to discuss**, not a decision. Nothing here has been
started, and nothing should be until that discussion happens.

Written to inform the discussion. Where we are not certain of a Cloudflare
detail, it says so rather than guessing — a migration plan built on a guess about
the platform underneath it is worth less than no plan.

---

## 1. Migration plan and estimate

The platform is four things today, and they do not move alike. Sorted by how well
they fit Workers, best first.

### Already there

**The relay.** A Worker with D1 and R2, in the owner's account. Nothing to do,
and see §3 — it should stay exactly where it is.

### Moves reasonably

**The control plane and sign-in.** Node ESM and Postgres. The HTTP surface,
sessions, the admin gate and the registry reads are ordinary request/response work
that Workers do well. Postgres reaches a Worker through **Hyperdrive**, so the
schema and the append-only triggers survive as they are — which matters, because
those triggers are the E9 control.

**What does not survive:** the control plane's main job today is *supervising child
processes* — spawning a CMS per project, a design daemon per project, restarting
them with backoff, probing ports. A Worker has no children to supervise. That
logic does not port; it is replaced by whatever orchestrates containers, and it is
a rewrite rather than a move.

**Estimate: 5–8 days**, most of it in the orchestration replacement, not the HTTP.

### Needs a container

**The design workspace agent.** It runs `opencode` as a child process with a
shell. Plain Workers have no processes and no shell, so this cannot be a Worker at
any price. It needs **Containers** or the **Sandbox SDK** — see §4.

This is also where the E2 gate is settled as a side effect: one isolated container
per project is exactly the separation the 25 Sep gate asks for. That is the
strongest argument for the whole move, and it is worth saying plainly.

**Estimate: 8–12 days** for the agent to run in a container per project, with the
project's files mounted and nothing else reachable. Wide because it depends on §4.

### The hard one

**The CMS.** See §2 — it is the reason this is a migration and not a port.

### Order

1. Relay stays put.
2. Containerise the design agent first. It is the piece that cannot be a Worker,
   it closes the E2 gate, and it is independent of the rest.
3. Control plane and sign-in to Workers, with Hyperdrive to the existing Postgres.
4. The CMS last, once §2 is decided.

**Whole-migration estimate: 6–10 weeks**, and we would not stand behind the upper
half of that until §2 and §4 are answered. Anyone quoting a tighter number is
quoting the HTTP work and ignoring the runtime.

---

## 2. What becomes of the CMS

Instatic today is a **long-running server process per project** with:

- a Postgres schema per project
- a filesystem it reads and writes: `uploads/`, the baked `published/` tree served
  off disk before any database query, and a prebuilt admin bundle in `dist/`
- an in-memory render cache and publish-version counter
- collab CRDT documents held in memory and persisted on a debounce

Only the first of those fits Workers unchanged. The rest are all *state held by a
process*, and a Worker is not a process that stays up.

**Two honest routes:**

**(a) Run the CMS in a Container.** It keeps working as written. Volumes replace
the local filesystem. This is the low-risk route and the one we would choose if
the move happened tomorrow. The cost is that the CMS is then not really "on
Workers" — it is a container Cloudflare happens to run.

**(b) Port it properly.** Postgres via Hyperdrive; `uploads/` and the baked
`published/` tree to **R2**; the render cache to a **Durable Object** per project
(which is also the natural home for the collab CRDT documents, since a Durable
Object is single-instance and coordinates exactly the way that cache and those
documents need); the admin bundle to **Workers Static Assets**.

Route (b) is the right destination and it is a **rewrite of the CMS's entire I/O
layer**, touching publish, preview, media and collab. We would not attempt it in
the same change as the platform move. **Estimate for (b) alone: 4–6 weeks**, and
that is the number we are least confident in.

**Recommendation:** (a) to move, (b) later if it is ever worth it. Say so now,
because doing (a) and calling it "on Workers" would mislead whoever reads the
architecture later.

---

## 3. Which Cloudflare account

**The relay must stay in the owner's account, and the platform must not be in it.**

That separation is the point of the relay: the platform cannot approve its own
changes. If the platform's Workers, its D1 and its R2 sat in the same account as
the relay, whoever holds that account's API token could edit the approval record
and the deploy receipts — and those are precisely the stores E9 makes append-only
at the database so that *no one* can. An account boundary is the only thing
keeping that honest once both sides are Cloudflare resources.

So:

- **Owner's account:** the relay, and nothing else.
- **A separate platform account:** the control plane, the CMS, the design agent,
  their D1/R2/Hyperdrive bindings, and the Pages projects for client sites.
- The platform's deploy credentials must have **no access** to the owner's
  account, and the relay's must have none to the platform's.

This is a stronger requirement after the move than before it, not a weaker one:
today the separation is partly physical (one is a Worker, one is a server in an
office). Afterwards, both are Cloudflare, and the account boundary is all that is
left.

---

## 4. Sandbox while it is a preview

**Our position: build on Containers, not Sandbox, for anything a client depends
on.**

Sandbox is the better fit on paper — it is built for exactly this, an AI agent
running untrusted code in an isolated Linux environment, and it would give us the
E2 separation with less of our own machinery. We would rather use it.

But it is a **1.0 preview**, and this platform's one live client runs real sites
through the design agent. A preview API can change shape, and what we would be
putting on it is the piece that cannot fall back to anything — there is no
"without the sandbox" mode for an agent that needs a shell.

**What we would do:**

- Build against **Containers** (generally available on Workers Paid), keeping the
  agent's launch behind one interface.
- Keep that interface narrow enough that swapping in Sandbox later is a small
  change rather than a second migration.
- Revisit when Sandbox is GA, or sooner if Containers proves awkward for the
  per-project isolation and Sandbox clearly solves it.

If the owner would rather take the preview risk to get the isolation sooner, that
is a legitimate call and we will build it — we would want it recorded as a
decision, with the reason, the way E4's thresholds were.

---

## What we have not verified

Stated so none of the above is read as more settled than it is. These come from
Cloudflare's documentation as the checking side quoted it, not from us having
built on them:

- Containers' exact limits on this account tier — CPU, memory, run duration, and
  how many can run at once. The estimates assume a container per project can stay
  up for the length of a design run; if it cannot, the agent's architecture
  changes and §1's second item grows.
- Whether Hyperdrive reaches the Postgres this platform uses, at the version it
  uses.
- Sandbox's isolation guarantees in detail. We have taken "its own isolated
  container with a full Linux environment" at face value; for an E2 decision we
  would want to read it properly first.

None of these blocks the discussion. All of them would need answering before
anyone commits to a date.
