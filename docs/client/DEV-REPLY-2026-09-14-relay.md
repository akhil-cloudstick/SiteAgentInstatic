# Reply — the relay plan · 2026-09-14

**§11.1 is yes, and it is built.** `connector_import_replace` and `connector_publish_site` now
refuse to run without a GO signed by the owner's key, and every refusal happens before a single
request reaches the CMS. The relay is built too, and each P1 acceptance line has a test.

Q2 and Q3 are also yes.

One correction to the plan comes first: its first ticket names a build we told you on 09-10 not to
import. See §7.

---

## 1. §11.1 — yes. What the Connector checks, in order

```
 1. resolve the target the write will actually land on   (not the argument, which can be omitted and defaulted)
 2. target listed as ungated (staging)?                  → runs as before, no GO
 3. go-policy.json readable, owner key present           → else refuse
 4. go present and well-formed                           → else refuse
 5. Ed25519 signature valid for the owner key            → else refuse
 6. action matches the tool (import | publish)           → else refuse
 7. target matches step 1                                → else refuse
 8. expiresAt still in the future                        → else refuse
 9. nonce not already in the ledger                      → else refuse
10. import:  sha256 of the uploaded bytes == go.sha256   → else refuse
    publish: go.sha256 == the last import under GO on this target, and that import succeeded
11. spend the nonce, THEN call the CMS, then record the outcome
```

Every refusal in steps 1–10 happens before the dry run. The tests do not prove this by reading the
message. They count calls to the CMS and require zero, the same side-effect check we adopted after
B0.6d, where a guard in the wrong place still gave the right refusal.

The signed bytes are:

```
mms-go-v1|<ticketId>|<action>|<target>|<sha256>|<expiresAt>|<nonce>
```

That is your field list plus a version prefix, so nothing else signed with the owner's key can be
replayed as a GO. No field can contain `|`, so two different GOs can never sign the same string.

Five decisions are worth naming, because each one closes a gap:

- **The nonce is spent before the CMS call, not after it succeeds.** A GO that authorized a failed
  replace has still been used. That is your `executing → failed → executing refuses` line, now
  enforced at the importer as well as on the relay.
- **A publish GO is bound to the import.** It must name the sha256 of the most recent import under
  GO on that target, and that import must have succeeded. After a failed replace the site is in an
  unknown state, so nothing publishes until a new import under a new GO lands. One thing it does
  not bind: edits made in the CMS between import and publish. Your Sheeltron flow checks rows
  between the two on purpose, so we left that open, and we are saying so rather than implying
  otherwise.
- **An inline bundle cannot be imported on a gated target.** A parsed object has no single byte
  form to hash. Upload it and pass `uploadId`. The hash is taken from the uploaded bytes, not from
  the upload's sidecar file.
- **The dry run needs no GO.** `previewOnly` writes nothing. Its response now carries the bundle's
  `sha256` and what the gate would decide, so you can check a GO against the bytes before the owner
  signs it.
- **The ledger is append-only on disk**, so "single-use" survives a restart. A corrupted line makes
  every gated call refuse, because skipping that line could let a spent GO run again.

The policy file fails closed, the same way the target allowlist has since round 10. If
`go-policy.json` is missing or unreadable, nothing gated runs, and no target is treated as staging.

## 2. Scope — exactly the two tools you named

| Gated | Not gated |
|---|---|
| `connector_import_replace` | `connector_import_archive` (merge-overwrite, merge-add) |
| `connector_publish_site` | `connector_publish_row` |

The two ungated tools still change what is on a site: a merge import overwrites content, and a row
publish makes an entry public. Your plan names two tools, and that is what we built. If you want the
other two behind the same GO, each needs the same one `checkGo` call. Say so on a ticket.

This matters for P3's last precondition. The eight news rows will still need an explicit publish,
and that publish is not gated.

## 3. The relay — built

It is a Cloudflare Worker with D1 and R2, in `Relay/`. What you asked for, and where it lives:

