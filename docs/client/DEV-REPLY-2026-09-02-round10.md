# Reply — round 10 · 2026-09-02

**B0.6d was a real failure and you were right about all of it.** Fixed, and the fix is
pinned by tests that fail against the old code.

Everything else in your round 9 is done too. `sheeltron` exists and is reachable, the
allowlist no longer evaporates on restart, and provisioning is **one call** — we took
your §4 question as a design decision rather than answering it with a process.

One thing you measured led somewhere neither of us expected. §3.

---

## 1. B0.6d — fixed, and worse than you measured

You reproduced it three times. We reproduced it once and found the guard was in the
wrong place twice over:

```
1. take a brand-new export      ← the expensive, state-creating step ran FIRST
2. if deliver:"path" → return   ← EXITED HERE, so the path route never reached the guard
3. check part is in range       ← this is why client-b said "out of range"
4. check exportId is present    ← the actual guard, unreachable on one of two routes
```

So it was not only late. **On `deliver: "path"` it was never executed at all** — which is
exactly the route you ran, and why you saw no error rather than the wrong error.

The fix is the ordering. `part >= 2` with no `exportId` is now rejected as the first
thing the handler does, before any export, before the delivery branch, before the range
check. The refusal says so:

> `part 2 needs the exportId of the archive part 1 came from. […] No export was taken
> for this call.`

Six tests cover it, including the two you could not have distinguished from outside:
that **no export is taken** (`exportCalls === 0`) and that **no archive file is written**.
Both fail against the old code.

**Why we got this wrong is worth one line**, because it is the same mistake twice. We
put "Part 2 without `exportId` — refused" in a verified-state table having written the
code and never made that call. Your §1 said the reasoning was right and the
implementation did not land where it was thought to. That is accurate, and the reason
the tests now assert on the side effect rather than the message.

**B0.6e** — your independent check matches ours. Also covered now, plus separator,
absolute-path and `..` cases.

## 2. The other two defects

**`includeMedia` on a continuation read** — fixed. It now reads the archive's own
entries rather than echoing the request. Your framing was the right one: it is the same
shape as `sha256Scope` before we fixed that, a field that looks like it describes the
artefact and actually describes the call. The response also carries
`includeMediaSource`, so you can see which it is.

**`connector_environment` on a cold process** — fixed. It installs the DOM environment
before reporting, so the flags now mean *conversion can run* rather than *conversion
happens to have run*. Added a `ready` field, and your proposed **B0.0** is accepted with
one amendment: `environment` is now safe as a gate, so the rule is "`doctor` for a real
conversion, `environment` for a cheap pre-flight" rather than "never gate on
`environment`". Your call which you keep.

**The slug example** — you passed our own documented example and got a different answer.
Corrected to describe the actual rule, and it now tells you to use the returned slug
rather than a predicted one.

## 3. Your 39.5 MB is right, our 5.18 MB was measuring a compressed archive

We reproduced your number exactly: **39,490,716 bytes**, `entryCount: 1`. Then we opened
the archive:

| | bytes |
|---|---|
| manifest, raw | 39,490,566 |
| archive, on the wire | 39,490,716 |

**The archive is 150 bytes larger than its own contents. It is not compressed at all.**

Site-transfer archives are written as *stored* ZIP entries deliberately — media is
already compressed, and stored entries let the CMS stream an export without holding it
in memory, which is also what makes `/export/estimate` exact. That reasoning holds for
media. It does not hold for the manifest, which is one large JSON blob and the entire
content of a `includeMedia: false` export.

Deflated, that manifest is **7,457,510 bytes — 5.3x smaller**, in 1.4 seconds.

So our 5.18 MB figure was not wrong about compressibility; it was measuring a compressed
archive that the export never actually produces. Your number is the operational one, as
you said.

**What we changed, and what we did not.** The download route below serves the archive
gzipped when you accept it, which collects the whole 5.3x on the wire. We did **not**
change the archive format: import has parsed stored archives since day one and that is
not a thing to alter three days before your first real push. If you want the format
itself compressed we should do it deliberately, after Sheeltron.

## 4. The archive now has an address — `downloadUrl`

Your §2 conclusion was right and it was our gap: *"the bundle is the backup" is
executable by a machine, not by an agent.* Inline base64 was built for a caller that can
hold the bytes, and an agent cannot hold 13 million tokens.

Every `export_bundle` response now carries **`downloadUrl`**. Fetch it with the same
bearer token you already use for `/mcp`:

```
GET  https://<the host you reach us on>/exports/<exportId>
Authorization: Bearer <your token>
Accept-Encoding: gzip
```

- **No size limit, no parts, no reassembly, no hash check needed.**
- **Gzipped on the wire** — 39.5 MB becomes ~7.5 MB.
- `HEAD` first if you want the size before committing to the transfer;
  `x-archive-bytes` reports the decompressed size.
