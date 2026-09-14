# Acceptance tests v1 — our review · 2026-08-31

Checked every ID against the code that will run. Taking you at your word: below is
everything we know we would fail, plus the corrections you asked for.

**Headline: three of your tests would have failed on our bugs, not yours, and all
three are fixed.** One of them (B1.9) would have failed on the *correct* bundle,
which is the worst kind — a test that punishes you for doing it right.

Summary: **1 expectation to change** (B3.2), **3 fixed here** (B1.9, B2.12, B4.2),
**B5.1 confirmed as you predicted**, and the rest we expect to pass.

**Updated after our first build.** B2.12 was originally flagged to you as an
expected-fail we would land later; it is now done, so the whole suite is expected
green except B3.2 (which needs rewording) and B5.1 (which fails by design). The
build and the registry migration are applied on our side. **No Cloudflare deploy has
run yet**, so nothing in Boundary 4 is live on a URL you can curl — see *Status* at
the end for exactly what is and is not in place.

---

## The contract table — confirmed correct

Your transcription of §2 is accurate. All seven ids and types match `SEO_FIELDS`
verbatim, and the fall-through rule is right as written. Nothing to change.

---

## Fixed while reviewing: B1.9 would have failed on a correct bundle

**Your test was right and our implementation was wrong.**

`unknownFields` compared bundle cells against the **local** table schema. Your
globalnettech bundle ships the `pages` table *carrying* the five SEO fields, while
`pages` on the instance currently has only `seoTitle`/`seoDescription`. So preview
would have reported `canonicalUrl`, `ogTitle`, `ogDescription`, `ogImage` and
`jsonLd` as unknown across all 497 rows — a false positive on the exact bundle the
check exists to wave through. B1.9 fails, and B1.8 becomes untrustworthy because
the signal is full of noise.

Fixed: the comparison is now against the **union** of the bundle's table definition
and the local one. `replace` and `merge-overwrite` both apply the bundle's fields
(`updateDataTable(..., fields: table.fields)`), so the union is the schema that will
actually exist after the import. What still gets reported is the real fault — a cell
addressed to a field neither side defines, which is precisely your original probe.

One honest gap, documented in the code rather than hidden: **`merge-add` leaves an
existing table's fields alone**, so a field only the bundle declares will not be
created and its cells would be stored unread. Preview does not receive the strategy,
so it cannot distinguish. We chose under-warning on the rarest strategy over crying
wolf on the two you will actually use. If you plan to use `merge-add` for a
schema-changing bundle, tell us and we will add a strategy parameter.

---

## Boundary 1 — expected to pass, and here is why

The import path is a **verbatim writer**. `upsertDataRow` / `replaceDataRow` write
`cells_json` straight through with no per-field-type validation, coercion or
normalisation. That single fact settles most of B1:

| ID | Verdict | Basis |
|---|---|---|
| B1.1 | Pass | `replace` calls `updateDataTable(..., fields)` on existing system tables, so the bundle's field list is applied to `pages` |
| B1.2 | Pass | No normalisation exists anywhere on the write path. Trailing slash survives |
| B1.3 | Pass | Same — query strings are not touched |
| B1.4 | **Pass** | The `media` type is a picker hint for the editor, not a write-time constraint. An absolute URL is stored unchanged, not coerced, not nulled |
| B1.5 | Pass | `longText` is a string column; a 4-object array survives as sent |
| B1.6 | Pass | Same. Unicode and quotes are not processed |
| B1.7 | Pass | Empty string stored as empty string |
| B1.8 | Pass | This is the regression test for the bug; reports table, field id and row count |
| B1.9 | Pass **after today's fix** — would have failed before | See above |
| B1.10 | Pass | Both are `replace`-only, as you noted, and both wipe-then-reinsert inside the import transaction |
| B1.11 | Pass | `rows: "summary"` omits cells; `counts` and `rowsTruncated` are always present |

B1.4 is worth dwelling on because it is the one you flagged as unknown to both of
us. The answer is that nothing validates it — which is why the `ogImage` trap
existed on the *render* side and had to be fixed there. Storage was never going to
catch it.

---

## Boundary 2 — B2.12 needed a stronger bar, and now passes it

**Please tighten B2.12 before you run it.** As you wrote it we would have passed
while leaving you with a real defect.

**B2.12 — `ogImage` as an editor-picked media id.** Resolving the id gives the
asset's `public_path`, which is a **root-relative path** (`/uploads/...`). That
returns 200, so your bar is satisfied — but `og:image` is one of the tags that
genuinely requires an absolute URL. Facebook, LinkedIn, Slack and X drop a relative
one rather than resolving it, so the test goes green and the share card still
renders with no image. A hollow pass is worse than a red.