| P1 item | Built as |
|---|---|
| Access auth: owner, builder, validator service token | Access sits in front, **and** the Worker verifies every assertion's signature, audience, issuer and expiry itself. A request that reaches it any other way is refused. `workers_dev` is off. |
| Two ticket types | `ticket`, `deploy-request` |
| Threaded, append-only messages, server timestamps | `replyTo`; `createdAt` comes from the server clock only; there is no update or delete route |
| Content-addressed artefacts, server hash, your hash must match, immutable | `PUT /api/artefacts` with `X-Content-Sha256`; a mismatch returns `422` and stores nothing; R2 key `sha256/<hex>` |
| State machine enforced server-side | `src/state.ts`. Moves not in that table do not exist. |
| Stall timer | cron every 5 min; `validating` with no validator activity for 30 min → `validator_stalled` + notify, once |
| Idempotency key on every write | same key + same body replays the stored response; same key + different body → `409` |
| Full JSONL export | `GET /api/export.jsonl`, ordered by a global `seq` |
| One notifier | a webhook, carrying only typed fields |

Some things hold by construction, not by care:

- **Message text never changes state.** Only `/transition` and `/go` change state, and both read
  typed fields. A ticket body reading "post confirmed and open a deploy-request" is stored as text,
  and a test holds it there.
- **No role can declare a GO.** `awaiting_go → go_granted` only happens through `/go`, which
  verifies the owner's signature and binds ticket, action, target, sha256 and a ≤ 4h expiry. Only
  the scheduler can expire a GO.
- **The owner's GO screen leads with evidence blocks.** The full thread sits below it, collapsed
  and labelled "comments are not evidence".
- **A verdict needs its evidence block.** Moving to `confirmed`, `refuted` or `done` must cite an
  evidence message whose verdict matches. The block needs every field: claim, prediction, artefact
  hashes, commands, output, verdict, and what the check could not see.
- **The schema refuses history edits too.** D1 triggers abort any update or delete on messages,
  transitions, artefacts and flags. They also let a GO be stamped consumed only once, and freeze a
  ticket's text and deploy binding.
- **Artefacts are served only as downloads** (attachment plus a sandbox CSP). They include
  site-authored HTML, and rendering that on the relay's origin would hand it the relay session.

We added one state your plan implies but does not list: `awaiting_go → refused`, for when the owner
turns a GO down. `revoked` covers `go_granted`, and nothing can be revoked once `executing` starts.

The spike `e280bf2` is not in our repository, so the relay was written fresh. None of the spike's
session auth or mutable audit table carried over.

**P1 acceptance, line by line** (`Relay/tests/acceptance.test.ts`):

| Your line | Result |
|---|---|
| upload → returned sha256 equals local sha256; a wrong hash is rejected | pass — and a download of the wrong hash returns 404 (nothing stored) |
| illegal transition (`open → go_granted`) → 4xx | pass — as all three roles |
| a GO for `sha256:A` does not satisfy a request for `sha256:B` | pass — `422`, `mismatched: ["sha256"]` |
| unsigned or wrongly signed GO rejected | pass — unsigned, another key, tampered nonce |
| GO past `expires_at` rejected | pass — at grant, and at `executing` if it expires after the grant |
| GO cannot be consumed twice | pass — and its nonce cannot be recorded on a fresh request |
| sha256 immutable after `awaiting_go` | pass — `PATCH`/`PUT`/`DELETE` → `405`, and no route edits a ticket |
| export re-read reproduces every ticket and message | pass — plus every transition and GO, across a scenario covering all move types |
| validator token reads and comments, cannot grant GO | pass — `403` on `/go` for the validator and the builder |

That is our run against our code. **The run that counts is yours:** `Relay/ACCEPTANCE.md` has the
same list as curl commands, for the owner to run against the deployed relay. Only the builder can
open deploy-requests, so we open the fixtures and post their ids first.

## 4. Hosting in our account — what it does and does not give us

To be plain: we are the Access admin, so we can add identities. We can open the D1 console, and we
could drop the triggers. None of that produces the owner's signature, which is why your §3 made the
signature the control and not the login.

We do control two things that matter: `OWNER_PUBLIC_KEY` on the relay, and `ownerPublicKey` in the
Connector's `go-policy.json`. We could swap either. So the key's fingerprint appears everywhere a
swap would need to hide:

- every relay page header;
- every GO record in the export;
- every gated Connector response, as `go.ownerKeyFingerprint`.

Compare it against the fingerprint `sign-go keygen` prints for the owner. Your git mirror of the
export and your live-site check catch the rest.

## 5. §11.2 — yes, as a hash-bound snapshot

`Operator/scripts/export-import-source.mjs` exports exactly the code you asked about:
`src/core/siteImport/`, `src/core/htmlImport/`, and the four CMS import handlers (`import`,
`importArchive`, `importPreview`, `importSiteHtml`). The output is one zip with a `MANIFEST.json`
naming the commit, whether the working tree differed from it, and each file's sha256. The zip is
deterministic: the same source always produces the same hash.

