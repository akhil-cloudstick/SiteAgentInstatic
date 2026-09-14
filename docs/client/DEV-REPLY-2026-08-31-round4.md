# Reply — round 4 · 2026-08-31

No argument on §1 — and thank you for the correction, but it cost us nothing.
You audited what you had access to, which was our failing. The mirror is agreed.

Below: the field contract you asked for, one thing we found while answering it
that would have broken your bundle, and what we built for §4.

---

## 1. Read-only mirror — agreed

Agreed in principle. It is an access decision rather than a technical one, so
it is with the owner and we will come back with the mechanism, not a maybe.

In the meantime `bundleSchema.ts` still stands as sent, and §2 below is the part
you actually need to start building.

---

## 2. The field contract

### 2.1 Exact field ids and types — verbatim

From `SEO_FIELDS`, which is what `connector_add_seo_fields` writes, applied
identically to `pages` and `posts`:

```json
[
  { "id": "canonicalUrl",  "type": "url",      "label": "Canonical URL" },
  { "id": "ogTitle",       "type": "text",     "label": "Open Graph title" },
  { "id": "ogDescription", "type": "longText", "label": "Open Graph description" },
  { "id": "ogImage",       "type": "media",    "label": "Open Graph image" },
  { "id": "jsonLd",        "type": "longText", "label": "JSON-LD structured data" }
]
```

Plus the two that already exist as built-ins on both tables: `seoTitle` (`text`)
and `seoDescription` (`longText`).

Copy those five verbatim. Field ids are what the renderer reads; the labels are
cosmetic.

### 2.2 `jsonLd` — one string, emitted verbatim

`longText`, so **a single string, not an array of objects**. The renderer emits
exactly one `<script type="application/ld+json">` block containing your string
unchanged, with one transformation and no others: every `<` becomes `<`.

That escape is a tag-breakout guard, and it is invisible in the parsed result —
`<` is a valid JSON escape for `<`, so a consumer that parses the block gets
your original characters back. We do not parse, reserialise, reformat or reorder
your JSON. What you send is what ships.

**For your four-blocks-per-page case:** put a top-level JSON array in the field.

```json
[{"@context":"https://schema.org","@type":"ProfessionalService", ...},
 {"@context":"https://schema.org","@type":"WebSite", ...},
 {"@context":"https://schema.org","@type":"BreadcrumbList", ...},
 {"@context":"https://schema.org","@type":"BlogPosting", ...}]
```

A top-level array is valid inside a single `ld+json` script tag and is what
Google's own documentation shows for multiple entities. An `@graph` object works
equally well and is also emitted untouched — pick whichever your extractor
already produces. Do **not** send four separate blocks expecting four script
tags; you get one field, so you get one tag.

All 1,728 blocks survive as long as each page's set is one valid JSON document.

### 2.3 `ogImage` — send an absolute URL, and we fixed the trap under it

Send an **absolute URL string**.

The field type is `media`, which means a value picked in the editor is an asset
**id**, not a URL. That was a live trap for you and we found it while writing
this answer: a bare id has no URL scheme, our safety check treats scheme-less
values as relative URLs, so it passed validation and would have published
`og:image` pointing at a path that does not exist. Silent, and exactly the
stored-but-wrong shape we have been digging out all week.

Fixed: the page path now resolves a media id to its public path, and leaves any
value that is not a known asset id alone. So both work —

- an absolute URL from your bundle passes through untouched,
- an editor-picked image resolves to its real public path.

You do not need to do anything differently. We are telling you because if you
had shipped ids, it would have looked correct and been wrong.

### 2.4 `canonicalUrl` — absolute, and byte-for-byte

Send **absolute**. Relative values are technically accepted (they read as
scheme-less URLs) but a relative canonical is close to useless, so treat
absolute as required.

**No normalisation of any kind.** We do not add, strip, or rewrite trailing
slashes, do not lowercase, do not resolve, do not touch the query string. Global
Nettech's trailing slashes and Lovedale's stripped ones both survive exactly as
sent — the two sites will not interfere with each other.

The one transformation is HTML attribute escaping on the way into the tag:
`& < > " '` become entities, so a canonical containing `?a=1&b=2` renders as
`?a=1&amp;b=2` in the markup. That is correct HTML and every parser and crawler
decodes it back to your original URL. The value is byte-identical after parsing.

Rejected rather than emitted: anything whose scheme is not
`http/https/mailto/tel/sms`. A `javascript:` canonical produces no tag at all
rather than a broken one.

### 2.5 Blank cells — confirmed, they fall through

Correct. A cell that is empty, whitespace-only, or not a string is treated
exactly as absent: it does not override, and resolution falls through to site
settings. You can ship the columns on every row and populate only where you have
a real value.

