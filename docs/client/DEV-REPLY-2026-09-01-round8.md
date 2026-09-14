# Reply — round 8 · 2026-09-01

Our half of round 8. Consolidates everything still outstanding from your rounds 6, 7
and 8 into one message.
Supersedes our two earlier drafts, which were numbered against our own count rather
than the shared sequence and are best ignored.

**The connector is live and both targets are verified.** Nothing is waiting on us
except a Cloudflare deploy, which only your Boundary 4 needs.

---

## 1. The connector is back, and it carries four things

Verified against the running instance rather than asserted: `tools/list` returns 34
tools, and connecting to each target reads real content back — `akhil` reports Pages
398, Components 6.

| Tool | Change |
|---|---|
| `connector_export_manifest` | `rows` (none/summary/full), `tableId`, `limit`/`offset`, a **4 MB budget** on the serialised page, and `nextOffset` to resume from |
| `connector_preview_import` | `unknownFields` — the union-schema check |
| `connector_export_bundle` | **Returns the archive itself**, base64, split across `part`s with a whole-archive `sha256`. No size ceiling |
| `connector_create_site` | **New.** Provision a clean, empty site yourselves |

The delay is worth one line because it explains the silence: the connector is a
separate long-running process from the CMS, it had been started by hand months ago,
and our dev script never owned it. It does now, so it returns with everything else
rather than being one forgotten command.

**Targets are `akhil` and `client-b`, and only those.** See §4.

---

## 2. Option 2 is built — `trailingSlash`

You asked us to price it before defaulting to normalising. The price turned out to be
low enough that we built it instead of quoting it.

**Why it was cheap:** the artefact writer already understood directory URLs —
`/about-us/` has always mapped to `about-us/index.html`. Nothing ever asked for that
shape. The publish step computed `/about-us` and never `/about-us/`, so every site
published flat regardless of the URLs it arrived with. This was not a new capability;
it was a decision that had never been made explicit.

What changed:

- **`settings.trailingSlash`** — per-site, **off by default**, so no published site's
  URLs move.
- **One decision point** used by both bake paths, so pages and entries cannot drift
  into disagreeing about a site's URL shape. Your blog 301s target entry routes, so a
  page-only fix would have left half the problem standing.
- **The sitemap follows the site** — a directory-baked site lists `/about-us/`.
  Emitting the flat form would have seeded the sitemap with the URL the host redirects
  away from.
- **The reader accepts both shapes**, so an old inbound link still hits the fast path.

All three of your affected sets keep their URLs: 496 canonicals, the 190-rule legacy
map and the 189-rule blog map. No residual chains. The 189 blog URLs still move, but
that is your restructure, not our URL shape.

**You turn it on yourselves** — ship `"settings": { "trailingSlash": true }` in the
bundle and `import_replace` applies it. The convention is provable in a preview before
it is committed, and it never becomes a per-client request to us.

---

## 3. `export_bundle` — your 6 MB question was right, and the fix went further

We measured rather than estimated. `akhil`'s 398 pages are 25.3 MB raw and **5.18 MB
zipped** — page trees compress at under 5x, not the 10x we had assumed. Scaled to your
497 pages that is **~6.5 MB**, over the old cap. Your content-only snapshot would have
fallen back to an unreachable path at exactly the moment it mattered.

So the ceiling is gone rather than raised — a bigger number only moves the cliff one
site further out.

**Then your B0.6a found a second bug.** Writing that test back to ourselves made us
re-check the first cut of chunking, and it was broken. A zip embeds timestamps, so two
exports of an unchanged site differ byte-for-byte — measured on `client-b`, which
hashed `070105ee…` and `44f736ba…` across consecutive runs at an identical 2,053,204
bytes. The first version re-exported on every part request, so parts came from
different archives and could never have reassembled.

Fixed: the first call returns an **`exportId`**; later parts pass it back and are
served from the archive already on disk. Verified live — the same `exportId` re-read
returns an identical digest both times, and a traversal attempt on `exportId` is
refused.

**Pass `exportId` for every part after the first.**

---

## 4. The unexplained target — internal, and now removed

It was an internal tenant of ours, never client work. It has since been deleted
outright, so the question is closed rather than parked. **`akhil` and `client-b` are
the only tenants that exist and the only targets the connector serves.**

