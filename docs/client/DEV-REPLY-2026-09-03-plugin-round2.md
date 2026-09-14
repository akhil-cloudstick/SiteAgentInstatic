# Reply — §3 answered, your correction taken, and the disclosure

**Your §3 answer is no.** `publish.before` cannot block a publish. Build the warning
surface — detail and the exact reason in §1.

You were right about `plugin_secrets` and we were wrong. §2.

---

## 1. §3 — `publish.before` cannot block. Same semantics as a filter.

You suspected it and you were right. `hookBus.emit`:

```ts
for (const entry of entries) {
  try {
    await entry.listener(payload)
  } catch (err) {
    console.error(`[plugin:${entry.pluginId}] listener for "${event}" threw:`, err)
  }
}
```

A throwing listener is caught and logged. `emit` returns `void`, and
`publishedHtmlPipeline` ignores the result. **There is no return value a hook can use to
refuse, and no exception that reaches the publisher.** It is the same
never-block-the-host rule you found on filters, applied to events.

**So build the honest version: a warning surface plus the dashboard.** A guard that
silently does not guard is worse than no guard, and you called that correctly before
asking.

**What still works, and it is most of what you wanted.** `publish.before` fires per page
with the page in hand, so it can *record* every finding — empty `seoDescription`,
mismatched canonical — into your `resources[]` table as the publish happens. The dashboard
then shows "these 12 pages published with problems" against real publish events rather
than a scan. You lose the refusal; you do not lose the detection or the audit trail.

**And the pre-publish gate you actually want may belong on your side.** Your SEO queue
already knows which pages are incomplete before anyone presses publish. A page marked
blocked in your own admin page, refusing to leave your queue, is a real gate — enforced
where you own the decision, rather than requested at a boundary designed not to honour it.

**Would we add a blocking hook?** It is a coherent feature — an explicit veto return,
distinct from a crash, so a broken plugin still cannot wedge publishing. We are not going
to build it off the back of one need, because a hook that can refuse a publish is a hook
that can take a client's site hostage, and that deserves its own conversation rather than
being folded into an answer. Raise it separately if the warning surface proves
insufficient in practice.

## 2. `plugin_secrets` — you are right, we were wrong

We told you secrets live in `settings_json`. **They do not.** Migration
`016_plugin_secrets` creates a dedicated table, and the migration comment says exactly
what you quoted:

> *"They live in their own table instead of `installed_plugins.settings_json` so the
> plaintext can never ride a settings read onto a browser-bound payload."*

You were generous calling that "underselling our own design". The practical cost is the
one that matters: **you would have gone looking in the wrong place**, and our answer was
the reason. Correcting it rather than letting it stand.

**Your `key_fingerprint` observation is right and we had not thought it through.** A
rotation of a tenant's `INSTATIC_SECRET_KEY` surfaces as "re-enter this secret" for every
plugin holding a credential — a support event per plugin per tenant, not a silent
re-encrypt. Fine at three. At fifty it is a migration that needs planning, and the design
that makes it visible rather than a decrypt failure is also the design that makes it
manual. Recorded on our side as a known operational cost, not a defect.

## 3. Schema-per-tenant — the literal reading is correct, and you could not have seen it

You were right to check rather than cite us.

Instatic itself is exactly what the mirror shows: one `DbClient` per process, engine from
`DATABASE_URL`, no per-tenant machinery. **The schema separation is in the control plane**,
which is not in the public tree:

```sql
create schema if not exists <schema> authorization <role>;
alter role <role> set search_path = <schema>;
```

Each tenant gets a real Postgres schema owned by its own role, and that role's default
`search_path` is its own schema — so unqualified SQL from that tenant's Instatic lands
there and nowhere else. A separate process, a separate role, a separate schema.

So cite it as: **separate process, separate database role, separate schema, separate
uploads directory.** All four, and the isolation does not depend on any one of them.

## 4. The disclosure — we are building the split you proposed

Your wording is better than what we would have written, and the reasoning for the split is
the part we are taking wholesale:

> *"If a plugin author writes their own paragraph, the honest ones are indistinguishable
> from the flattering ones."*

That settles it. **Platform-generated facts, author-supplied description, visibly
separated** — the author gets to explain what their plugin does, and never gets to
characterise what it can reach.

Your point 3 is the one we would have missed. *"Whether they can undo what comes back"* is
not a permission, it is a consequence, and nothing in the manifest expresses it today. For
the SEO plugin the true answer is strong — everything it writes lands as a draft field the
client can edit before publish — and that is only sayable because of how you designed it,
not because of anything we enforce. So it belongs in the author's half, with the platform
half stating plainly what it does enforce.

**One correction to the wording you proposed**, in your favour and against us:

> *"It cannot reach any other address."*

We would soften that to **"It cannot reach any other host."** The allowlist is enforced on
the hostname; the address check is real but is resolve-then-connect, so it does not survive
a hostile DNS answer — see §5. "Host" is the claim we can actually stand behind, and after
a fortnight of `validation OK` and `verified` and `18 rows inserted`, we are not going to
put a sentence on a consent screen that is stronger than the control behind it.

Your minimum version, with that one word changed, is what we will ship first:

> **This plugin can send data to: `seo.example.com`. It cannot reach any other host.**

## 5. Your §5 second note — we are treating it as a finding, not a footnote

You flagged the resolve-then-connect window and said you were not asking for a fix. We are
not fixing it, and we want to be precise about why rather than quietly agreeing.

**We checked whether it could be closed.** It cannot, cleanly: pinning the validated
address into the connection needs a `lookup` hook or a connect-address override, and Bun's
`fetch` exposes neither. Doing it by hand means a raw socket client re-implementing
redirects and TLS verification — more attack surface than the flaw.

So instead of a fix that could not be verified, three things that can be:

1. **The limitation is now written on the function**, naming what the guard does and does
   not stop, so nobody builds on an assumption it does not support.
2. **The feature doc says it too**, in the permissions section: *"Treat
   `networkAllowedHosts` as the boundary, not the IP check."*
3. **A test pins the per-hop revalidation.** That call sits inside the redirect loop and
   reads like redundant work from outside it — it is the thing still holding when a later
   hop lies, and it is exactly the kind of line someone removes as an optimisation. It now
   fails the suite if it moves, and if the limitation comment is deleted.

The control that survives rebinding is the allowlist: an attacker needs a hostname the
manifest already declares and a human already approved. That is worth saying on the consent
screen, which is why §4 says "host".

## 6. Where that leaves your three

**SEO plugin** — build it, with the §1 change: warning surface and dashboard, gate in your
own queue rather than at `publish.before`. Everything else stands.

**Marketing-data plugin** — unchanged. Still the safest of the three.

**Analytics plugin** — unchanged, unblocked.

## 7. Verified

| | |
|---|---|
| `publish.before` cannot block | `emit` catches and returns void; caller ignores result |
| `plugin_secrets` is a dedicated table | migration `016_plugin_secrets` — your reading, not ours |
| Schema-per-tenant | `create schema … authorization <role>` + role `search_path` |
| Redirect-hop revalidation | pinned by a new test |
| DNS-rebinding limitation | documented on the function and in the feature doc |
| Plugin sandbox + step-up gates | **14 pass, 0 fail** |

Nothing here blocks you. §1 is the only one that changes what you build, and it changes it
in the direction you already suspected.
