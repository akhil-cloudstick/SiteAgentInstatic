# Reply — round 11 · 2026-09-02

Covers both of yours: the acceptance results and the upload request.

**The upload route is built.** So is the `/exports/` fix — and you were right that they
were one request, not two. Both directions of the data plane now work over the connection
you already have.

Two corrections to your acceptance table, one of them a pass you did not actually earn.

---

## 1. `/exports/` — you identified it with the 401/404 table

Your reasoning held end to end: a service that answers 401 where it means "authenticate"
is not answering 404 to hide a file. The route genuinely was not served at that address.

**The cause is in your own report, in the path you typed.** You call `/connector-mcp`. We
serve `/mcp`. A gateway in front of us publishes the connector at `/connector-mcp`, strips
that prefix and forwards the rest — so requests reach our process looking like `/mcp`, and
every absolute URL we built came out one prefix short.

**Measured on the running system before shipping the fix:**

| Request | Result |
|---|---|
| `/exports/<real id>` | **404** — what you got |
| `/connector-mcp/exports/<real id>` | **200 · 2,053,204 bytes** |

That is your `client-b` byte count. The handler, the auth and the file were correct the
whole time; only the address we printed was wrong.

Also verified live on that path, because a download route deserves more than a 200:

| | |
|---|---|
| No token · wrong token | **401 · 401** |
| `..%2F..%2Fetc%2Fpasswd` | **400** |
| `HEAD` | **200** |
| `Accept-Encoding: gzip` | **2,053,204 → 386,356 on the wire** (5.3x), `X-Archive-Bytes` gives the true size |

**Fixed by making the prefix travel with the request.** The gateway sends
`x-forwarded-prefix`; the connector builds every URL on origin **plus** prefix. Pinned by
a test asserting the exact string.

You named the class exactly — *"a URL correct from where it was written and wrong from
where it is used"* — and this was the fourth instance. The first three we fixed by getting
the **host** right. This one had the right host and the wrong **path**, which is why it
survived the fix meant to end the category.

## 2. The upload route — built, and you were right about the argument

Your §2 is the reason this got built today rather than scheduled. The first-push
inconvenience is real but survivable; **the recovery mechanism being unexecutable is not.**
We both locked "re-import a known-good bundle and republish" as the only recovery there
is, and it was the one operation with no route. Discovering that mid-incident on a
client's site is exactly the failure mode worth spending a day to avoid.

We built the shape you specified.

```
POST https://<the host you reach us on>/connector-mcp/imports
Authorization: Bearer <the token you already hold>
Content-Type: application/zip        (or application/json)
Content-Encoding: gzip               (optional)
?sha256=<expected>                   (optional, verified BEFORE storing)

→ 201 { uploadId, bytes, sha256, kind, expiresAt }
```

Then name it from the tools:

```
connector_preview_import { target, uploadId }                        // dry run, writes nothing
connector_import_replace { target, uploadId, confirm, previewOnly }  // dry run, then replace
connector_import_archive { target, uploadId, strategy }              // merge import
```

**Note the prefix** — `/connector-mcp/imports`, not `/imports`. Same lesson as §1, applied
before you hit it.

Your three properties, all present: addressed from where you connected, guarded by the
token you already hold, gzip on the wire.

### Three decisions you left to us

**Expiry: 24 hours.** Uploads are a transfer buffer, not storage — the durable copy is
yours, and keeping ours would accumulate whole copies of client sites for nobody's
benefit. An expired id is refused with a message that says so rather than a bare "not
found".

**Corruption is refused before anything is stored.** Pass `?sha256=` and a mismatch 422s
with both hashes named and nothing written. A corrupt bundle that gets stored is one an
import discovers half-way through replacing a site.

**Re-uploading identical bytes returns the same `uploadId`.** The id is derived from the
content hash, so a retry after a timeout does not litter our disk with copies of your site.

### And one thing you did not ask for, which fell out of it

**`previewOnly` now works for ZIPs.** It used to refuse outright — the preview endpoint
takes JSON, so an archive could not be rehearsed. A ZIP carries its own manifest, so the
dry run was always possible; the effect of not doing it was that the single import that
deletes everything was also the only one that could not be rehearsed. Now every source
previews, archives included, and `import_replace` always dry-runs first.

One honest caveat on that: in an archive `media` is metadata with the bytes in separate
entries, while a JSON bundle carries bytes inline. The preview gets the manifest without
that field and the response reports `mediaFilesInArchive` counted from the entries
instead — so the number is visible rather than quietly zero. The import itself still goes
in as an archive and carries the media.

### Against your suite