Suggested wording:

> `og:image` content is an **absolute** URL (scheme + host) and returns 200.

**Now implemented, so the stronger bar passes.** We told you this would be an
expected-fail on the first run; it is not, because we found a way to do it without
new configuration. `SiteSettings` has never carried a site base URL, and adding one
would have created exactly the kind of field somebody forgets to fill — the failure
mode your §4 was about. Instead the publisher derives the origin from the
**document's own canonical**: a page declaring an absolute canonical has already
told us the origin it is served from, and its images come from that origin. Nothing
to configure, so nothing to forget.

- absolute `ogImage` (your bundle) → passes through untouched;
- relative `ogImage` + absolute canonical → absolutised against it;
- no canonical → keeps the relative path, exactly what it emitted before.

**For your bundle this remains moot** — you send absolute URLs (B2.11). It matters
for editor-picked images, which is where the trap actually lived.

The rest:

| ID | Verdict |
|---|---|
| B2.1 | Pass — and thank you for recording it as expected. This is exactly the intermediate state |
| B2.2 / B2.3 | Pass — page path is the new fix, entry path was already working |
| B2.4 / B2.5 | Pass — no normalisation, so the two conventions genuinely cannot interfere |
| B2.6 | Pass — `escapeHtml` escapes `& < > " '`; decodes back identically |
| B2.7 | Pass — one field, one `<script>`, array of 4 preserved |
| B2.8 | Pass — and verifying by parse rather than string match is the right call |
| B2.9 | Pass — `@graph` is emitted as untouched as an array is |
| B2.10 / B2.11 | Pass |
| B2.12 | Pass **after today's fix**, against the stronger absolute-URL bar above |
| B2.13 | Pass — blank falls through to site settings, no empty `content=""` |
| B2.14 | Pass — safe schemes are `http/https/mailto/tel/sms`; everything else emits no tag |
| B2.15 | Pass — and asserting it is right, it was a deliberate choice and should stay one |

---

## Boundary 3 — B3.2 needs changing

**B3.2 — "Every canonical resolves to a live URL on the same host" — please change
this one.**

It contradicts your own data. Your canonicals are absolute URLs pointing at
`globalnettech.com`, which is the whole point of shipping them. On a `pages.dev`
preview the canonical host is deliberately *not* the host being tested, so "same
host" fails on every one of 496 canonicals while the data is perfectly correct.

Two ways to write what you actually mean:

- **Before cutover:** every canonical is a well-formed absolute URL, and its
  **path** matches the path of the page it appears on. That catches the real defect
  (a canonical pointing at the wrong page) without asserting a host that is not yet
  true.
- **After cutover:** the current bar becomes correct, and worth keeping.

B3.1, B3.3, B3.4 and B3.5 are content-side and we have no objection. B3.1's
follow-redirects note is well made — the trailing-slash asymmetry between the two
sites is exactly the shape that produces a false red.

---

## Boundary 4 — B4.2 was going to fail on our side

**B4.2 — the `Sitemap:` line pointed at a file that does not exist.**

There is no sitemap generation anywhere in the CMS. Our robots.txt advertised
`/sitemap.xml` on an indexable site and nothing served it — advertising a 404 is
worse than omitting the line, and your test would have caught it.

Fixed: the deploy step now generates `sitemap.xml` from the baked output. The slot
is one file per route, so the directory is the route list — `index.html` → `/`,
`blog/post.html` → `/blog/post`, with `404.html` excluded. It is written only for an
indexable site, and **removed** when a site is not indexable, so a site turned back
to noindex stops serving a crawl map of itself.

Your B4.2 bar can stay as written, and gains a clause if you want it:

> ...and the advertised `Sitemap:` URL returns 200 and lists the published routes.

| ID | Verdict |
|---|---|
| B4.1 | Pass — deploy succeeds on `pages.dev`, which is the correct behaviour |
| B4.2 | Pass **after today's fix**; strengthen the bar as above |
| B4.3 | Pass — throws before any upload; message names domain and switch |
| B4.4 | Pass — writes a `failed` deploys row and sets `last_error` on the tenant |
| B4.5 | Pass — list shows `indexable`/`noindex`, warning pill on custom-domain-plus-noindex |
| B4.6 | Pass — a function argument, not a checkbox, not a default |
| B4.7 | Pass — the placeholder deploy writes the same guarded root files |

