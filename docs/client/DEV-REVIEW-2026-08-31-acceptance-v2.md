# Acceptance tests v2 — our review · 2026-08-31

All three v1 changes applied correctly. The two new tests (B1.12, B4.8) both pass,
and B4.8 is already asserted in our deployer self-test.

**Two findings, and the first one is the important one.** One new bar would fail on
every Global Nettech page while the data is perfectly correct — the same shape as
v1's B3.2, in the replacement we agreed. The other is that your Sequencing step 0
is not executable with the tools you have.

Writing up the second one then turned up a **bug in our own fix**, which we have
since corrected — the workaround we were about to recommend would have walked you
back into the 40 MB failure we claimed to have solved. Detail in §2.

**Since writing the above:** `siteagent-client-b.pages.dev` is **deleted** — see
§6. And checking a live deployment before our first test deploy found a second bug
of ours, plus a Cloudflare behaviour that changes how you should read B4.1. Both are
in §3, and both are worth reading before you run Boundary 4.

---

## 1. B3.2a fails on all 497 GN pages as written

**The trailing slash you are deliberately preserving is the thing that breaks it.**

Instatic bakes one artefact per route and derives the URL as `/${page.slug}` —
`publishSite.ts` line 270, no trailing slash, ever. `about-us` bakes to
`/about-us`. Your GN canonicals are `https://globalnettech.com/about-us/`.

So B3.2a — *"its path matches the path of the page it appears on"* — compares
`/about-us/` against `/about-us` and fails on every page that has a canonical.
496 red, nothing wrong.

**Fix for the test:** normalise trailing slashes on **both sides of the comparison
only**, never on the stored or emitted value. B1.2, B2.4 and B2.5 already pin that
the byte-for-byte value survives; B3.2a is asking a different question — "does this
canonical point at *this* page" — and that question is slash-insensitive.

### The part that matters more than the test

B3.2b is currently marked `n/a until cutover`. Please look at it now anyway,
because the same mismatch becomes a real defect the moment it stops being n/a.

After cutover, `globalnettech.com` is served from Cloudflare Pages out of the baked
slot. A request for `/about-us/` does not serve `about-us.html` directly — Pages
redirects it to `/about-us`. So every one of your 496 canonicals would point at a
URL that **301s to the real one**.

A canonical pointing at a redirect is a weak signal. Google follows it, but it is
explicitly discouraged and it is the kind of thing that quietly costs you the
consolidation the canonical was there to buy. B3.2b as written would pass — the URL
does resolve, following redirects — while the SEO outcome is worse than it looks.
That is a hollow pass of exactly the kind you rejected on B2.12.

**Our recommendation: normalise canonicals to the slash-less form when you build
the bundle for the CMS-hosted site.** Preserving the source site's trailing slashes
is right for fidelity and wrong as a canonical for a host that does not serve them.
It is a one-line change at bundle-build time and needs nothing from us.

The alternative — Instatic baking `about-us/index.html` so `/about-us/` is a real
route — would change the URL shape of every site on the platform. We are not
proposing it for one client's convention, but say so if you would rather we did,
and we will scope it properly rather than special-case it.

Either way, decide before cutover, not after. It is cheap now and a re-crawl later.

---

## 2. Sequencing step 0 is blocked — but there is a working substitute

> *"0. Export a known-good bundle first — it is the only rollback material that
> exists."*

You cannot do this with the tools you have, and you already told us why in round 2
§8: `connector_export_bundle` writes the archive to disk **on our host** and returns
a path (`S:\SiteAgentHub\Connector\exports\…`). You get a filename you cannot fetch.

Since v2 makes that export the gate on everything below it *and* names it your only
rollback material, it needs a real answer rather than a step nobody can run.

**Use `connector_export_manifest` with `rows: "full"` and paging.** It returns the
manifest as JSON over the wire — tables, rows, redirects:

```
connector_export_manifest  rows: "full", tableId: "pages", limit: 200, offset: 0
connector_export_manifest  rows: "full", tableId: "pages", offset: <nextOffset>
…  until rowsTruncated is 0
```

**Use the `nextOffset` the response gives you rather than adding your own limit**,
for a reason that is our correction to make, not yours to discover.

Writing this recommendation is what exposed it: a row count is not a size. The limit
was capped at 1000, which is harmless for summaries and reproduces the original
40 MB session kill for 497 full page rows. We would have told you to page with
`rows: "full"` straight back into the bug the projection exists to prevent.

