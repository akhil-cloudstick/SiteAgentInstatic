# Closure report — 2026-09-01

End-of-day state for the Instatic CMS / MMS Connector work. Everything below was
measured today, not recalled.

**Bottom line: the studio is unblocked.** The connector is live with both tenants
connected, every change from rounds 6–8 is shipped and verified, and the only item
left on our side is a Cloudflare deploy that nothing is currently waiting on.

---

## 1. Live state, verified

| Check | Result |
|---|---|
| Connector health | `{"ok":true,"service":"mms-connector-mcp"}` on `127.0.0.1:8787` |
| Tools exposed | 34 |
| Targets | `akhil`, `client-b` — and only those |
| Active tenants | `akhil`, `client-b` — no others |
| akhil read-through | Pages 398 · Posts 0 · Components 6 · Layouts 0 |
| `atlas-infra.pages.dev` | HTTP 200 |
| `siteagent-client-b.pages.dev` | does not resolve — deleted, as intended |

Test suites, all green:

- Instatic (SEO head, trailing-slash routes, unknown-field preview) — **25 pass, 0 fail**
- Connector — **38 pass, 0 fail**
- Deployer root files — **27 assertions, all pass**

Typecheck clean.

---

## 2. What shipped today

**Instatic**

- **`settings.trailingSlash`** — sites can publish directory URLs (`/about-us/`)
  instead of flat ones. Per-site, off by default, so no existing site's URLs move.
  Covers pages and collection entries, the sitemap, and the artefact reader.

**Connector**

- **`connector_export_bundle`** now returns the archive itself rather than a path on
  our host — base64, split across parts, with a whole-archive `sha256` and an
  `exportId` to keep every part from the same archive.
- **`connector_create_site`** — the studio can provision their own clean sites.
- **`connector_export_manifest`** — a 4 MB budget on the serialised page plus
  `nextOffset`, so a large read cannot silently short-change the caller.

**Operator**

- The connector is now a service in `npm run dev`. It was previously started by hand
  and had been dead since the 27 August processes were killed.
- Connector targets are derived from the registry, narrowed by an allowlist.
- New registry columns `connector_email` / `connector_password_enc` so the connector
  authenticates as a machine account rather than a person's login.

---

## 3. Bugs found and fixed today

Four, and the origin of each is worth noting because three came from writing
explanations rather than from running code.

| Bug | How it surfaced | Impact if shipped |
|---|---|---|
| **Export size cap was wrong** | The studio asked whether 497 pages would fit under 6 MB | Measured: 4.88x compression, ~6.5 MB. Their only rollback snapshot would have failed at the moment it mattered |
| **Chunked export could never reassemble** | Their new B0.6a test made us re-check our own fix | A zip embeds timestamps, so each part came from a different archive. Verified: identical 2,053,204-byte site hashed `070105ee…` then `44f736ba…` |
| **Deploy step deleted imported root files** | Checking a live deployment before a test deploy | `atlas-infra` serves an imported `sitemap.xml` for another domain; deploying would have silently deleted it |
| **`_headers` clobber** | Writing the test for the fix above | The first fix marked an imported file as ours, so the next deploy would have deleted it and its caching rules |

---

## 4. Credentials and configuration changed today

Recorded because these are operational facts someone else may need.

- **Connector token** — `MMS_CONNECTOR_MCP_TOKEN`, stored permanently. **Must be sent
  to the studio**; their agent cannot connect without it.
- **Machine account** — `connector@cloudstick.io` created in both tenants and stored
  encrypted in the registry. Both verified accepting login.
- **`MMS_CONNECTOR_TENANTS=akhil,client-b`** — set in the session. **Not yet permanent
  for new terminals**; see §6.
- **`akhil@cloudstick.io`** locked briefly after five failed logins, one of ours while
  verifying. Unlocked on its own; no data affected.

---

## 5. Outstanding

Nothing here blocks the studio.

| Item | Owner | Notes |
|---|---|---|
| **Cloudflare deploy** | us | Their Boundary 4 needs one. Best run on the new globalnettech site — nothing there can be damaged |
| **Clean globalnettech site** | studio | They can now create it themselves via `connector_create_site` |
| **Instatic rebuild** | us | `dist` predates the trailing-slash work. Server-side only, so nothing is broken — tidiness |
| **Weak passwords** | us | `connector@123` is an admin in both tenants that can publish. Worth changing after their test run; `scripts/set-tenant-password.mjs <slug> connector@cloudstick.io` updates the stored copy |

---

## 6. If the stack is restarted

The connector needs two environment values. One is permanent, one is not.

**Permanent, no action needed:** `MMS_CONNECTOR_MCP_TOKEN`.

**Session-only, will be lost:** `MMS_CONNECTOR_TENANTS`. Without it the connector
falls back to exposing *every* active tenant, rather than the two we intend. To make
it permanent:

```powershell
[Environment]::SetEnvironmentVariable('MMS_CONNECTOR_TENANTS','akhil,client-b','User')
```

Then start from a **new** terminal — permanent variables only load into terminals
opened after they are set:

```powershell
cd S:\SiteAgentHub\Operator
npm run dev
```

Expect `connector targets: akhil, client-b` and no warning block.

---

## 7. To send the studio

1. **[DEV-REPLY-2026-09-01-round8.md](DEV-REPLY-2026-09-01-round8.md)** — our half of
   round 8, covering everything above.
2. **The connector token.**

Earlier drafts (`DEV-REPLY-2026-09-01.md`) are superseded and should not be sent.

---

## 8. Note on how today went

Three of the four bugs above were found while writing answers to the studio, not while
testing. Their practice of sending acceptance tests *before* running them is what
surfaced two of those; their question about a size limit surfaced a third.

That arrangement is working and is worth keeping: they check our claims, we flag what
we know will fail, and the failures get found at the cheapest possible point rather
than on a live client site.