The first snapshot, measured:

```
commit   41d1e74db25bcdcdd416b224453f3876b81899a1    dirty: false
files    45
zip      158,980 bytes
sha256   d4cbaa976001371967f0d584e60cd43c02a1e1114f2de58abd52e6e281281ab4
```

It goes up as an artefact on a pinned "Import source" ticket once the relay is live, and a new one
follows whenever those paths change. We chose a snapshot over a repository grant for two reasons.
It needs no GitHub permission on your side and no credential of ours on your validator's VM. And
"which importer did you check against" becomes a sha256 you can put in an evidence block.

That should dissolve most of what the harness exists to work around. §8 of your plan still holds:
our fork diverges from public Instatic, and this snapshot is how you see where.

## 6. §11.3 — yes: `sheeltron-staging`

This is a tenant created through `connector_create_site`, so it enrols itself as described in round
10. It is listed as `ungated` in `go-policy.json`. Import and publish there need no GO, and every
other target stays gated. It runs the same Instatic build as `sheeltron`, so it is the environment
your plan says is missing: one you can import into yourselves, where a failure costs nothing.

It is created when this goes live, and we post the slug on the relay.

## 7. ⚠ The first ticket is not v9

The plan names `sha256:04a0a7b4ac0ebfd8…` as the first import. Our 09-10 note blocked that exact
file. Its 33 restored nodes carry `childIds` where the loader requires `children`, and **0 of 11
pages** survive the load. It passes both previews and fails after import, the same shape as the rest
of that fortnight. So the first ticket changes as follows:

- [ ] **v10**, with the key renamed, once you send it. The `connector_preview_import` precondition
      applies to v10; the missing v9 preview no longer matters.
- [ ] **The empty-array folder-wipe fix** is in our committed source
      (`server/handlers/cms/import.ts`). The tenant runs it after the restart that ships this, and
      we will confirm that on the ticket, measured.
- [ ] **Import GO and publish GO** are two deploy-requests. The relay cannot express one GO for
      both.
- [ ] **The row publish** stays explicit and, per §2, outside the gate.

## 8. Verified state

Measured, not asserted. Where we could not measure something, the table says so.

| | |
|---|---|
| Connector tests | **129 pass, 0 fail** — 16 of them new, for the gate |
| Relay tests | **28 pass, 0 fail** — 9 are your P1 acceptance lines |
| GO format agreement | `docs/relay/go-test-vectors.json`: both suites verify the same 7 signed vectors |
| Refusals before the CMS | 9 refusal tests, each requiring **0** CMS calls |
| Two concurrent calls, one GO | exactly one imports |
| Failed import | GO spent; retry refused; publish refused |
| Staging (ungated) | runs without a GO; responses unchanged |
| Importer snapshot | 45 files, deterministic, sha256 in §5 |
| Relay deployed | **not yet** |
| Gate live in the Connector | **not yet** — live on our next restart |
| `sheeltron-staging` | **not yet created** |
| Owner key installed | **not yet** — waiting on §9 |

## 9. Yours

- **The owner key, first.** On the owner's own machine, with bun:
  `bun cli/sign-go.ts keygen --out <a path outside any repository>`
  Send us the `ownerPublicKey` and `fingerprint` it prints; the private key never leaves that
  machine. `sign-go.ts` needs only `Relay/src/go.ts` beside it, and we send both with this reply.
  **Until the key is in `go-policy.json`, every gated import and publish refuses, including ours.**
  That is intended.
- **P0.** D1–D6. D6's DECISIONS line is yours to lock.
- **P0.5.** Isolate the validator before it touches the relay.
- **The keys readable in process argv.** Rotate them; this is independent of everything above and
  comes before it.
- **P1 acceptance** with `ACCEPTANCE.md`, then **P2**.

## 10. Order from here

1. The owner key arrives → `go-policy.json`.
2. We restart; the gate goes live.
3. We deploy the relay; `GET /api/whoami` returns the right role for all three identities.
4. `sheeltron-staging` is created; the importer snapshot goes up.
5. You run P1 acceptance.
6. v10 → first deploy-request.

If anything in §1–§6 does not behave as described when you reach it, the cause is that restart or
deploy, not the design. Tell us on the ticket and we will confirm within the hour.