Fixed: rows are now also capped by a **4 MB budget on the serialised page**, so a
`full` page of large rows stops well short of any limit you ask for. When it does,
the response carries `nextOffset` and a note saying it was cut short — deriving the
next offset yourself as `offset + limit` would silently skip every row the budget
trimmed. `rowsTruncated` stays honest either way, and a single row larger than the
whole budget is still returned alone rather than as an empty page, because an empty
page is indistinguishable from "no more rows" and would end your loop early.

Concatenate the `rows` arrays and you have a re-importable bundle. We checked the
round-trip rather than assuming it: bundle validation runs through `Value.Parse`,
which **cleans** unknown properties rather than rejecting them, so the extra
`counts` / `rowsReturned` / `rowsTruncated` / `nextOffset` / `note` keys our
projection adds are stripped on import instead of failing it. You do not need to
strip them yourself.

One caveat worth stating: each call re-runs the export, so a multi-page read is not
a single atomic snapshot. For rollback material captured before a push — nothing
else writing — that is fine. It is not a safe way to read a site being edited.

**The one thing this does not carry is media bytes.** For those the zip is still the
only route, and it still lands on our host — so treat media as separately durable
and ask us for the file when you need it. For content rollback, which is what step 0
is actually about, the manifest is the material.

If you would rather have the bundle bytes returned directly, say so and we will add
it. We did not build it speculatively because a 57 MB base64 payload over the tool
channel is its own failure mode, and a clean site's manifest comes back in kilobytes.

---

## 3. Before you run Boundary 4 — two things a live deployment told us

We checked `atlas-infra.pages.dev` (the `akhil` tenant) before running our own first
test deploy. It changed two things.

### 3.1 We were about to delete imported root files. Fixed.

That deployment serves a `sitemap.xml` we did not write — an **imported** one,
listing `atlas-infra.twinfo.io`, a different domain entirely. It came in with the
site import.

Our deploy step wrote `robots.txt`, `sitemap.xml`, `_headers` and `llms.txt`
unconditionally. Deploying that tenant would have **silently deleted its imported
sitemap**. Same shape as everything else this week: destroys something quietly, with
nothing reporting it.

Fixed. Every root file we write now carries a generated-by marker, and we manage
only the files carrying it. An imported `robots.txt`, `sitemap.xml`, `_headers` or
`llms.txt` is left alone.

**One deliberate exception, and it is the one that matters for B4.1:** when indexing
is **off**, `robots.txt` is overwritten even if imported, and a delimited noindex
block is appended to an imported `_headers` rather than replacing it. A crawler
block that a leftover file can defeat is not a block. When indexing is **on** we
defer to the site's own files in every case.

Writing the test for that caught a second bug immediately: appending our marker into
an imported `_headers` made the *next* deploy recognise the whole file as ours and
delete it, caching rules and all. Our block is now delimited, so we strip only our
part and their rules survive. **This adds a case worth putting in v3** — an imported
root file must survive a noindex → indexable → noindex cycle intact.

### 3.2 Cloudflare serves its own robots.txt, and we do not yet know if ours wins

`atlas-infra.pages.dev/robots.txt` returns **200 with a Cloudflare-generated
"content signals policy"** — a block of comments about `search`, `ai-input` and
`ai-train`, with **no `User-agent` or `Disallow` directive in it at all**. It blocks
nothing, but it occupies the URL.

Two consequences for your suite:

- Your round-1 observation that `/robots.txt` returned homepage HTML is no longer
  what a `pages.dev` host does. It now returns this.
- **B4.1 assumes the `robots.txt` we deploy is the one served.** We have not yet
  confirmed Cloudflare does not override or merge with it. If it does, the noindex
  guarantee rests on the `X-Robots-Tag` header alone.

We are not going to guess at Cloudflare's precedence — the first real deploy answers
it. **Please treat B4.1's `robots.txt` clause as unproven until that deploy**, and if
it comes back showing the content-signals text rather than `Disallow: /`, that is a
platform behaviour to design around rather than a defect in the file we wrote. We
will report the result either way.

---

## 4. Everything else — confirmed

**New tests, both pass:**

- **B1.12** — a cell for a field neither the bundle nor the table defines is still
  reported. This is exactly the residue the union comparison leaves, and it is the
  case your original probe found. Splitting it from B1.9 is the right call: v1
  conflated "the bundle is adding a field" with "this cell has nowhere to land".
