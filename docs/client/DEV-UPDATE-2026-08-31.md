# Instatic CMS — status update · 2026-08-31

**This one message replaces the four we sent today.** They were written as separate
replies to separate documents and together they are hard to read. Nothing in them is
withdrawn — this is the same content, in one place, in the order you need it.

Superseded: `DEV-REPLY-2026-08-31.md`, `DEV-REPLY-2026-08-31-round4.md`,
`DEV-REPLY-2026-08-31-acceptance-review.md`, `DEV-REVIEW-2026-08-31-acceptance-v2.md`.

---

## 1. What we fixed

Eight changes. All written, tested and applied to our build.

| # | What was wrong | Now |
|---|---|---|
| 1 | **Per-row SEO never rendered on `pages`.** Authorable, stored, silently discarded before render. Collection entries worked; pages did not | Pages read their own row. Covers the static bake, the live fallback and republish |
| 2 | **`og:image` published a dead path.** A `media` field stores an asset id; nothing turned it into a URL, and a bare id passed validation as a relative URL | Resolved to the real asset path, then made absolute |
| 3 | **`og:image` was relative even when correct.** Facebook, LinkedIn, Slack and X drop a relative one — the card renders blank and nothing errors | Made absolute against the page's own canonical. No new setting to fill in |
| 4 | **`preview_import` accepted cells for fields that do not exist**, silently. The same stored-but-invisible shape as #1 | Reports `unknownFields` with table, field and row count |
| 5 | **`export_manifest` killed the connector session.** No projection, no paging — 398 rows with full bodies in one response | `rows: none/summary/full`, `tableId`, `limit`/`offset`, always reports `counts` and `rowsTruncated` |
| 6 | **`publish.headers` was a plugin hook that did nothing.** Declared in the SDK, never invoked by the host. You built against it and lost the work | Removed from the SDK and the docs, with the reason recorded |
| 7 | **Every published site was fully crawlable by default.** No robots.txt, no `_headers`, no meta robots anywhere in the CMS | The deploy step writes `robots.txt`, `_headers`, `llms.txt` and `sitemap.xml`. **Noindex is the default** |
| 8 | **A refused deploy looked like a successful one.** The tenant-triggered publish runs in the background and only logged failures | Refusals write a `failed` row to the deploys registry and surface on the tenant |

Two of these — #4 and #7 — exist because of your acceptance suite. Two more — the
`unknownFields` union rule and the `export_manifest` size cap — were **our bugs,
found by writing answers to you.** More on that in §5.

---

## 2. Indexing is now off by default, and hard to forget

This was your §4, and we took the strong version of it.

- **A checkbox** in the tenant's Edit screen — "Allow search engines to index this
  site" — next to the custom-domain field it interacts with.
- **Visible in three places**: `indexable`/`noindex` on the tenant list, a warning
  pill when a site has a custom domain *and* indexing off, and the consequence
  spelled out in the Details panel.
- **Publishing to a custom domain with indexing off is refused** — it throws before
  anything uploads, naming the domain and the switch. A `pages.dev` deploy is
  untouched, because a preview staying out of the index is correct.
