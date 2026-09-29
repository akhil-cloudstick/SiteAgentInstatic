# Known gaps — found, proved, deliberately not fixed yet

Open defects we have confirmed in code and chosen to defer. Each one records what
it is, how it was proved, what it costs, and what the fix is, so that picking it
up later does not mean re-deriving it.

Rules for this file:

- Tick a box only when the fix is **in code and verified**, never on the strength
  of an intention or a plan.
- Anything in here is **open**. Nothing in here has been reported to the other
  side as closed.
- If a gap turns out not to be real, delete it and say why in the commit, rather
  than leaving a ticked box that means "we decided it did not matter".

---

## 1. The cross-project containment lock was built, tested, and switched off

- [x] **Fixed and verified**

> **Closed 2026-09-25, confirmed against the running stack.** `odRuntime.mjs`
> sets `OD_SANDBOX_MODE=1` and a per-tenant
> `OD_SANDBOX_IMPORT_ALLOWED_ROOTS` of `<that tenant's data dir>/projects`.
>
> Proof, after the rebuild and restart — every live daemon reports its own
> containment from `GET /api/daemon/status`:
>
> | Daemon | `sandboxMode` | Data dir |
> |---|---|---|
> | :7500 | true | `…/siteagent-od/akhil` |
> | :7504 | true | `…/siteagent-od/client-b` |
> | :7505 | true | `…/siteagent-od/global-nettech` |
> | :7506 | true | `…/siteagent-od/sheeltron` |
>
> Four daemons, four different roots — which is the property that matters, since
> one shared root would have re-opened the reach this closes. The configured
> value was also checked directly against the real paths in both directions
> before any restart: A cannot reach B, B cannot reach A, and a traversal out and
> back is refused.
>
> Both pre-flight risks were cleared first: the browser never calls the legacy
> media-generate route that starts demanding a tool token, and opencode does not
> resolve from a user home directory.
>
> **This closes the ROUTE-and-serve half only.** The agent is still a child
> process with shell access, and gap 2 below is the other half.

**What it is.** Each project's files sit side by side on disk:

```
tenant-users/
  ├── client-b/
  └── global-nettech/
```

Routing between them is safe and tested: a login for one project cannot be
redirected to another's daemon. That is the half that holds.

The other half is the agent. Each project runs an `opencode` child with shell
access, which reads and writes files to build the site. It is supposed to stay
inside its own folder. Nothing today stops project A's agent from reading
`tenant-users/global-nettech/uploads/...`.

**The odd part, and the reason this is worth writing down.** The control that
refuses a project root outside the permitted roots already exists, is correct,
and passes its tests. It is simply never switched on. Anyone auditing would find
the lock, find its tests green, and conclude the door is locked.

**Proof.** `isSandboxImportedProjectRootAllowed` is wrapped in
`isSandboxModeEnabled(process.env)` at `OpenDesign/apps/daemon/src/projects.ts`
lines 112 and 124. `OD_SANDBOX_MODE` is set nowhere outside the test suite — in
particular the control plane's daemon env block
(`Operator/control-plane/runtime/odRuntime.mjs`, ~line 272) does not set it, so
the guard short-circuits and the allow-check is never reached.

Both states are pinned in
`OpenDesign/apps/daemon/tests/cross-project-containment.test.ts`, deliberately:
the "production today" case asserts that a sibling project root **is** allowed,
so nobody reads the ten passing sandbox test files and concludes the containment
is live.

| | Result |
|---|---|
| Lock on | project A's agent → project B's folder = **blocked** |
| This server today | project A's agent → project B's folder = **allowed** |

**Cost.** A risk, not damage. Nobody has done it; it needs an agent to be
instructed to. There is one real client today.

**Why the flag is not a one-line change.** `OD_SANDBOX_MODE` gates five
subsystems, not one:

| Where | What turning it on does |
|---|---|
| `projects.ts:112` | the containment we want |
| `runtimes/env.ts:270` | relocates agent home, cache, config, logs, temp, plugin + skills state under `OD_DATA_DIR` |
| `runtimes/local-profiles.ts:38` | agent profiles config moves under the sandbox agent home |
| `media/config.ts:297` | stops borrowing the OpenAI key from `~/.codex/auth.json` |
| `media/config.ts:325` | stops borrowing the xAI OAuth token from `~/.hermes/auth.json` |

The prerequisite is already satisfied: `OD_DATA_DIR` is set per daemon at
`odRuntime.mjs:282`. Without it sandbox mode silently no-ops, so this is what
makes the flag safe to turn on at all.

**The fix.**