- **B4.8** — already asserted in our deployer self-test, and it was the case we most
  wanted pinned too. A site flipped back to noindex deletes the sitemap it published
  while it was open, so a private site cannot keep serving a crawl map of itself.

**Your contract restatements are accurate**, including two we re-verified rather
than trusting our own earlier prose:

- **`replace` really is the only strategy carrying redirects and media folders.**
  Confirmed in `import.ts` — the media-folder and redirect blocks are inside the
  `replace` transaction only.
- **The `merge-add` warning is correctly stated.** An existing table's fields are
  left alone, so a field only your bundle declares is never created and its cells
  are stored unread. Your "use `replace`" conclusion follows.

**B4's framing is right and we would not want it softer.** Treating our self-test as
our evidence and not your verification is the correct line — B4 should stay unrun
until a deploy exists. We will tell you when one has. That test is now **27
assertions**, up from 17, the new ones covering §3.1.

**B5 is recorded accurately**, including the single-generation slot detail and the
consequence you drew from it. "Our bundle is the backup" is the correct reading, and
it is what makes finding 2 above worth fixing before you start rather than after.

---

## 5. Summary

| Item | Verdict |
|---|---|
| B3.2a as written | **Would fail on 497 correct pages** — normalise slashes in the comparison |
| B3.2b / cutover | **Decide the canonical convention now** — currently every canonical would point at a redirect |
| Sequencing step 0 | **Not executable** — use paged `export_manifest`, detail in §2 |
| B4.1 `robots.txt` clause | **Unproven** — Cloudflare serves its own; precedence unknown until the first deploy (§3.2) |
| Imported root files | **New case for v3** — must survive a noindex → indexable → noindex cycle (§3.1) |
| B1.12, B4.8 | Pass |
| B1.9, B2.12, B4.2 | Pass — the three v1 fixes hold |
| Everything else | Unchanged from our v1 review |

Findings 1 and 2 are decisions on your side, and we have given a recommendation on
each rather than just the problem.

### What we changed on our side

| Change | Trigger |
|---|---|
| `export_manifest` rows capped by a 4 MB budget, with `nextOffset` | Our own §2 recommendation would have reproduced the 40 MB session kill |
| Unit tests for `unknownFields` union semantics (7 cases) | We had changed that rule twice with no test on it — including once wrongly |
| Root files no longer overwrite or delete imported ones | A live deployment showed we were about to delete an imported sitemap (§3.1) |
| Our `_headers` block is delimited, not a whole-file marker | The first version of that fix made the next deploy eat an imported `_headers` (§3.1) |

Two of those four are ours, found by us, before they reached you — and both were
found by writing something down for you rather than by running code. The
`unknownFields` one is worth naming plainly: B1.9 is the defect your suite caught on
our side, and the rule it turned on had **no coverage at all** — we changed it,
shipped it, and only your test found it. It now has tests, including the exact
globalnettech shape (bundle carries the SEO fields, instance has two) that must stay
silent, and the neither-side case behind B1.12 that must stay loud.

Verification: 61 tests pass across the SEO, preview and round-trip suites, plus 27
deployer assertions. Typecheck clean.

---

## 6. Status

| | State |
|---|---|
| Code changes | Done |
| CMS build + registry migration | Applied |
| **`siteagent-client-b.pages.dev`** | **Deleted** — see below |
| Cloudflare deploy | **Not run** |
| SEO carrier fields on `akhil` | **Not added** — still `seoTitle` + `seoDescription` |
| Clean site for globalnettech | In progress |

**The Lovedale exposure is closed.** The Cloudflare Pages project was deleted with
the owner's GO. Verified from outside rather than trusted: a live control host
(`atlas-infra.pages.dev`) returns 200 while `siteagent-client-b.pages.dev` no longer
resolves at all — DNS is gone, not just the content. The CMS content, the tenant and
the Lovedale rows are untouched.

We took deletion rather than your redeploy-then-delete sequence. Deleting reaches the
same end state immediately and needed no working deploy path, which mattered because
the deploy changes had not been exercised yet. Your ordering was the right call under
the assumption that deletion might be delayed; it was not.

Boundary 4 remains unrun. The first deploy will be the **new globalnettech site**,
not an existing tenant — nothing there can be damaged, and it answers §3.2 at the
same time. We will send you the result.
