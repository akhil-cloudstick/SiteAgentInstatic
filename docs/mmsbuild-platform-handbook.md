# MMSBUILD — Platform Overview

**What the platform is for, how the levels above a website fit together, how a website actually gets
built and published, and exactly how far the current build is from the goal.**

Written to be read straight through. No code, no file names, no commands — this describes what the
system *does*, not how it is written.

---

## Contents

1. [The problem, and the goal](#1-the-problem-and-the-goal)
2. [The hierarchy — Super Admin, Operator, Client, Project](#2-the-hierarchy--super-admin-operator-client-project)
3. [What a Project actually is](#3-what-a-project-actually-is)
4. [People and roles](#4-people-and-roles)
5. [The main workflow — from an idea to a live website](#5-the-main-workflow--from-an-idea-to-a-live-website)
6. [The five parts of the platform](#6-the-five-parts-of-the-platform)
7. [The three safety rules the platform enforces](#7-the-three-safety-rules-the-platform-enforces)
8. [Every condition that can stop a step](#8-every-condition-that-can-stop-a-step)
9. [Where we are now, measured against the goal](#9-where-we-are-now-measured-against-the-goal)
10. [What is working, what is partial, what is not built](#10-what-is-working-what-is-partial-what-is-not-built)
11. [The addresses](#11-the-addresses)
12. [How we know it works](#12-how-we-know-it-works)
13. [What happens next](#13-what-happens-next)

---

## 1. The problem, and the goal

### The problem

Building a website today needs three different people — a designer, a developer, and someone to
maintain the content afterwards. The handoffs between them are where time and money go. The designer
hands over a picture; the developer rebuilds it as code; the content person is then stuck with
whatever the developer decided to make editable.

AI tools can now produce a good-looking website in minutes. But what they produce is a pile of code.
The moment a non-technical person wants to change a headline, they are back to needing a developer.

### The goal

**One platform where a person describes a website, and gets a real, editable, publishable website —
with no developer at any point.**

Concretely, that means five things must be true:

| # | The goal | Why it matters |
|---|---|---|
| 1 | **One login.** A person signs in once and both the design tool and the content system are open to them. | Two logins means two products. Users do not experience it as one platform. |
| 2 | **One look.** Both products carry the same header, the same navigation, the same visual language. | Same reason. The seam must be invisible. |
| 3 | **A design becomes an editable site, not a screenshot.** Every heading, image, button and block that the AI produced must be selectable and editable afterwards by a non-technical person. | This is the whole product. A design that imports but cannot be edited is worthless. |
| 4 | **Publishing puts it on the internet, and proves it.** One click, live site, with a record afterwards showing what went live and that it was checked. | "It's live" must be a fact, not a claim. |
| 5 | **Nothing destructive happens without an approval.** Replacing a live site, publishing over a client's work, deleting content — each needs a signed go-ahead that works exactly once. | This is what makes it safe to give a powerful tool to many people. |

### The business shape

The platform is not sold direct to one business. It is built to be **resold**:

```
    The platform is run by us
              │
              ▼
    sold to Operators  (agencies, resellers)
              │
              ▼
    who serve their own Clients  (businesses)
              │
              ▼
    each of which has one or more Projects  (websites)
```

That resale chain is the reason the hierarchy in the next section exists. An operator must be able to
run their own book of clients without seeing anybody else's, and without us being involved in their
day-to-day work.

---

## 2. The hierarchy — Super Admin, Operator, Client, Project

```
┌─────────────────────────────────────────────────────────────────────┐
│  SUPER ADMIN                                                        │
│  Runs the platform itself.                                          │
│  • Onboards operators                                               │
│  • Holds the AI provider account and chooses which AI model is used │
│  • Holds the hosting account that published websites go to          │
│  • Can see every operator, client and project                       │
│  • Can open any workspace — but only through a logged, time-limited │
│    grant that shows a banner to everyone while it is open           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  OPERATOR                                                           │
│  An agency or reseller. Their business sits on the platform.        │
│  • Owns a set of clients                                            │
│  • Their own logo and brand appear on the product their clients see │
│  • Creates projects, sets the website address for each              │
│  • Invites people to a project and sets what each can do            │
│  • Sees their own clients only                                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  CLIENT                                                             │
│  A business the operator serves.                                    │
│  • Owns one or more projects                                        │
│  • Their people sign in and work on their own projects only         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  PROJECT                                                            │
│  One website workspace. This is where the actual work happens.      │
│  • Its own design workspace and its own AI conversation             │
│  • Its own content system                                           │
│  • Its own private data, files and media                            │
│  • Its own published website and its own web address                │
│  • Its own list of people                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### How the chain is handled in practice

**Everything belongs to somebody, automatically.** When anything is created inside a project — a
page, a user, a machine key, a deploy record — the platform stamps it with which client and which
operator it belongs to, at the moment it is created. Nobody has to remember to set it, and nobody can
create an orphan record that belongs to nobody. This is what makes "show me only my own clients"
possible without a filter that somebody could forget to apply.

**Every account carries a level.** An account is marked as platform-level, operator-level or
business-level, and that level decides what the account can see when it signs in. A platform account
sees everything; an operator account sees their own book.

**Opening somebody else's workspace is an event, not a switch.** When platform staff need to go into a
client's workspace to help, they do not log in as that client. They open a grant: it is recorded, it
expires on its own, it is swept automatically when it does, and while it is open a banner sits at the
top of every screen saying whose workspace is currently open and who is in it. There is no silent
impersonation.

**Two service levels per project.** A project can be set up in one of two ways:

| Level | What the project gets | Typical use |
|---|---|---|
| **Design only** | The AI design workspace. The person can build and iterate on a site, but there is no content system behind it and nothing can be published. | Pitching. Show a prospect what their site could look like before any commitment. |
| **Full** | The design workspace, a full content system, a published website address, and the ability to publish and go live. | A real client engagement. |

A project can be upgraded from design-only to full later without starting over. The design work is
kept.

### Where this stands today

| Level | Built? | Detail |
|---|---|---|
| **Project** | ✅ **Fully built** | Everything described in section 3 works. |
| **Super Admin** | ✅ **Built** | Platform-level accounts, the shared AI account and model choice, the shared hosting account, the logged grant to open any workspace. |
| **Operator** | 🟡 **Mostly built** | Operators exist as real records, projects belong to them, their branding shows on the product, and account levels exist. What is missing is a dedicated operator console — operators and platform staff currently work in the same screens, separated by their account level rather than by a purpose-built surface. |
| **Client** | 🟠 **Partial** | Clients exist as records and every project is stamped with the client it belongs to, so the data is correctly organised. What does not exist yet is a client-facing screen where a client sees their projects grouped as one portfolio. Today a project is reached individually. |

The important point: **nothing has to be re-architected to finish this.** The data is already shaped
for four levels and already stamped correctly. What is outstanding is the screens on top of it.

---

## 3. What a Project actually is

A project is the unit of isolation. When an operator creates one, it is given its own everything.

### What is private to each project

| | |
|---|---|
| **Its own data** | Each project's content lives in its own private area of the database, reached through its own credentials. One project's connection physically cannot read another project's data. This is not a filter in the software that could be bypassed — it is enforced by the database itself. |
| **Its own files** | Uploads, images, fonts and the generated website files all live in a folder belonging to that project alone. |
| **Its own design workspace** | Its own AI conversation, its own project history, its own design systems and plugins. Nothing is shared between projects. |
| **Its own website address** | Created the moment the project is created — see below. |
| **Its own people** | Its own invitation list and its own roles. |
| **Its own machine keys** | If an outside tool or AI agent is given access to one project, that key works only on that project. |

### What is deliberately shared

| | |
|---|---|
| **The software itself** | There is one copy of the content system and one copy of the design app serving every project. Adding a project adds a small amount of running work, not a whole new installation. This is what makes the platform affordable to scale. |
| **The AI account and the chosen model** | The operator holds one AI account and picks one model. Every project uses it. Project users never see a model picker, never enter a key, and cannot run up a bill on their own account. |
| **The front door** | One public entrance for the whole platform. |

### The address is live from day one

The moment a project is created — before anything has been designed, before anyone has logged in —
the platform creates the project's public website address and puts a "Coming soon" page on it.

This matters for a practical reason: the address can be given to the client, pointed at a domain, and
tested immediately. Nobody is waiting for the first build to find out whether the address works.

### The website is not served by the platform

Once published, the website is served by a global content network. The platform host is not in the
serving path at all. Consequences:

- The live site stays up even if the platform is down for maintenance.
- The live site is fast everywhere in the world, not fast only near the platform's server.
- Visitor traffic never touches the editing system.

---

## 4. People and roles

There are two separate sets of roles, and they answer two different questions.

### Roles inside a project — "what may this person change?"

| Role | Can do |
|---|---|
| **Owner** | Everything on the project, including people and settings. |
| **Admin** | Everything on the content and the site; manages day-to-day. |
| **Client** | Works on content. Cannot change project settings or people. |
| **Member** | The narrowest role — assigned work only. |

### Roles in the approval chain — "who may authorise something irreversible?"

This is a separate axis and deliberately so. A person can have full access to a project and still not
be able to approve a destructive action.

| Role | Does |
|---|---|
| **Builder** | Does the work, prepares the change, and submits it for approval. Cannot approve their own work. |
| **Validator** | Independently checks the work and records the evidence. Cannot approve either. |
| **Owner** | The only one who can issue the approval — a cryptographic signature. |

The approval system runs **outside the platform**, on separate infrastructure. That is deliberate:
having access to the platform's servers does not give anyone the ability to forge an approval. Even
the team running the platform cannot produce a valid owner signature.

### How an approval behaves

| Property | Behaviour |
|---|---|
| **One use only** | An approval authorises exactly one run — including a run that fails. There is no retry on the same approval. |
| **Bound to the exact content** | The approval is tied to the specific thing being approved. If the work changes after signing, even slightly, the approval no longer matches and is refused. |
| **Time-limited** | It expires automatically. The maximum lifetime is capped and cannot be extended by anyone. |
| **Expiry belongs to the system** | Only the automatic timer can expire an approval. No person can force an early expiry to make someone re-sign, nor stretch one that is running out. |
| **Nothing can be edited or deleted** | The whole approval record — tickets, evidence, decisions — is append-only, and is protected in two independent ways at once. Losing one protection does not lose the guarantee. |
| **Changing who may approve is itself recorded** | Rotating an approver retires the previous one in the same action and takes effect immediately. A project with no registered approver refuses every approval. There is no fallback key and no way to inherit one. |

---

## 5. The main workflow — from an idea to a live website

```
STEP 1   The operator creates the project
         └─► Website address created and live with a "Coming soon" page
         └─► Design workspace prepared
         └─► Content system prepared and the first owner account created
         └─► Takes about a minute; the operator does not have to wait for it

STEP 2   The person signs in — once
         └─► They land on the Hub and choose Design or Content

STEP 3   They describe the website in chat
         └─► The AI builds a real website — pages, styling, images
         └─► It runs on the operator's AI account; the user never sees a key
             or a model choice
         └─► They preview it, ask for changes, iterate

STEP 4   After every single change, the platform quietly checks the work
         └─► Does this website meet the rules that make it importable
             and editable afterwards?
         └─► If not, the platform asks the AI to fix it — silently, in the
             same conversation, up to three attempts
         └─► The user is never blocked and usually never notices

STEP 5   They press "Send to the content system"
         └─► Everything is checked one final time — properly this time,
             and this check BLOCKS
         └─► If it passes, the design crosses over and becomes a real
             editable site: pages, text, images, navigation, all selectable

STEP 6   They edit content normally
         └─► Headlines, images, blog posts, menus — no code, no developer

STEP 7   They press Publish
         └─► The whole site is rendered and written out
         └─► The switch to the new version is instantaneous — a visitor
             never sees a half-published site

STEP 8   The platform puts it on the internet
         └─► Safety check first (see Step 8 conditions in section 8)
         └─► Uploaded to the global network
         └─► The platform then FETCHES THE LIVE URL and verifies the site
             really is serving the new content
         └─► Only then is the record written — and that record can never
             be altered or deleted afterwards

RESULT   A live website, and a permanent, tamper-proof record proving
         what went live and that it was checked.
```

### Why step 4 and step 5 both exist

They look like the same check, but they do opposite jobs.

- **Step 4 is a helper.** It runs constantly, fixes what it can automatically, and never stops the
  user working. It is how most problems are resolved without anyone knowing there was one.
- **Step 5 is a gate.** It runs once, at the crossing point, and it stops the crossing if the work is
  not good enough.

Without step 4, the user would hit the gate constantly and find it infuriating. Without step 5, bad
work would cross over and produce a site the client cannot edit — which is the one failure the whole
product exists to prevent.

### Why the crossing is a real crossing

When a design is sent to the content system, it does **not** go through a special back door. It is run
through the exact same process a person would use to import a website by hand.

This is a deliberate design decision with a practical payoff: there is only one import path in the
entire product. It is impossible for "sent from the design tool" and "imported by hand" to behave
differently, because they are the same thing. A fix to one is a fix to both, forever.

### Re-sending is safe

If the user goes back to the design tool, changes something, and sends it again:

- The platform recognises it as **the same design**, and updates the existing site in place.
- Pages are matched by their address, so a re-send updates a page rather than creating a duplicate.
- Content the user added in the content system is not blown away by a re-send of the same design.

If a **different** design is sent to a project that already has a **live** website, the platform
**refuses** and says so, with a count of the pages that would have been replaced. That refusal exists
because it once went the other way and destroyed a live site.

---

## 6. The five parts of the platform

| Part | Plain description | What it owns |
|---|---|---|
| **The control plane** | The platform itself. Everything else is started by it and runs underneath it. | The single public entrance, sign-in, the registry of operators, clients, projects and people, creating projects, starting and supervising everything, publishing to the internet, and the permanent audit record. |
| **The content system** | The CMS. What a client uses day to day. | Pages, blog posts, collections, media, menus, site-wide templates, the publishing process, and the rendering of the public website. |
| **The design workspace** | The AI design tool. Where a website is created. | The chat, the AI agent that builds the site, the preview, the design systems, and the send-to-content-system crossing. |
| **The bulk tool** | A machine-only surface for large operations. | Importing an entire existing website, exporting one, replacing a whole site, bulk publishing, creating projects programmatically. Used by operators and by AI agents — not by end clients. |
| **The approval service** | The independent approval queue. Runs outside the platform on purpose. | Requests for permission, the evidence attached to them, the owner's signature, and the permanent unchangeable record of every decision. |

### How they fit together

```
                    ┌──────────────────────┐
                    │   APPROVAL SERVICE   │   ← runs outside the platform
                    │  (separate infra)    │      so an approval cannot be
                    └──────────▲───────────┘      forged from inside it
                               │ asks: "is this approved?"
                               │
  a person ──► ┌───────────────┴──────────────────────────────┐
               │            THE CONTROL PLANE                 │
               │   one entrance · sign-in · who-owns-what     │
               └───┬──────────────┬─────────────────┬─────────┘
                   │              │                 │
          ┌────────▼─────┐  ┌─────▼────────┐  ┌─────▼──────┐
          │   DESIGN     │  │   CONTENT    │  │    BULK    │
          │  WORKSPACE   │─►│    SYSTEM    │  │    TOOL    │
          └──────────────┘  └──────┬───────┘  └────────────┘
            "send to the           │ publish
             content system"       ▼
                          ┌────────────────────┐
                          │  THE LIVE WEBSITE  │  ← served globally,
                          │  on a global CDN   │     not by the platform
                          └────────────────────┘
```

---

## 7. The three safety rules the platform enforces

These three are the difference between a demo and a product.

### Rule 1 — The design tool may only build what the content system can faithfully import

This is the single most important rule in the platform, and it is the one that took the longest to
get right.

**The problem it solves.** An AI can build a page that looks perfect and is nonetheless useless once
imported — text that the client cannot click on to edit, a button whose label was drawn by a script
so it imports as an empty box, a video frame that displays fine in preview and shows blank on the
live site, styling written in a form that gets silently discarded on the way in.

Every one of those produces a site that *looks* right and *cannot be edited*. That is precisely the
failure the product exists to prevent.

**How it is enforced — three layers, each doing a different job:**

| Layer | What it does | Blocks? |
|---|---|---|
| **Prevention** | A written rule book is given to the AI at the start of every single conversation, positioned so that it overrides every other instruction the AI has. Editing the rule book takes effect on the very next message — no restart, no release. | No — it prevents |
| **Automatic repair** | Before any check runs, a repair pass fixes the mechanical problems by itself: makes sure every image is a real file, converts styling into the supported form, wraps loose text so it becomes editable, forces content to be visible without scripts. It works on the copy being sent, never on the user's own work, and never changes a genuine design decision. | No — it repairs |
| **The gate** | Seventeen hard checks. If any fails, the crossing is refused and the user is told, in plain language, with a "Fix it" button that asks the AI to correct it. | **Yes** |

Alongside the seventeen hard checks are three advisory ones that log a note but never stop anyone.

**And a principle that governs all three:** *no check may pass by failing.* If the checking machinery
itself breaks, the crossing is refused, not waved through. A broken check is treated as a failed
check.

### Rule 2 — Nothing irreversible happens without a one-time signed approval

Covered in [section 4](#how-an-approval-behaves). The short version: the approval is issued outside
the platform, is bound to the exact content, works once, expires on its own, and every record of it
is permanently unchangeable.

One detail worth stating because it is unusual: **the signature is verified twice, by two completely
separate pieces of software** — once when it is issued, and again when it is used. They run on
different systems and share no code. They are kept in agreement by a shared set of test cases that
both must pass.

### Rule 3 — "It went live" must be proven

The publish step does not end when the upload finishes.

After uploading, the platform **fetches the live website address itself** and confirms the site is
actually serving the content that was just published. Only after that check passes is the record
written — and that record is permanently unchangeable, protected by the database itself rather than
by the software.

**What it compares, precisely — because "a 200 response" would prove nothing.** A host serving a
fallback page answers 200 for every address that does not exist, so a site with half its pages
missing would sweep clean. Instead, each sampled page is identified by its own title, taken from the
file that was just built, and the live address for that page must come back carrying **that** title.
A page serving the homepage instead, or another page, or a host's "not found" page, fails — under a
200 like any other. Up to a dozen pages are sampled, spread across the site rather than down one
branch, and the home page is always among them.

The verdict has three values, and the difference between the last two is the point: **verified** (the
pages were fetched and each served its own content), **failed** (a page was missing or served
something else), and **unverified** (the check could not run at all). "Could not check" is never
recorded as success.

Before this existed, "it went live" was an assumption. Now it is evidence.

---

## 8. Every condition that can stop a step

This is the detail that matters in a demonstration: what happens when something goes wrong, and
whether the platform fails safely.

### When a project is being created

| Condition | What happens |
|---|---|
| The design workspace fails to start | **Not fatal.** The project is still created; the failure is recorded and it can be started again. |
| It is a design-only project | The content system and the website address are deliberately skipped. This is not an error. |
| Hosting is not configured yet | The website address is skipped for now and created automatically on the first real publish instead. |
| Anything else fails | Everything created so far is cleaned up automatically and the project is marked as failed. No half-built projects are left behind. |

### When someone opens the design workspace or the content system

| Condition | What happens |
|---|---|
| Their workspace is not running yet | It is started automatically, and the person sees a "starting…" page that refreshes itself and then continues to where they were going. Nothing is lost. |
| An old, stale process is in the way | It is detected and cleared out first. This is from real experience — a forgotten process once served weeks-old software and silently broke saving. |
| They have no valid session | There is no project to resolve, so they are sent to sign in. |

### When a design is sent to the content system

| Condition | Result | What the user sees |
|---|---|---|
| The project has no content system (design-only) | Refused | "Not connected" — the project needs upgrading |
| The design produced no pages | Refused | "Nothing to send" |
| The checking machinery itself failed | Refused | "Temporarily unavailable" — deliberately refused rather than risked |
| A hard rule failed | **Refused** | The blocked message, **with a "Fix it" button.** This is the only failure that offers one. |
| The content system could not be reached | Refused | "Temporarily unavailable" |
| A **different** design is being sent over a **live** site | **Refused** | "This project already has a website", with the number of pages that would be replaced |
| A **different** design over **draft-only** work | Allowed, with a confirmation | "This will replace N draft pages — continue?" |
| The **same** design being re-sent | **Allowed** | Silently updates in place. No duplicates. |

### When a site is being published to the internet

| Condition | What happens |
|---|---|
| The project has a custom domain **and** search-engine indexing is switched off | **Refused.** This stops a real production website going live marked "do not index" — a mistake that is invisible until traffic never arrives. |
| The site has its own search-engine files already | They are preserved. Generated content is kept in a clearly marked section and never overwrites what was imported. |
| The upload reported success but exited oddly | Treated as success. The upload tool occasionally reports a clean deploy and then exits with an error from an unrelated final step. |
| The live site does **not** serve the new content | The publish is **not** recorded as successful. |

### When an approval is being used

Checked in this order, and it stops at the first failure:

```
1. Is there a registered approver for this project?
      No approver ⇒ REFUSED. There is no fallback key. There is no
      inherited key. A project with nobody registered can approve nothing.

2. Was an approval supplied at all?          No ⇒ refused
3. Is the signature genuine?                 No ⇒ refused
4. Does it name this exact action and this exact project?   No ⇒ refused
5. Has it expired?                           Yes ⇒ refused
6. Has it already been used?                 Yes ⇒ refused
7. Does it match the content exactly as it is right now?
      This is checked LAST, because it is the only check that has to
      look at the live site.
      "The work changed after it was signed" is a hard refusal.

Then: the approval is marked used BEFORE the action runs.
      It authorises one run. Including a run that fails.
```

---

## 9. Where we are now, measured against the goal

This section puts the five goals from section 1 next to what actually exists.

### Goal 1 — One login

| | |
|---|---|
| **The goal** | A person signs in once and both products are open. |
| **Today** | ✅ **Done.** One sign-in at the Hub, then either product opens without a second login. Moving between them does not re-prompt. |
| **Gap** | None. |

### Goal 2 — One look

| | |
|---|---|
| **The goal** | The two products feel like one product. |
| **Today** | ✅ **Mostly done.** The two-row header is not two matching copies — it is genuinely one shared component, built once and used by both, so it cannot drift apart. The content system's admin screens have been rebuilt against approved designs, screen by screen, and automated checks stop the header changing on one side only. |
| **Gap** | 🟠 A set of screens in the design workspace that had been custom-built to the MMSBUILD design were **lost in a version upgrade** and now show the original supplier's layouts. The colours and branding survived; the custom layouts did not. This is lost work that needs redoing, not work that was never started. |

### Goal 3 — A design becomes an editable site

| | |
|---|---|
| **The goal** | Everything the AI produced is selectable and editable afterwards by a non-technical person. |
| **Today** | ✅ **Done, and this is the strongest part of the build.** The three-layer rule system in [section 7](#rule-1--the-design-tool-may-only-build-what-the-content-system-can-faithfully-import) is fully working: the rule book is live and editable without a release, the automatic repair pass runs on every send, seventeen hard checks block a bad crossing, and the AI silently self-corrects after every change. The crossing itself uses the same path as a manual import, so the two can never diverge. |
| **Gap** | Three specific styling constructs genuinely cannot be represented and are dropped — **with a visible warning, never silently.** This is a permanent limitation, honestly surfaced, not an unfinished item. |

### Goal 4 — Publishing puts it live, and proves it

| | |
|---|---|
| **The goal** | One click, live site, permanent proof. |
| **Today** | ✅ **Done.** Publishing renders the whole site, switches to the new version instantly so no visitor sees a half-published state, uploads to the global network, **fetches the live address to verify it**, and only then writes a record that neither the software nor an administrator can alter or delete. The safety check that refuses to publish a production domain marked "do not index" is live. |
| **Gap** | None on the core path. |

### Goal 5 — Nothing destructive without an approval

| | |
|---|---|
| **The goal** | A signed, one-time, content-bound approval gates every irreversible action. |
| **Today** | ✅ **Built and tested.** The approval service exists, runs on independent infrastructure, holds the registry of who may approve what, issues signatures, and refuses everything listed in [section 8](#when-an-approval-is-being-used). The bulk tool verifies every approval independently before acting. Both sides are tested against a shared set of cases. |
| **Gap** | ✅ **Now live.** Updated 24 Sep 2026: the owner deployed the approval service and registered the first per-project approver. Verified from outside by us, not taken on trust — the service reports its new version, publishes the registry of who may approve what, and refuses a correctly-signed approval from any identity that is not the registered one. A project with no registered approver is refused outright, with no fallback key tried. What has **not** happened yet is a full run under a live signature: that needs the owner to sign, and is the acceptance run rather than a build step. |

### The hierarchy, against the goal

| | |
|---|---|
| **The goal** | Four working levels: Super Admin → Operator → Client → Project. |
| **Today** | Projects are fully built and fully isolated. Operators are real, own their projects, and their branding reaches the client. Clients are real and every project is correctly assigned to one. Accounts carry a level that controls what they can see, and every new record is stamped with its owner automatically. |
| **Gap** | 🟡 The **screens** for the upper two levels are behind the data. Operators and platform staff currently share the same console, separated by account level rather than by a purpose-built operator surface. There is no client portfolio screen where a client sees all their projects together. |
| **Why this is not alarming** | The hard part of a hierarchy is getting the data right — who owns what, enforced automatically, with no way to create an orphan. That part is done. What remains is screens over data that is already correctly shaped. |

---

## 10. What is working, what is partial, what is not built

The honest list. Nothing here is marked done on assumption.

### ✅ Working, in use, and proven

| Capability | Notes |
|---|---|
| Creating a project end to end | Data, content system, design workspace, website address, first owner account — about a minute, no manual steps. |
| Project isolation | Enforced by the database itself, not by a filter in the software. |
| Single sign-on across both products | |
| The shared header | One component, not two copies. Protected by automated checks. |
| AI website building on the operator's account | Project users see no key and no model choice, and cannot run up their own bill. |
| The rule system that keeps designs editable | Three layers, seventeen blocking checks, automatic self-correction, live-editable rule book. |
| Send-to-content-system, with safe re-sending | Same design updates in place; a different design over a live site is refused. |
| Full content management | Pages, collections, blog posts, media, site-wide templates, scheduled publishing. |
| Instant publishing | The switch is atomic — a visitor never sees a partial site. |
| Deploy to the internet with live verification and a permanent record | |
| The "do not index on a production domain" safety refusal | |
| The approval service | Built, tested, and independently verified on both sides. |
| Bulk import and export of entire websites | |
| Machine access for outside AI agents | Scoped keys, with an expiry and one-click revocation. |
| Logged, time-limited access to a client workspace, with a visible banner | |
| Automatic start of a workspace on first use | With a self-refreshing waiting page. |

### 🟡 Partial — works, but not finished

| Item | What is there | What is missing |
|---|---|---|
| **The Operator level** | Real operator records, ownership, branding, account levels. | A dedicated operator console. |
| **The Client level** | Real client records, every project correctly assigned. | A client portfolio screen. |
| **Design workspace screens** | Branding and theme. | Custom MMSBUILD layouts on five screens, lost in a version upgrade. Needs redoing. |
| **Machine access to custom content types** | The bulk tool sees custom content types correctly. | An AI agent key sees only the four built-in content types, not custom ones. Known, deferred. |

### 🔴 Not built, or not proven

| Item | Status | What it means |
|---|---|---|
| **One published website per hosting project, against a hard 100-project limit** | **Known, not solved** | The hosting provider allows 100 website projects per account and does not routinely raise it. The platform creates one per client website, so the hundredth site is the ceiling — and it arrives as a provisioning failure, not a warning. This was identified in an internal architecture review and has not been acted on. The intended fix is to hold more than one hosting account and choose between them when a project is created; nothing of that is built, and there is no counter, no alert, and no check before creating a project. Below roughly 80 sites it is invisible; it must be solved before it is reached, not when. |
| **Two projects sharing the design workspace at once, verified** | **Never tested** | The design app is one shared installation serving every project, with the project identified by the signed session rather than by the web address — which is what makes it scale. The reasoning is sound and the software is written for it, **but the single most important test has never been run**, because there has only ever been one live project. Two users, two projects, at the same time, confirming neither can see the other. **This must be tested before a second client is onboarded.** |
| **Fine-grained permissions on the bulk tool** | Not built | One key grants every operation on every project it is configured for. There is no partial access and no revocation list — rotating means restarting with a new key. Anyone needing finer control uses the scoped machine-key system instead, which does have expiry and revocation. |
| **Production security hardening** | Partly cleared | Updated 24 Sep 2026. One of the two relaxed web-security checks is now **closed**: the management console refuses a state-changing request that does not come from the platform's own address. It had been relaxed because the development entrance rewrites requests, which made the standard check reject every legitimate form — so the check now compares against the platform's configured address instead of the rewritten one. That mattered more than it looked: every product is served from one address, so the browser-level protection that was being relied on gave no protection at all between them. **Still outstanding:** a spare demo entrance that exposes one project's editor without a session check, and one address hardcoded rather than configured. |
| **Acceptance sign-off** | Not ours to mark | The acceptance column belongs to the independent validator, not to us. No acceptance run has been requested yet. |

### A note on how this list is maintained

Nothing on this page is marked working because it was implemented. It is marked working because it
has been run and observed. Where something is built but has not been proven — the approval service,
and two projects sharing the design workspace — it is listed in red, not in green, even though the
code exists.

---

## 11. The addresses

### What a person opens

| Address | Who | What |
|---|---|---|
| `https://siteagent.tailbbb0d2.ts.net` | everyone | The single public entrance to the whole platform. |
| `…/hub` | project user | The Hub. Sign in once here, then pick a product. |
| `…/design` | project user | The AI design workspace. |
| `…/cms` | project user | The content system. |
| `…/operator` | operator, platform staff | The management console — projects, settings, people, machine keys, audit. |
| `https://deploy-relay.leroiftp.workers.dev` | owner, validator, builder | The approval queue. Separate infrastructure, separate sign-in. |

### The published website

| | |
|---|---|
| **Default address** | `https://siteagent-<project-name>.pages.dev` |
| **Live from** | The moment the project is created, showing "Coming soon". Not from the first publish. |
| **Custom domain** | Attached to the same site at any time. |
| **Served by** | A global content network — not by the platform. The live site is unaffected by platform maintenance. |

### One design point worth explaining

Every project uses **the same web addresses**. There is no project name in the address anywhere.

The project is identified by the signed session, not by the address. Because the address carries no
project identity, there is nothing in it to change, guess or tamper with. Changing the address bar
cannot get anyone into another project's workspace.

This is also why one installation of the design app can serve every project on the platform — it does
not know or need to know which project it is serving. That is what keeps the cost of adding a project
close to zero.

---

## 12. How we know it works

Verification is in four layers, from cheapest to most convincing.

| Layer | What it checks | Scale |
|---|---|---|
| **Automated tests** | Individual behaviours across all five parts. | Well over a thousand automated tests. |
| **Architectural guards** | Not "does this work" but "has someone accidentally broken a rule the whole system depends on". These run automatically and fail the build. Examples: the shared header must stay identical on both products; the two database engines must stay exactly in step; access keys must never appear in any response sent to a browser. | 81 guards |
| **Browser tests** | A real browser driving the real product through real journeys — signing in, editing content, uploading media, publishing, previewing. | Dozens of scripted journeys across both products |
| **The full walkthrough** | The complete section 5 journey run by a person on a scratch project, finishing by opening the live public address and confirming the record was written. | Run before anything is called done |

### What is not yet covered

- Two projects using the design workspace at the same time. Listed in red above; this is the most
  important outstanding test on the platform.
- A set of narrower browser journeys — permission variants on bulk editing, some session-expiry
  timing, storage migration screens. These are gaps in *coverage*, not known broken behaviour.

### An honesty note on test results

A full run of the content system's tests on a Windows machine shows roughly a hundred failures caused
by file-locking behaviour on this development setup — not by the software. Results are judged by
**which areas failed**, never by the raw pass count. A green count on a machine that cannot hold a
file lock would be less meaningful, not more.

---

## 13. What happens next

In the order they should be done.

| # | Item | Why it is in this position |
|---|---|---|
| 1 | **Prove two projects can share the design workspace safely** | The one untested assumption on the critical path. Must be closed before a second client is onboarded. It is a test, not a build. |
| 2 | ✅ **Switch on the approval service** — done 24 Sep 2026 | Deployed by the owner, first approver registered, and verified from outside. What remains is a full run under a live signature, which is the acceptance run. |
| 2b | **Decide what happens past 100 published websites** | The hosting account's ceiling, one website project per site. It arrives as a provisioning failure with no warning, so it has to be answered before the number is near — not when a client's site fails to be created. |
| 3 | **Clear the production hardening list** | Short, fully written down, and mechanical. Remove the demo entrance, restore the two relaxed web-security checks, move the hardcoded address into configuration. |
| 4 | **Rebuild the five design-workspace screens** | Recovers work lost in a version upgrade. Visible to every user, which is why it ranks above the items below. |
| 5 | **Build the operator console** | The data is ready. This is screens over data that is already correctly shaped and correctly owned. |
| 6 | **Build the client portfolio screen** | Same — completes the four-level hierarchy at the surface. |
| 7 | **Custom content types visible to AI agent keys** | Known, scoped, and already behaving correctly through the bulk tool. |

### The one-paragraph summary

**The product works.** A person can describe a website, watch an AI build it, have it become a real
editable site, publish it, and have it go live on a global network with a permanent record proving it
went live. The hard parts — keeping the two products feeling like one, and guaranteeing that an
AI-built design stays editable afterwards — are built, enforced by machine, and hold up. What remains
is the management layer above a single project, a set of screens lost in an upgrade, and one important
test that has been impossible to run so far because there has only ever been one project to run it on.