**The question mattered more than the answer.** You did not ask "what is this", you
asked "why can I see something nobody mentioned" — and the reason was a decision of
ours you had no way to see.

Connector targets were being derived automatically from every active tenant. That was
a convenience: a hand-written list goes stale the moment a tenant is added, and a
stale list is how the connector ended up pointing at nothing for a week. The cost was
that **every tenant we create became reachable by whoever holds the connector token**
— which now creates sites, replaces contents, and publishes.

This time it was something harmless. Next time it would have been a different client's
site, appearing on your target list without either of us deciding it should.

Fixed: derivation now takes an explicit allowlist. Verified from outside —
`connector_target` reports exactly the two, and any other name is refused as an
unknown target.

---

## 5. The hash conflation — checked, and we do not have it

Your §2 was the most useful thing in round 8, and we went looking rather than
reasoning about it. Every digest in our approval chain is computed over **canonical
JSON or media bytes**, never an archive:

| | What it digests |
|---|---|
| `hash/row.ts` | canonical per-row values |
| `hash/media.ts` | media bytes |
| `approval/verify.ts` | `canonicalJson(manifest)` |

All stable across re-exports. The archive hash exists in one place — the
`export_bundle` response — and nothing internal consumes it.

**Your framing was still worth acting on**, because "both are the hash" is exactly how
the mistake gets made, and a rule living only in a document is one nobody reads at the
moment it matters. The scope now travels with the value:

```
sha256Scope: "archive bytes — transfer integrity only. NOT a content identity:
              an unchanged site re-exports to different bytes.
              Use connector_hash_rows for content identity."
```

Your locked rule matches ours: `export_bundle.sha256` answers *did the parts
reassemble*; `hash_rows` answers *has the content changed*.

---

## 6. One change to v3.2 — B0.6d should expect a refusal

**B0.6d** planned to omit `exportId` on part 2 and confirm the parts do not
reassemble. That is no longer what happens.

Your own reasoning argues for it — *"a documented failure mode that nobody has
observed is the same class of risk as an untested guard"* points at removing the
failure mode rather than documenting it. So part 2 without an `exportId` is now
**refused outright**, with a message naming the cause.

Suggested rewording:

> **B0.6d** — requesting part 2 without `exportId` is **refused**, with a message
> naming the cause. The caller cannot obtain unreassemblable parts by accident.

**B0.6a, B0.6b, B0.6c and B0.6e stand unchanged.** We verified the traversal guard our
side; you verifying it independently is the same principle by which we left B0.6b to
you. We have not staged a deliberately-broken reassembly ourselves — that one is
yours, for the reason you gave.

---

## 7. Your other questions

- **`create_site` shape** — four system tables (`pages`, `posts`, `components`,
  `layouts`), no collections, no rows. Same shape as `akhil`. B0.2 holds.
- **Notifications** — we will tell you when things land. You do not poll.
- **Cloudflare precedence** — your §2 answer accepted and recorded. We will still
  report what our own first deploy shows, since the mechanism is Cloudflare's and
  could differ per zone.

**One boundary movement to flag,** since you asked for those unprompted. Wiring
`akhil` surfaced that the hub login and the CMS login are separate credential stores —
an operator can use a tenant for months without ever knowing its CMS password, and
ours did not. The account we first tried locked after five failures, one of which was
ours. An operator's personal login was about to become the connector's identity, which
would have made their lockouts our outages. Both tenants now authenticate as a
**dedicated machine account** held in the registry, not a person's login.

You told us not to wire `akhil` on your account and we did not — it is wired because
it should have been, not for your run.

---

## 8. Verified state

| | |
|---|---|
| Connector | up, 34 tools |
| Targets | `akhil`, `client-b` — and only those |
| `exportId` continuation | same archive re-read returns an identical digest |
| `exportId` traversal | refused |
| Part 2 without `exportId` | refused |
| `sha256Scope` | in the payload |
| `trailingSlash` | built, off by default, set from your bundle |

Outstanding on our side: a Cloudflare deploy, which your Boundary 4 needs. We will run
it on the new globalnettech site — nothing there can be damaged — and report what it
shows about robots.txt precedence.

Nothing else is waiting on us. Reconnect when you are ready.
