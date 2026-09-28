# Giving the validator's machine access to the platform, and nothing else

The second-party acceptance run needs someone who is not the builder to reach
the platform. The validator's machine is not on the tailnet, and a session
cannot sign in with a password, so AC-A1.2, A3.x, A5.x and the two-project test
have had nobody able to run them.

The owner's decision is a tailnet rule scoped to the platform host. This is how
to carry it out, what it does and does not open, and how the test logins reach
the other side without passing through a chat window or a repository.

**Nothing in Part 1 is the builder's to do.** The tailnet belongs to the owner,
and the steps below name what to click rather than doing it.

---

## What this opens, stated first

| | |
|---|---|
| The validator's machine may reach | the platform host, on 443, over HTTPS |
| It may reach on the tailnet | nothing else — no other host, no other port |
| It never reaches | the owner's desktop, any other device, SSH, RDP, or the tenant ports directly |
| Reversible | yes, by deleting the rule or revoking the key; access stops at once |

The rule is written against a **tag**, not a person or a machine. That matters
for taking it away: revoking `tag:validator` removes every machine holding it in
one step, and a machine cannot quietly acquire the tag later without the owner
issuing a key for it.

---

## Part 1 — the tailnet rule (the owner)

**Who administers this tailnet:** the owner. The validator does not get an
account on it; their machine joins with a key and holds one tag.

**1. Create a tagged, pre-authorised auth key.** Tailscale admin console →
**Settings** → **Keys** → **Generate auth key**:

- **Reusable:** no. One machine, one key.
- **Ephemeral:** yes, if the validator's machine is not always on — the node
  then disappears when it goes offline rather than lingering as a stale device.
- **Pre-approved:** yes, so the machine does not sit waiting for manual approval.
- **Tags:** `tag:validator`, and only that.
- **Expiry:** the shortest that covers the acceptance run. It can be reissued.

The key is a credential. It goes to the validator the same way the logins do —
see Part 3 — and never into a chat window, a ticket body or a file in a
repository.

**2. Declare the tag's owner.** In the tailnet policy file, a tag must be owned
by someone before it can be applied:

```jsonc
"tagOwners": {
  "tag:validator": ["autogroup:admin"]
}
```

**3. Allow that tag to reach the platform host, on 443, and nothing else.**

```jsonc
"acls": [
  {
    "action": "accept",
    "src":    ["tag:validator"],
    "dst":    ["tag:platform:443"]
  }
]
```

This assumes the platform host carries `tag:platform`. If it does not, the
destination can name the host directly instead — but a tag is better here for
the same reason it is better on the source side: it survives the host being
rebuilt or re-addressed.

**What to check before telling the validator it is open.** From the validator's
machine, once joined:

- `https://<platform host>/operator` answers the sign-in page
- any other tailnet host does not answer at all
- the platform host on any port other than 443 does not answer

The middle one is the check that matters. A rule that opens the platform is only
half of what was decided; the other half is that it opens nothing else, and that
is the half worth testing.

---

## Part 2 — the test logins (the owner, in the console)

The run needs three identities, and they exist to prove that scopes hold. So
they must be made on **test projects**, and the structure matters more than the
names: two businesses, because the point is that one cannot see the other.

### What to create

| # | Identity | Where | Proves |
|---|---|---|---|
| 1 | A person on a project under **business A** | Projects → People | AC-A1.2: cannot see business B |
| 2 | A person on a project under **business B** | Projects → People | the same, from the other side |
| 3 | An **operator-scoped administrator** | Organisation → Administrators | A3.x / A5.x: sees its own estate, and cannot open a customer's work |

The two projects must sit under **different businesses**. Two projects under one
business prove nothing about scope, because the scope that is being tested is
the business.

### Creating them

1. **Organisation** → create two businesses under the same operator, or under
   two operators if the run also covers operator separation. Name them for what
   they are — `acceptance-a`, `acceptance-b` — so nobody later mistakes them for
   a customer.
2. **Projects** → create one project in each. The **lite** tier is enough and
   consumes no Cloudflare Pages slot, which keeps them clear of the 100-project
   ceiling.
3. **Projects → the project's row → People** → invite one person to each.
   **Publisher** (`admin`) is the right role: it can edit and publish, which is
   what the scope tests exercise. Do not invite them as Owner.
4. **Organisation → Administrators** → invite one administrator at **operator**
   scope, over the operator that owns those businesses.

### The two-project test

The two projects above are also what the containment test needs. Until OS-level
separation exists, **neither of them may hold anything real** — the validator has
said they will not run the absolute-path test against a project that does, and
that is the right call.

---

## Part 3 — how the logins reach the validator

Every credential here is a **single-use link**, and that is the whole mechanism:
the console shows an invite link once, at the moment it is created, and does not
store it anywhere it can be read again. An administrator listing cannot hand out
a usable invite, deliberately.

So:

1. Create one invite at a time.
2. Copy the link when the console shows it. There is no second chance — if it is
   lost, revoke and reissue rather than hunting for it.
3. Send it by whatever channel the owner already uses for credentials with the
   other side. **Not** a ticket body, **not** a chat window, **not** a file in a
   repository.
4. The validator redeems it immediately. A redeemed link is spent; an unredeemed
   one expires.

The same rule covers the tailscale auth key from Part 1.

**What the builder never sees.** None of these links, and none of the passwords
set from them. The builder wrote this document and can say whether a login has
the scope it should, which is a different question from holding it.

---

## Taking it away afterwards

When the acceptance run is finished:

1. Remove the ACL entry, or revoke the auth key. Either stops the access; doing
   both is tidier.
2. Delete the validator's node from the tailnet device list if it was not
   ephemeral.
3. Remove the three logins, or disable them.
4. The two test projects can stay — they cost a lite tier each and are useful the
   next time — but they should keep their acceptance names so nobody adopts one
   for a customer.