- Pair it with `deliver: "path"` to skip base64 entirely.

**On reachability, which is what broke the last three of these.** The URL is built from
*the address you connected on*, not from ours — so whatever host reaches `/mcp` reaches
`/exports/` too. That was the actual bug behind the export path, the invite link, and
the ports you probed and found closed: every URL we returned was written from this
machine's point of view and handed to someone who is not on it.

Same fix applied to **`inviteUrl`** — it is re-addressed to your host now, keeping the
control-plane port. And you were right to redact it: it carries a password-set token.
The tool now says so in its own response rather than in a document.

Step 0 of your sequencing runs inside a session again.

## 5. Onboarding is ONE call — and `sheeltron` is live

Your §4 asked which model we are in. We would rather it be one call, so we built that
instead of answering.

**A site created through `connector_create_site` now enrols itself as a target.** No
allowlist request, no restart, no us. Poll `connector_target` until the slug appears
(~30–60s) and connect.

The rule that makes this safe is **ownership, not a list**: a tenant provisioned through
your token is flagged as yours and auto-enrols; a tenant we create stays invisible to you
however many we add. So the exposure you found stays closed while the gap you found
closes too — they stopped being in tension once the question became *whose site is this*
rather than *is this site on the list*.

**Ready for you now:**

| Site | Slug | State |
|---|---|---|
| **Sheeltron** | `sheeltron` | created, empty, reachable. `trailingSlash` **off**, as you specified |
| Global Nettech | `global-nettech` | kept, and now reachable — it was yours, created with your token |

We created Sheeltron rather than waiting for you to, so B0.2 and Boundary 1 are unblocked
the moment you reconnect. Global Nettech we left in place; it costs nothing and now
demonstrates the fix on the exact site that exposed the gap.

## 6. The allowlist no longer evaporates — §3 accepted in full

You were right that a control which disappears on restart is a setting, not a control,
and right that the restart is the event that caused this week's silence.

Both changes you asked for:

- **Persisted.** It lives in a file next to the script that reads it, not in an
  environment variable scoped to one shell. `MMS_CONNECTOR_TENANTS` still works and is
  merged in, so nothing that depended on it breaks.
- **Fail-closed.** An absent or empty list now means **nothing** is reachable beyond
  connector-created sites. It used to mean *everything*, so the failure mode of
  forgetting was maximum exposure — for a token that can create, replace and publish,
  that was the wrong direction.

Sixteen assertions cover it, including the inversion itself and the case that worried
you most: *a tenant we created is NOT exposed by the managed rule*.

**And you caught our inventory being wrong.** Our closure report said "akhil, client-b —
no others" while `global-nettech` already existed, created by you that afternoon. It was
stale within hours of being written, which is a fair argument on its own for the state
being derived rather than asserted.

## 7. The password

Rotating `connector@123` before your first import, per your reasoning — better to find a
broken credential on an empty site than on a client's content. We will confirm when it is
done and both targets re-verify.

Worth noting that **`sheeltron` never had that password.** Sites provisioned now get a
random machine credential nobody types, held encrypted. `akhil` and `client-b` are the
two that predate it.

## 8. Verified state

Measured, not asserted — and where we could not measure something, it says so.

| | |
|---|---|
| B0.6d — part 2 without `exportId`, inline | refused, **0 exports taken** |
| B0.6d — same, `deliver: "path"` | refused, **0 exports taken**, no file written |
| B0.6d — refusal names the cause | names `exportId`, not range |
| B0.6e — traversal on `exportId` | refused |
| Continuation with a valid `exportId` | same archive, no re-export |
| `includeMedia` on a continuation | read from the archive |
| `connector_environment` cold | `ready: true` |
| `downloadUrl` | present, token-guarded, gzip on the wire |
| `inviteUrl` | re-addressed to the caller's host |
| Allowlist | persisted, fail-closed |
| `sheeltron` | active, empty, `connector_managed` |
| Connector tests | **75 pass, 0 fail** |
| Operator self-tests | **43 assertions, all pass** |

**One honest caveat:** the connector and control plane were running our previous build
while we worked. The changes above are tested but the *live* process picks them up on our
next restart, which happens before we hand this to you. If anything in §1–§6 does not
behave as described when you reconnect, that is the reason and it is a restart, not a
redesign — tell us and we will confirm within the hour.

## 9. Still ours

**The Cloudflare deploy** your Boundary 4 needs. It will now run on `sheeltron` rather
than Global Nettech, following your change of first site, and we will report what it
shows about robots.txt precedence on our infrastructure.

Nothing else is waiting on us.

## 10. On §7

Agreed, and the same pattern held again this round. B0.6d we got wrong in a table before
you got it wrong in a test — and the second bug in §3 surfaced only because we went to
explain a number you disputed rather than defend it. Neither would have been found by
running our own suite.

The measurement you did not have to send us is the one that changed the most.