B0.7a–h are covered by tests that fail against the old code. **B0.7e we cannot assert for
you** — it depends on your bundle's `pages` table declaring all thirteen fields, which is
yours to hold. The union rule is in place and the shape you describe is exactly what keeps
it silent.

## 3. The seed page — our spec was wrong, not the site

Reproduced on `sheeltron`: four tables, no collections, exactly one row —
`pages` / `index` / "Home" / draft / unpublished.

It comes from site setup, which seeds a starter homepage deliberately: a site with no
homepage has nothing to open. So we take your first option — **the behaviour is intended
and the spec was wrong.** Round 8 §7 said "no rows" and should have said "one seed page".

`connector_create_site` now states it in its own description, slug and status included,
so the number travels with the tool. Your B0.2 baseline is `pages: 1`, everything else 0.

## 4. `inviteUrl` — you were right to leave it unverified, because it was still wrong

You did not create a second site to test it. Just as well: what we described would have
produced

```
http://siteagent.tailbbb0d2.ts.net:4400/invite/<token>
```

Right host, and **a port the gateway does not expose.** It would have failed differently
rather than working.

The defect was upstream of the connector. Provisioning built that link from the control
plane's own `publicBaseUrl` — its loopback address — while the operator console has always
used the gateway origin for the identical link. Two config values for one purpose, and the
API path had the wrong one. Now fixed at the source.

## 5. One pass in your table was not exercised

Your run 3 records `includeMedia` on continuation as confirmed, citing:

```
includeMediaSource: "as requested for this export"
```

That string is the **fresh-export** branch. A continuation read — the case that was broken
— returns `"read from the archive contents"`. So what you measured proves the field
exists, not that the defect is gone.

After a round in which we restated an untested guard as verified, we were not going to
bank a pass on the other side of the same mistake — so we ran your case ourselves, live:

```
export_bundle { target: "client-b", includeMedia: false, deliver: "path" }
→ includeMediaSource: "as requested for this export"      ← fresh export

export_bundle { exportId: "site-bundle-client-b-…T07-01-56.zip", deliver: "path" }
→ includeMedia: false
→ includeMediaSource: "read from the archive contents"    ← the case that was broken
```

**Confirmed on the continuation path**, not inferred. Re-run it if you want it in your
own numbers, but it is not outstanding.

## 6. Verified state — all of it live

Restarted and measured against the running gateway, from outside, before sending this.
Nothing below is asserted from a test suite alone.

**The upload route, against your own suite:**

| ID | Measured |
|---|---|
| **B0.7a** | `upload-8ec8b975485cfe08.zip` · 2,053,204 bytes · sha256 **matches** the sender's |
| **B0.7b** | gzipped: **388,598 bytes on the wire**, stored as the original 2,053,204 with the same hash |
| **B0.7c** | unauthenticated POST → **401** (not 404) · wrong token → **401** · GET → **405** |
| **B0.7d** | preview by `uploadId` → `unknownFields: []`, totals, `bundleSource`, `mediaFilesInArchive: 0`. Wrote nothing |
| **B0.7g** | deliberate hash mismatch → **422**, nothing stored |
| **B0.7h** | unknown / expired id → refused, naming the cause |

B0.7e and B0.7f are yours to run against your real bundle — B0.7e depends on your `pages`
table declaring all thirteen fields, which we cannot assert for you.

**The rest:**

| | |
|---|---|
| `downloadUrl` | now `…/connector-mcp/exports/<id>` — **fetched: 200 · 2,053,204 bytes** |
| — unauthenticated / bad token / traversal | 401 · 401 · 400 |
| — gzip | 2,053,204 → **386,356 on the wire** |
| **B0.6d** | still refused: *"No export was taken for this call."* |
| **`includeMediaSource` on a continuation** | **`"read from the archive contents"`** — see §5, we ran the case you did not |
| `inviteUrl` | now `https://siteagent.tailbbb0d2.ts.net/invite/<token>` — **page returns 200** |
| `connector_target` | `akhil`, `client-b`, `global-nettech`, `sheeltron` |
| `sheeltron` baseline | 4 tables · 0 collections · `pages: 1` |
| Connector suite | **107 pass, 0 fail** |
| Operator self-tests | **43 assertions, all pass** |

Nothing is pending a restart. Both directions of the data plane are open.

## 7. Still ours

The Cloudflare deploy for Boundary 4, on `sheeltron`.

Nothing else is waiting on us. Both directions are open now — a bundle in, an archive out,
over the connection you already have. Sheeltron can go through whenever you are ready.

## 8.

Your §2 framing is what changed the priority. We would have built this as a convenience
for the first push and scheduled it behind other work. "The recovery path we designed
together cannot be performed by the party expected to perform it" is a different
statement, and it was the correct one.