1. Pre-flight: find whether any live tenant uses an *imported-folder* project. If
   none, this is near-zero risk; if some, the allowed roots must cover them or
   they break.
2. Add `OD_SANDBOX_MODE` and `OD_SANDBOX_IMPORT_ALLOWED_ROOTS` to the daemon env
   block in `odRuntime.mjs`.
3. Invert the "production today" case in `cross-project-containment.test.ts` — it
   becomes the regression test for the fix.
4. Confirm the four side effects above do not break the live stack. Media
   credentials should be irrelevant because AI runs through the operator-managed
   gateway, but that must be checked rather than assumed.
5. Make a daemon refuse to start if the lock is missing, so this cannot silently
   revert.

**Open questions to answer first.**

- Confine each daemon to its own project dir only, or to the whole `tenant-users`
  tree? Own-dir-only is the real fix; the tree is weaker but safer if anything
  shares paths.
- vitest cannot run on this share, so verification needs a plain Node harness
  against the compiled module.

**Why deferred.** It changes how every project daemon starts and needs all of
them restarted. Better found with five projects than fifty — but not in the
middle of an acceptance round with the validator.

---

## 2. Switching that lock on is still not an OS-level jail

- [ ] **Fixed and verified**

**What it is.** Gap 1's fix is real hardening, but it must not be reported as
closing the whole class. `OD_SANDBOX_MODE` governs **which imported project roots
OD will serve**, and **where the agent's own runtime directories live**. It does
not confine the child process.

The agent is an `opencode` child with shell access. Nothing in that flag stops it
reading a sibling path directly — the flag decides what OD will *register and
serve* as a project, not what a process with a shell can *open*.

**Cost.** After gap 1 is fixed, the remaining exposure is a deliberately
instructed agent reading another project's files by absolute path.

**Investigated 2026-09-25. Not built, and the reason is specific.**

Three routes were examined. Two are closed on this platform, and the third is
real but cannot be switched on blind.

| Route | Verdict |
|---|---|
| A Windows account per daemon | **Closed.** Node's `spawn` has no `uid`/`gid` on Windows — those options are POSIX-only. Running each daemon under its own principal needs `CreateProcessAsUser` through a native helper, or an external tool. And while every daemon runs as the SAME user, directory ACLs cannot separate them: an ACL keys on the principal, and there is only one. |
| One container per project | **Closed by an existing decision**, not by difficulty. `provision.mjs` opens with "No Docker: each tenant is a native Bun Instatic process". Reversing that is an architecture call, not a patch. |
| opencode's own directory permissions | **Open, and the promising one.** See below. |

**The third route, in detail.** opencode already has a directory permission
policy: `permission.external_directory` is an allowlist written into its config
(`apps/daemon/src/mcp-config.ts:509`, built by
`buildOpenCodeExternalDirectoryAllowlist`). So the mechanism for confining the
agent to its own project directory exists and is already wired.

It is overridden. The daemon appends `--dangerously-skip-permissions` whenever
opencode reports supporting it (`runtimes/opencode-permissions.ts:14`), which is
unconditional in practice.

**Why that flag was not simply removed.** Because "prompt" and "deny" are not the
same thing, and only one of them is safe here. If opencode's response to a path
outside the allowlist is to ASK, then a daemon with no human attached does not
get a refusal — it gets a hang, on every run, for every tenant. Turning this on
without first establishing which of the two opencode does would risk taking down
the whole estate to close a gap nobody has exploited. That is a worse trade than
the gap.

**Settled 2026-09-28, by reading rather than running — and the answer is not the
one that was hoped for.**

Two things were established.