- **The refusal is recorded**, not just logged (#8 above).
- **An override exists** for the deliberate case, but it must be passed explicitly.
  It is not a default and not a checkbox.

Confirmed against the live registry: the column exists with `default false`, and all
nine tenants currently read `false`.

Your worry was the inversion — the habit that protects a preview becoming the thing
that de-indexes production. That is the case this refuses to allow: the moment a site
gets a real domain, shipping it noindex stops being possible by accident.

---

## 3. The field contract

Copy these five verbatim. They are what `connector_add_seo_fields` writes, applied
identically to `pages` and `posts`, plus the two built-ins.

```json
[
  { "id": "canonicalUrl",  "type": "url",      "label": "Canonical URL" },
  { "id": "ogTitle",       "type": "text",     "label": "Open Graph title" },
  { "id": "ogDescription", "type": "longText", "label": "Open Graph description" },
  { "id": "ogImage",       "type": "media",    "label": "Open Graph image" },
  { "id": "jsonLd",        "type": "longText", "label": "JSON-LD structured data" }
]
```

Built-in already: `seoTitle` (`text`), `seoDescription` (`longText`).

- **`jsonLd` is one string, one `<script>` tag.** For your four-blocks-per-page case,
  send a top-level JSON array (or `@graph`). We emit it verbatim except `<` → `<`,
  which is a tag-breakout guard and parses back to the original character. All 1,728
  blocks survive as long as each page's set is one valid JSON document.
- **`canonicalUrl` — absolute, and no normalisation anywhere.** Trailing slashes are
  neither added nor stripped, on the write path or the render path. Global Nettech's
  slashes and Lovedale's stripped ones cannot interfere with each other. The only
  transformation is HTML attribute escaping (`&` → `&amp;`), which decodes back
  identically.
- **`ogImage` — send an absolute URL.** The `media` type is an editor picker hint,
  not a write constraint.
- **Blank, whitespace-only or non-string cells fall through** to site settings,
  exactly as an absent cell does.

**Ship the `pages` table in your bundle with these fields appended.** That is the
supported path. Use `replace` — it is also the only strategy that carries redirects
and media folders, and the only one that applies your table definitions to an
existing table.

---

## 4. Two decisions we need from you

### 4.1 The trailing slash, before cutover

This is the one worth ten minutes now.

Instatic bakes routes without a trailing slash — `about-us` becomes `/about-us`.
Your Global Nettech canonicals are `https://globalnettech.com/about-us/`.

**Consequence today:** your acceptance test B3.2a — "the canonical's path matches the
page's path" — compares `/about-us/` against `/about-us` and fails on all 497 pages
while the data is perfectly correct. Normalise trailing slashes **in the comparison
only**; the stored value is already pinned byte-for-byte by B1.2, B2.4 and B2.5.

**Consequence after cutover, which matters more:** Cloudflare Pages serves
`about-us.html` at `/about-us` and redirects `/about-us/` to it. So every one of your
496 canonicals would point at a URL that 301s to the real one. B3.2b would pass
following redirects while the SEO outcome is worse than it looks — a hollow pass of
exactly the kind you rejected on B2.12.

**Our recommendation:** normalise canonicals to the slash-less form when you build the
bundle for the CMS-hosted site. Preserving the source site's slashes is right for
fidelity and wrong as a canonical for a host that does not serve them. One line at
bundle-build time, nothing needed from us.

The alternative is Instatic baking `about-us/index.html` so trailing-slash URLs are
real routes. That changes the URL shape of every site on the platform, so we are not
proposing it for one convention — but say so and we will scope it properly.

**Decide before cutover. It is cheap now and a re-crawl later.**

### 4.2 Your rollback material is not reachable

Your v2 sequencing opens with "export a known-good bundle first — it is the only
rollback material that exists", and makes it the gate on everything else.

You cannot currently do it. `connector_export_bundle` writes the archive to disk **on
our host** and hands you a path you cannot fetch — you told us this yourself in round
2 §8, and v2 made that export load-bearing without it being fixed.

**Use `connector_export_manifest` with `rows: "full"` instead.** It returns the
manifest over the wire — tables, rows, redirects:

```
connector_export_manifest  rows: "full", tableId: "pages", limit: 200, offset: 0
connector_export_manifest  rows: "full", tableId: "pages", offset: <nextOffset>
…  until rowsTruncated is 0
```

Use the `nextOffset` the response returns rather than adding your own limit — pages
are also capped by a size budget, so a page of large rows stops short of the limit you
asked for, and `offset + limit` would skip the rows the budget trimmed.

Concatenate the `rows` arrays and it re-imports. We checked rather than assumed:
bundle validation *cleans* unknown properties rather than rejecting them, so the extra
keys our projection adds are stripped on import.

**Media bytes are the exception** — those still only come out as a zip on our host, so
treat media as separately durable and ask us for the file. For content rollback, which
is what step 0 is about, the manifest is the material.

Tell us if you would rather have the bundle bytes returned directly and we will add
it. We did not build it speculatively because a 57 MB payload over the tool channel is
its own failure mode.

---

## 5. Two bugs your process caught in ours

Worth naming, because both were invisible to an end-to-end run.

**`unknownFields` would have failed on a *correct* bundle.** It compared your cells
against the *local* schema. Your bundle ships `pages` carrying the five SEO fields
while the instance has two — so it would have flagged all five across 497 rows as
unknown. A false positive on exactly the bundle the check exists to wave through, and
it would have buried the real signal in noise. It now compares against the union of
your table definition and ours. Your B1.9/B1.12 split is the right shape and we
adopted it.

**Our own `export_manifest` advice was wrong.** Writing §4.2 above, we nearly told you
to page with `rows: "full"` at a limit of 1000 — which for 497 full page rows
reproduces the same 40 MB response that killed your session in the first place. A row
count is not a size. There is now a size budget as well as a count, with `nextOffset`
so a short page cannot silently skip rows.

Neither rule had a test on it. Both do now.

---

## 6. Your other open items

- **Read-only mirror of our tree** — agreed in principle; it is an access decision
  with the owner and we will come back with the mechanism, not a maybe.
- **Plugin install** — ours to run, confirmed. The connector has no plugin tool and we
  will not add one now the noindex plugin is moot.
- **Plugin state** — `api.cms.settings` and `api.cms.storage.collection(id)`. No
  home-grown store.
- **Site provisioning** — not exposed. A standing onboarding request for now.
- **Recovery** — you are right, there is no published-version restore. We searched
  rather than assumed: the only `restore` in the CMS is for soft-deleted media.
  Publishing keeps exactly **one** previous generation on disk in the inactive slot,
  with no operator control to swap back. B5.2 is the real mechanism, and
  *reconstruction* is the correct word for it. Which is what makes §4.2 above worth
  fixing before you start, not after.
- **Lovedale** — your split accepted as written. We finish the platform side, you own
  content and the bundle, neither side edits `client-b` rows without saying so.

---

## 7. What is not done

Being exact, because "fixed" and "live" are not the same thing.

| | State |
|---|---|
| Code changes | Done |
| CMS build | Applied |
| Registry migration | Applied — all 9 tenants default to noindex |
| **Cloudflare deploy** | **Not run** |
| **SEO fields on `akhil` / `client-b`** | **Not added** — still `seoTitle` + `seoDescription` only |
| **`client-b` orphan teardown** | **Not done** |
| **Clean site for globalnettech** | **Not done** |

Two consequences for your test run:

- **Boundary 4 is not testable yet.** No deploy has happened, so no tenant serves the
  new root files. Our evidence is a 17-assertion self-test on the deploy step, not a
  live URL — treat that as our evidence, not your verification, exactly as you framed
  it.
- **Boundary 2 will show the intermediate state you predicted in B2.1.** Per-row title
  and description render now; canonical and JSON-LD stay absent until the carrier
  fields exist. That is expected, not a regression.

On `client-b`: the owner's GO is noted and your sequencing accepted — redeploy the
noindex pair over it, then delete the project. Both are operator actions on our
Cloudflare account, queued with the deploy above.

---

## 8. Verification

61 tests pass across the SEO, import-preview and round-trip suites, plus 17
assertions on the deploy step's root files. Full typecheck clean.

New coverage where there was none: the published `<head>` (canonical, Open Graph,
JSON-LD, escaping, unsafe-URL rejection, the `og:image` rules), the `unknownFields`
rule, and the root files including the transition case — a site flipped back to
noindex deletes the sitemap it published while it was open.

Your standing agreement holds from our side: if your suite goes red, our default
assumption is that it is right.