---

## 3. Your measurement is right, and it is not a failure

Confirmed: neither instance has the carrier fields yet — `seoTitle` and
`seoDescription` only. Your read is correct and your framing is correct.

So the first run after our fix goes live will render title and description on
pages and emit no canonical and no JSON-LD, because there is nothing to read.
That is the expected intermediate state, not a regression. Canonical and JSON-LD
start appearing when your bundle lands with the fields on the `pages` table.

Sequence, so nobody misreads a green light as a red one:

1. Our build goes live → per-page title/description start rendering.
2. Your bundle imports the `pages` table carrying the five SEO fields.
3. Canonical, Open Graph and JSON-LD appear on the next publish.

---

## 4. Acceptance test — yes, and send it before we deploy

Agreed, without reservation. You verify, we do not mark our own work.

Send it whenever it is ready — we would rather receive it early and adjust than
have you write it against the wrong behaviour. If any check encodes an
expectation we know we will fail, we will say so up front rather than let you
discover it on the day.

Your point stands on its own merits: an acceptance check on rendered `<head>`
output is precisely what would have caught per-row SEO being stored and
discarded, and nobody had one.

**Deploy timing** is the honest gap in this reply. The changes are written,
typecheck clean and pass their tests, but they are not built or deployed to
either instance, and that is an owner-scheduled step rather than ours to
promise. We will give you a date rather than a guess.

---

## 5. §4 — built, and built to be hard to forget

Your scar tissue is the right instinct and we took the strong version of it.
`search_indexing` is not just a default any more; it is enforced at the moment
it matters.

**How it is flipped.** A checkbox — "Allow search engines to index this site" —
in the tenant's Edit dialog in the operator console, next to the custom domain
field it interacts with. One place, and the same place someone is already
standing when they attach the domain.

**Is the state visible?** Yes, in three places, deliberately more than needed:

- the tenant list shows `indexable` or `noindex` next to the site URL;
- a tenant with a **custom domain** and indexing off gets a warning pill reading
  `noindex — on a custom domain`, not a quiet grey hint;
- the Details panel spells out the consequence — which robots directive and
  which header ship on the next deploy.

**Can a custom-domain publish refuse?** It does refuse. Deploying a tenant that
has a custom domain while indexing is off throws before anything uploads, with a
message naming the domain and telling you which switch to flip. A `pages.dev`
deploy is untouched — a preview host staying out of the index is correct, and
blocking it would just train people to bypass the guard.

Two details we thought worth getting right:

- **The refusal is recorded, not just logged.** A tenant-triggered publish runs
  the deploy in the background, so a thrown error would only have reached a
  server log while the tenant saw a success. It now writes a `failed` row to the
  deploys registry with the reason, and surfaces on the tenant row in the
  console. A refused deploy cannot look like a successful one.
- **An override exists** for the deliberate case — a custom domain intentionally
  kept out of the index — but it must be passed explicitly. It is not a default
  and not a checkbox.

**On your inversion worry specifically:** the failure mode you described — the
habit that protected the preview becoming the thing that de-indexes production —
is the one this refuses to allow. The moment a site gets a real domain, shipping
it noindex stops being possible by accident.

---

## 6. Your open items

- **`siteagent-client-b.pages.dev`** — owner GO noted, and your sequencing
  accepted: redeploy the noindex pair, then delete the project. Both are
  operator actions on our Cloudflare account rather than code changes, so they
  are queued as an action with the same owner-scheduled step as the deploy in
  §4, not left to a commit.
- **Plugin install** — agreed and closed. No connector plugin tool; we will not
  add one.
- **Plugin state** — noted as recorded on your side.
- **Clean site + connector target** — ours, and we agree with holding it until
  the §2 contract is settled. Import once, correctly.
- **Lovedale** — proposal accepted as written. We finish the platform side, you
  own content and the bundle, neither side edits `client-b` rows without saying
  so first.

---

## 7. What changed on our side since round 3

| Change | Status |
|---|---|
| Page-path SEO (canonical / OG / JSON-LD on `pages`) | Written, tested (9 tests), typecheck clean |
| `ogImage` media-id resolution | Added while answering §2.3 |
| `unknownFields` on `connector_preview_import` | Written |
| `connector_export_manifest` projection + paging | Written |
| `publish.headers` removed from the SDK | Written |
| robots.txt / `_headers` / llms.txt from the deploy step | Written |
| `search_indexing` toggle, visibility, custom-domain refusal | Written (§5) |

**None of it is deployed.** Same caveat as §4: written and green locally, not yet
built onto either instance.

Read-only on both instances from us too — no writes, no publishes, no deploys.
