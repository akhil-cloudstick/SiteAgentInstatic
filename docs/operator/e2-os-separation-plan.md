# Per-project OS separation — plan and estimate (security class E2)

> **NOT PART OF THIS PROJECT'S SCOPE.** The PRD defines E2 as "Network and tool
> allowlists enforced" (mmsbuild-prd.md:458) and mentions containers, operating-system
> accounts and process isolation nowhere. That requirement is built, live and tested.
>
> This document exists because we raised the OS-level jail ourselves, as gap 2 in
> known-gaps.md, and then produced an estimate for it. It is kept only so the numbers
> exist if the owner ever raises it as a change request. It is not a completion item
> and does not gate the milestone.
>
> **AND THERE IS NO DECISION PENDING FOR ANYONE.** An earlier version of this document
> asked the owner to choose between the two routes by answering "does the platform stay
> on Windows?". That question should never have been put to them. The deployment OS is
> not fixed — it is decided at deployment time — so an isolation design that depends on
> the host OS cannot be specified in advance, and whichever runtime it eventually lands
> on is what would provide the mechanism. Both routes below are therefore hypothetical
> until there is a known target, and neither is waiting on an answer.

Asked for by the checking side on T-000011. Written for the owner, who chooses the
route, and for whoever builds it.

---

## The argument that changes this, and why we accept it

Our previous position was that the remaining exposure needed a **deliberately
instructed** agent — so with one live project and nobody instructing it, the risk
was tolerable. That reasoning no longer holds, and the reason is our own E3 work.

Prompt injection means the instruction does not have to come from a person. It can
arrive inside a page the agent is asked to read. We built a server-side refusal for
that in E3, and it refuses on nine high-confidence markers — a deliberately narrow
list, chosen so ordinary content is not refused, which means it is **not** a
guarantee that no instruction ever gets through. A control that admits it will miss
things cannot also be the thing that makes cross-project reach safe.

So: with a second project, "the agent would have to be told" stops being a
mitigation, because content can tell it. Their conclusion is correct.

What is already true, and is not nothing: each project's design workspace is locked
to its own folder, live on all four daemons, verified against four different roots.
That stops OpenDesign **serving** another project as a workspace. It does not stop a
shell command reading a sibling path, because `--dangerously-skip-permissions`
waives the command-level check, and removing that flag puts every command through a
permission prompt that no unattended daemon can answer.

**Two routes remain. Both are architecture decisions, and they are not equivalent.**

---

## Route A — one operating-system account per daemon

Each project's daemon runs as its own local user. The project's data directory is
ACL'd to that user, so a sibling project's files are unreadable at the kernel
level, whatever the agent is told.

**What makes this harder here than it sounds.** Node's `spawn` has no `uid`/`gid` on
Windows — those options are POSIX-only — so the control plane cannot simply launch a
child as another user. And while every daemon runs as the *same* user, directory
ACLs cannot separate them: an ACL keys on the principal, and there is only one.

**The work:**

1. **Provisioning creates an account per project.** A local Windows user per
   project, created and credentialled at provision time, with its password stored
   the way tenant credentials already are (encrypted in the registry). New failure
   mode to handle: account creation needs administrator rights on the host.
2. **Change how a daemon starts.** The realistic Windows mechanism is one **service
   per daemon**, each configured to log on as its project's account, with the
   control plane starting and stopping services instead of spawning child
   processes. That replaces the current supervisor path — spawn, adopt, respawn with
   backoff, the boot-window probe — with service control, and every one of those
   behaviours has to be reproduced.
3. **ACL each project's directory** to its own account, and deny the others.
4. **Fix what breaks.** The daemon writes to a shared `Instatic/dist`, reads fonts
   and plugins from shared paths, and the gateway proxies to it on loopback. Each of
   those crosses the new boundary and has to be re-permissioned rather than
   discovered in production.
5. **Make it fail closed.** A daemon that cannot start under its own account must
   refuse to start at all, not silently fall back to the shared one — which is the
   exact mistake E2 already made once, when the containment lock shipped switched
   off.

**Estimate: 6–9 working days**, plus a day of acceptance. The spread is mostly item
2: replacing the supervisor is the part most likely to surprise us, and it affects
every project's startup, not only the new isolation.

**What it does not do.** It separates the filesystem. It does not separate the
network — each account can still reach every loopback port, including other
projects' daemons and CMSes. Closing that needs per-account firewall rules on top,
which is another day and is easy to get wrong.

---

## Route B — one container per project

Each project gets a container: its own filesystem, its own process namespace, its
own network position. The agent's reach ends at the container boundary, and that is
true without depending on any allowlist we maintain.

**What it reverses.** `provision.mjs` opens with "No Docker: each tenant is a native
Bun Instatic process". That was a deliberate decision, and this route reverses it
rather than working around it — which is why it is the owner's call and not ours.

**The work:**

1. **Images** for the daemon and the CMS, pinned, built in CI rather than by hand.
2. **A container per project**, with the project's data as a mounted volume and
   nothing else visible.
3. **Rework the gateway** to route to containers rather than loopback ports.
4. **Rework provisioning and the supervisor** to create, start, stop and reap
   containers.
5. **Deal with this host honestly.** The repository lives on an SMB share (`S:` →
   `\\ZAISERVER`), and container volumes over SMB are slow and, in our own
   experience with this share, occasionally inconsistent — we already see spurious
   ENOENT on roughly half of the design builds. Project data would likely have to
   move to local disk, which is a migration of its own.

**Estimate: 12–18 working days**, plus two of acceptance. Higher than Route A, and
the spread is wider because items 3 and 5 depend on decisions not yet taken.

**What it does do that Route A does not:** network separation and process
separation come with it rather than needing extra work, and it is portable — it
survives a move off Windows, which Route A does not.

---

## The question that decides it

**Does this platform stay on Windows?**

- **If yes**, Route A is the cheaper and more native answer, and its Windows-specific
  work is not wasted.
- **If the platform will run on Linux** — as a production deployment eventually
  should — then Route A is 6–9 days of throwaway Windows plumbing, because
  `spawn` with `uid`/`gid` makes the same isolation nearly free there, and Route B
  is the thing that survives the move.

**Our recommendation, stated plainly:** if a Linux deployment is on the roadmap at
all, do Route B and do it on Linux, where both routes get cheaper and Route A
becomes unnecessary. If the platform is staying on this Windows host, do Route A
and add the firewall rules, and accept that it is host-specific.

We are not choosing for you; both numbers above are ours to stand behind, and the
architecture is yours.

---

## What we would do in the meantime, and what it is worth

Offered without overselling it. None of this substitutes for either route.

1. **Say so in the record.** E2 stays open with this document named on the board,
   rather than being described as mitigated.
2. **Narrow the agent's own tools.** The daemon's file tools can refuse absolute
   paths outside the project even while bash can still bypass them. That raises the
   bar from "ask for a file" to "know to use a shell", which is a real difference in
   an injected-instruction scenario, since a short injected string is far more
   likely to call a tool than to construct a shell command. **Half a day.** It is a
   speed bump, not a lock, and must not be reported as closing the class.
3. **Keep the number of projects sharing a host small** until one of the routes is
   in. This is a scheduling decision, not a control.