First, headless opencode **auto-rejects** an unlisted external directory; it does
not wait for a prompt. That is stated in our own daemon
(`apps/daemon/src/mcp-config.ts:415`, whose comment records it as verified
against opencode's own config source): the daemon grants `external_directory`
for the project cwd precisely "so headless OpenCode runs do not auto-reject
them". So the hang risk that made this route too dangerous to try does not exist
for directories, and the fear that stopped us was misplaced.

Second, and this is why it does not close the gap: that allowlist is **already
scoped to the project's own directory**. `server.ts:11771` passes
`allowedDirectories: [effectiveCwd, ...extraAllowedDirs]` — the project cwd and
a few staged directories, nothing broader. The control is on, it is narrow, and
the agent can still reach a sibling project.

Which tells us what `external_directory` actually governs: opencode's own
external-directory feature — the workspace it will serve — and not what a shell
command can open. A `cat` of an absolute path is a bash invocation, not a
directory grant, and bash is squarely inside what
`--dangerously-skip-permissions` waives.

**So the third route is narrower than it looked.** Constraining the agent's file
reach means constraining BASH, which is what that flag waives wholesale. Removing
it would put every bash command through opencode's permission path, and that is
where the original hang concern genuinely applies — not to directories, but to
commands, on every run, with nobody attached to answer.

**Where that leaves the gap.** Route A (an OS account per daemon) and route B (a
container per project) are unchanged and remain the honest answers. What has
changed is that route C is no longer a cheap unknown waiting on an experiment: it
is understood, and it does not do the job. Anyone picking this up should start at
A or B rather than re-investigating the permission config.

**Why still open.** Both remaining routes are architecture decisions rather than
patches, and neither has been chosen.

---

## 3. The MCP server hid custom tables from agent keys

- [x] **Fixed and verified**

> **Closed 2026-09-25, confirmed against the running stack.**
>
> The bridge was rebuilt to 1.1.0 and reinstalled on five of the six projects.
> Before the reinstall every tenant answered `Plugin route not found` on
> `/cms/api/cms/plugins/mms.mcp-bridge/runtime/health`; afterwards the five
> answer `Unauthorized`, which is the route existing and refusing an
> unauthenticated caller rather than the route being absent.
>
> That also proves the part which could not be tested directly. `installBridge`
> uploads the manifest and the CMS validates it against the schema, so a manifest
> carrying `"table": "*"` would have been REJECTED if the widened schema were not
> in the running build. Five installs succeeded, so the schema change is live.
>
> **Not installed on `akhil`, deliberately.** That project cannot be reached by
> this route at all — see the note below — and nothing agentic works on it.
>
> **What was not directly observed:** an actual `cms_list_tables` call returning a
> custom table, which needs an agent key and a project that has one. The
> behaviour is covered by `contentAccessWildcard.test.ts`, and the validator's
> own acceptance run exercises it for real.

### A dead end this exposed, worth recording

A platform administrator who ALSO holds a person account on a project cannot
install the bridge there, and there is no way through from the console:

- `canOpenWork` (`lib/scope.mjs:84-88`) requires a platform administrator to hold
  a matching act-as grant, with no exception.
- `openGrant` (`registry/actAs.mjs:50-51`) refuses to create one when the
  administrator's own email already has an account on that project — correctly,
  and its comment says why: they "would be upgrading their own standing access
  under a different name, which is the opposite of a record".

So the two rules lock. `openGrant` is right; `canOpenWork` is the incomplete one,
because it treats "platform administrator" as always meaning "an outsider
reaching in" and never asks whether the person already holds standing access
under their own name — in which case their actions are recorded against them
anyway, which is what the control exists to guarantee.

Left alone on purpose: it decides who may open a customer's work, the validator
is actively testing that class (AC-A5.1), and `akhil` does not need the bridge.

Pre-existing and unrelated to the two above; recorded here so the list is one
list.

> **Status 2026-09-25 — fixed in code, awaiting a rebuild.** See below.

**What it is.** The original note said "only the four system tables", which was
imprecise. The manifest enumerates about twenty. The defect is that it is a
STATIC list: `contentAccess` names tables by slug, and a custom post type cannot
appear in a manifest written before it existed. So such a table was not refused —
it was invisible. An agent asking "what content is here" was told a subset, with
nothing to indicate it was a subset.

Found at `Instatic/server/plugins/host/handlers/content.ts:126`, where the
listing is filtered to the manifest's declared slugs.

**The fix.** `contentAccess` now accepts `{ "table": "*" }`, meaning every
content table, and the MCP bridge's manifest declares it. Three properties were
kept deliberately and are pinned by tests in
`server/plugins/host/contentAccessWildcard.test.ts`:

- it is declared, never implied — no manifest gets it by accident
- the row's `modes` still bound it, so `"*"` with `["read"]` grants reading every
  table and writing none
- an exact row still wins over the wildcard, so a narrower rule can be written

It also does not widen what any individual agent sees: the MCP gateway narrows
per key on top of this (`mcp/permissions.mjs` `tableAllowed`), so a key scoped
to two tables still sees two tables through a plugin holding `"*"`.

One thing this nearly broke, worth recording: the manifest schema validates
`table` against a slug pattern, so `"*"` would have failed validation and stopped
the plugin loading at all — taking the whole MCP surface with it. The schema was
widened in the same change (`src/core/plugins/manifest.ts`), and the existing 24
manifest tests still pass.

**Why the box is unticked.** The change is in Instatic's TypeScript, which the
tenants serve from a prebuilt bundle. It is not live until that is rebuilt.

---

---

## 4. The control plane's audit log is editable; the two tables that are not, are the ones we test

- [x] **Fixed and verified**

> **Closed 2026-09-29, confirmed against the live database.** Both tables now
> refuse tampering at the database, and the two took different shapes — which was
> the whole difficulty.
>
> `admin_audit` is unconditional, like the receipts: nothing in the repo ever
> updates or deletes a row in it (searched across `Operator/` and `Connector/`,
> zero hits), so an administrator action is simply a fact about the past.
>
> `mcp_agent_audit` **could not** take that pattern, and an unconditional trigger
> there would have broken the platform rather than an attacker:
> `propagate_tenant_address()` (schema.sql:350) rewrites `business_id` on every
> row of it when a project moves to another Business, and the migration at :409
> backfills the same column. So it is frozen EXCEPT its two address columns —
> which agent key called which tool against which project, and whether it worked,
> are all immutable; the address may be restamped. `tenant_slug` is frozen
> deliberately, even though the stamping trigger's `update of tenant_slug` clause
> anticipates it moving, because an audit row whose subject can be reassigned
> proves nothing about the subject it originally named.
>
> **Proof, on the running system:** `information_schema.triggers` reports all
> eight immutability triggers live (was four). Editing and deleting a REAL
> `admin_audit` row, a real `mcp_agent_audit` row and a real deploy receipt are
> each refused with the trigger's own wording — every probe run inside a
> transaction that was rolled back, so the live audit was never actually altered
> even had a refusal failed to fire. Inserts still work on both tables, which the
> platform depends on constantly. 47 existing rows (34 + 13) became immutable.
>
> **Checked before applying, not after:** nothing prunes these tables by age. The
> only retention in the control plane is `receipt.mjs` pruning kept *bundles* on
> disk, so no job starts failing.
>
> **Pinned from both sides in `triggers.selftest.mjs`** (30 checks, was 17), and
> the positive case is driven through the REAL path rather than a hand-written
> UPDATE: moving a project to another Business fires the propagation, and the
> audit row must be re-addressed while its content stays frozen. Proven by two
> reversals — removing the four new triggers fails 13 checks, and making
> `mcp_agent_audit` unconditionally immutable fails the platform case
> ("moving the project to another Business still works"). The second reversal is
> the one worth having: it is the mistake a later reader is most likely to make.
>
> The test no longer merely *asserts* this gap — it tests the fix.

**What it was.** Security class E9 is "audit tampering". Four record stores in the
control plane matter to it, and only two of them were actually protected:

| Table | What it holds | Protection |
|---|---|---|
| `deploy_receipts` | what went live, and whether it verified | **append-only, by trigger** |
| `ai_spend` | what was spent, per project per month | **append-only, by trigger** |
| `admin_audit` | **every administrator action** — including rollbacks, act-as entries, spend-cap raises | address stamping only |
| `mcp_agent_audit` | every tool call an agent key made | address stamping only |

The two with nothing are the two that matter most. `admin_audit` is the answer to
"who did this", which is the question an audit trail exists to settle, and any
role holding the database console can rewrite a row in it or delete it outright.
The receipts are safe; the record of who ordered them is not.

**How it was found.** By writing the E9 tests
(`Operator/control-plane/registry/triggers.selftest.mjs`) and noticing that the
protected set was smaller than the class. The gap is now **asserted rather than
assumed** — that test ends with a check named `KNOWN GAP: admin_audit has no
immutability trigger` which passes on `false`, so if someone adds the trigger the
check fails and points here. The gap cannot quietly stop being true, and it
cannot quietly stay true either.

**Proof.** In `registry/schema.sql`, `deploy_receipts` and `ai_spend` each get an
`_immutable()` function plus `_no_update` / `_no_delete` triggers (lines 653-665
and 736-748). `admin_audit` gets one trigger, `admin_audit_stamp_address`
(line 534), which fills in `business_id` / `operator_id` on insert.
`mcp_agent_audit` likewise (line 333). Neither refuses anything.

**Cost.** It does not open a new way in: writing to these tables still needs the
admin database role, which is the control plane's own. What it costs is the
guarantee — the difference between "this log is append-only because the code only
ever inserts" and "this log is append-only because the database refuses", which
is the entire distinction E9 draws. The first holds until someone with the
connection string decides otherwise, including to cover their own tracks.

**The fix, and why it is two different jobs.**

`admin_audit` is the easy one and should be done first. Nothing in the repo ever
updates or deletes a row in it — searched, and there are no hits — so the same
unconditional pattern the receipts use applies verbatim:

```sql
create or replace function siteagent_control.admin_audit_immutable() returns trigger ...
create trigger admin_audit_no_update before update on siteagent_control.admin_audit ...
create trigger admin_audit_no_delete before delete on siteagent_control.admin_audit ...
```

`mcp_agent_audit` **cannot** take that pattern, and this is the part worth knowing
before starting. Its rows are legitimately updated: `propagate_tenant_address()`
(schema.sql:350) rewrites `business_id` on every row of it when a project moves to
another Business, and the migration at line 409 backfills the same column. An
unconditional refusal would break re-addressing a project. So that one needs a
column-scoped guard — refuse any change except to `business_id` / `operator_id`,
the shape the relay's frozen-field triggers already use — or the propagation has
to be reworked to stop touching audit rows at all.

Whichever way, the fix ends with those cases added to
`triggers.selftest.mjs`, including the positive one: re-addressing a project must
still work afterwards. A trigger that is too strict here fails the platform rather
than an attacker.

**Why deferred.** It was found inside a task whose scope was *testing* what
exists, and closing it there would have meant shipping an untested schema change
and a test written against it in the same breath — which is how a control gets
believed without being proved. It is small, it is understood, and it wants its own
change.

---

## 5. The push robot signs in as a real person on one project, so MFA cannot be turned on for them

- [ ] **Fixed and verified**

**What it is.** The automated push authenticates to each project's CMS before it
writes. Which account it uses is decided by one line — `connector_email ||
owner_email` (`Operator/dev.mjs`) — a dedicated robot account where one exists,
and the project owner's own login where one does not.

On one project that fallback lands on **a real person's personal address**:

| Project | The push signs in as | |
|---|---|---|
| sheeltron | `sheeltron@tenant.local` | dedicated |
| akhil | `connector@cloudstick.io` | dedicated, but **shared with client-b** |
| client-b | `connector@cloudstick.io` | the same account |
| acceptance-scratch | `acceptance-scratch@tenant.local` | machine-provisioned |
| sheeltron-staging | `sheeltron-staging@tenant.local` | machine-provisioned |
| **global-nettech** | **`gear1.dinesh@gmail.com`** | **a person** |

**Why it is a deadlock rather than untidiness.** The CMS demands a step-up
before a clean-site import or a full publish, and step-up asks for a 6-digit code
when the account has MFA enabled (`if (user.mfaEnabled && !hubPersonId)` in the
CMS step-up handler). So on `global-nettech` there is no good option:

- turn MFA on → every push stalls waiting for a code no machine can supply, and
  AC-C13.2 (zero developer round trips) cannot pass;
- leave MFA off → a real person's login has no second factor.

The two uses have to be separated before either can be made right.

**How it was found.** Answering the checking side's question on relay T-000011
(inbox 0051): "are the nine step-up accounts used only by the Connector, or are
they logins people also use?" — a good question we had not asked ourselves. All
nine accounts across the six active projects currently have MFA off, so nothing is
broken today; what is missing is the ability to turn it on.

**Cost.** No exposure that is not already there — the push already holds this
credential and the platform already stores it. What it costs is a control we
cannot switch on: a person's account that must stay password-only for a machine's
convenience.

**The decision, already taken.** The owner settled the policy on 2026-09-29 (relay
M-000121): accounts used only by the push are dedicated service accounts,
password-only by design and recorded as such; every login a person uses gets MFA.
Concretely — one dedicated Connector account **per project**, the shared one split,
`global-nettech` moved onto its own, and MFA switched on for the two human logins
that have it off.

**The fix, and why it is deferred.** Three steps, and the last one is not ours:

1. Create a dedicated CMS user per project that lacks one.
2. Point the registry at it (`connector_email` + `connector_password_enc`).
   `Operator/scripts/repair-connector-credential.mjs` already does the pairing and
   verifies the login before writing, but nothing creates the user — that part
   would be written by hand into live client databases (Sheeltron, Global Nettech,
   client-b).
3. Switch MFA on for the two human logins. **This one ends with two people and
   their phones**: enabling the flag without the person having enrolled an
   authenticator locks them out of their own CMS.

Deferred deliberately on 2026-09-29: steps 1 and 2 write into live client systems
and step 3 cannot be done by us at all, so this is a coordinated change with real
people rather than a patch. Not a PRD requirement — it came out of the acceptance
conversation and the owner's policy decision, so it gates nothing on the board.

## Not in this file

Anything already reported to the other side, and anything the acceptance run
covers. Those live on the board. This file is only for what we found ourselves
and chose to leave.