B4.4 is the test we would not have written, and it found a real hole when we built
the guard: the tenant-triggered publish path runs the deploy in the background and
only logged failures, so a refused deploy would have looked like a successful one.
Keep it.

**Evidence, since none of this is on a URL yet.** These four files decide whether a
client's site is crawlable and nothing was checking them, so the deploy step's
root-file logic now has its own test — 17 assertions, run with `npm run
test:deployer`, all passing. It covers B4.1, B4.2 and B4.7 at the file level:
`robots.txt` contents in both states, the `X-Robots-Tag` block, `llms.txt`, sitemap
route derivation (`index.html` → `/`, nested routes kept, `404.html` and non-page
assets excluded), and the absolute `Sitemap:` URL.

The case we most wanted pinned is the **transition**: a site flipped back to noindex
must stop advertising a sitemap *and* delete the one it published while it was open.
That is asserted, because it is the failure that would quietly leave a crawl map of
a private site on a public host.

We have also confirmed against the live registry that the column exists with
`default false` and that **all nine tenants currently read `false`** — the safe
default is real, not just declared.

---

## Boundary 5 — B5.1 confirmed, and here is the precise shape of the gap

**You are right. There is no published-version restore.** We searched for it rather
than assuming: no restore or rollback endpoint exists in the publish handlers or
repositories. The only `restore` in the CMS is for soft-deleted **media assets**.

What does exist, so the gap is recorded accurately rather than as folklore:

- Publishing writes into an inactive slot (`a`/`b`) and swaps a symlink, so **the
  previous generation is still on disk** until the next publish overwrites that
  slot. That is one generation of rollback material with **no operator control to
  swap back to it** — recoverable by hand, not by feature.
- `site_snapshots` holds published page snapshots, but there is no path that
  reinstates an older one.

So **B5.1 fails as you predicted**, and **B5.2 is the actual recovery mechanism**.
Your framing is the correct one: record it as a *reconstruction*, not a restore.
Reconstruction is only as good as the last bundle you exported, which makes your own
bundle the real backup — worth stating plainly to the owner.

---

## Your two open questions

**Site provisioning.** Not exposed today. The connector has 33 tools and none of
them create a site or a tenant; provisioning is a control-plane action on our side.
So for now: **a standing onboarding request**. Whether we expose it is an owner
decision we have not made yet — plan around the request, and we will tell you if
that changes rather than leaving you to discover a new tool.

**Recovery.** Answered above: no restore exists, B5 assumes correctly.

---

## What we changed because of this document

| Change | Trigger |
|---|---|
| `unknownFields` compares against bundle ∪ local schema | B1.9 would have failed on a correct bundle |
| `sitemap.xml` generated from baked output; removed when noindex | B4.2 advertised a 404 |
| `og:image` absolutised against the document canonical | B2.12, once we tightened its bar |
| Deployer root-file self-test (17 assertions) | B4 had no coverage at all |

All typecheck clean. 54 tests pass across the SEO, import and preview suites, plus
the 17 deployer assertions.

---

## Status — what is actually in place

Being precise, because "fixed" and "live" are not the same thing and this is the
distinction your B2.1 was written to protect.

| | State |
|---|---|
| Code changes | **Done** — all of the above |
| CMS build | **Applied** |
| Registry migration (`search_indexing`) | **Applied** — column present, all 9 tenants `false` |
| Cloudflare deploy | **Not run** |
| SEO carrier fields on `akhil` / `client-b` | **Not added** — still `seoTitle` + `seoDescription` only |
| `client-b` orphan teardown | **Not done** |

Two consequences for your run:

- **Boundary 4 is not curl-able yet.** No deploy has happened, so no tenant is
  serving the new `robots.txt`, `_headers`, `llms.txt` or `sitemap.xml`. Our
  evidence for it is the self-test above, not a live URL.
- **Boundary 2 will show the intermediate state you predicted in B2.1** until the
  carrier fields exist. Per-row title and description render now; canonical and
  JSON-LD stay absent because there is still nothing to read. Adding the fields is
  either your bundle or a one-line `connector_add_seo_fields`, and we would rather
  it be your bundle so the first real exercise is the path that matters.

Sequencing unchanged and agreed: the clean site gates B1, owner GO gates B2/B3, and
B4.3 needs a disposable domain we will provide rather than borrow from a client.

---

## One thing worth saying

The three-boundary split is the right design, and B1 is the half neither of us had
tested. Both bugs this document flushed out were on our side of a boundary we would
not have looked at without it — one of them only visible on a *correct* bundle,
which no end-to-end run would ever have isolated.

We will not contest a failure this suite reports. If it goes red, the default
assumption is that it is right.
