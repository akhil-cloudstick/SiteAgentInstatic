# Import complete — bundle v4 on `sheeltron` · 2026-09-07

Done. v4 supersedes v3 in the database. **Nothing was published** — `publishedPages: 0`,
`hasPublishedVersion: false`, before and after. `sheeltron.com` untouched.

## The counts

```
ok: true    strategy: replace    tablesAffected: 2
rowsInserted: 19    rowsReplaced: 0    rowsSkipped: 0
mediaImported: 0    mediaFoldersImported: 0    redirectsImported: 0
```

| | Expected | Preview | Actual |
|---|---|---|---|
| `pages` | 11 added | 11 | **11** |
| `news` | 8 added | 8 | **8** |
| total | 19 | 19 | **19** |
| media / folders / redirects | 0 | 0 | **0 / 0 / 0** |

Identical to v3, as you predicted, since only the bodies changed.

## The rewrite landed — checked in the database, not in the bundle

The bundle being correct and the database being correct are two different claims, and v3
taught us the gap between them is where things hide. So this was read back from
`sheeltron` after the import:

```
OLD build-time references
  "contact.html"                    0
  "index.html"                      0
  "verticals.html"                  0
  "../" relative paths              0
  any .html inside an href or src   0

NEW CMS routes
  /contact                         45
  /verticals                       83
  /news                            39
  absolute sheeltron.com assets   338
```

Zero build-time filenames survive. Navigation and images resolve.

## What we verified before authorising the wipe

Not taken on trust:

- **Hash** `540b109c…`, 1,437,843 bytes. Match.
- **581 href/src references in v3, 581 in v4.** The rewrite moved references; it dropped none.
- **v4 differs from v3 in the `body` cell of all 19 rows and nothing else** — same row set,
  same row IDs, same slugs, same statuses. Your "only the contents of the bodies changed"
  is exactly right.
- **Anchors survive**: `verticals.html#rentals` → `/verticals#rentals`, all five of them.
- **Every one of the 18 served URLs is re-created** by the incoming bundle. Zero lost.
- **`templateTarget` is an object**, one `base.outlet`, reachable, 0 unreachable nodes of 100.

## Your empty-array question — re-verified, not assumed

You asked us to check rather than infer, since v3 had landed in between. Correct instinct,
and the answer is unchanged:

```
data_row_redirects   0
media_folders        0
media_assets         0
```

Both wipes ran and restored nothing, and there was nothing to lose. The defect is still real
and still unfixed on our side — it will bite the moment a `replace` runs against a target that
has folders, which is the media tranche.

## Two corrections you are owed

### 1. The `strategy` argument you have been passing does nothing

`connector_import_replace` has no `strategy` parameter, and the connector does not validate
arguments against the tool schema — so it is silently ignored rather than rejected. You have
passed it twice for an assurance it never provided.

Your `confirm` is also required and both notes omitted it; without it the import refuses.

**We should have told you after v3 and did not.** That is our omission, not yours — you were
reasoning correctly from a tool description, which is exactly the position we keep putting you
in.

The good news is your underlying goal is already met, more strongly than by an argument: the
tool hardcodes `replace` internally for both the dry run and the import. It never consults the
default at all, so there is no default for you to be the first to trust.

### 2. Thirty-two empty `href=""` in the bundle

Not caused by your rewriter — they are byte-identical in v3 and v4, so they came from the
source site. An empty `href` reloads the current page instead of navigating.

Cosmetic and pre-existing, and we are not asking you to fix it in this tranche. We raise it
because of *why* your self-check reports 0 broken while these exist: the check tests whether a
link resolves to a served route, and an empty string never reaches that test. It is not a bug
in the checker — it is the same shape as the defect you caught yourselves this round.

Your own sentence covers it: *the thing built through the side path is the thing nothing
checks.* The variant here is **the thing that never reaches the test is the thing the test
cannot see.** Three rounds, three instances, one shape.

## Publishing — still not done

All 19 rows are `draft`. Entry template registered:

```
templates: [{ slug: "news-entry-template",
              target: { kind: "postTypes", tableSlugs: ["news"] },
              priority: 0, status: "draft" }]    count: 1
```

Note the template is itself a **draft**. Your ordering constraint applies when the go-ahead
comes: publish it **with** the articles or **before** them, never after.

One thing to put in front of the owner before they decide: the images resolve against
`sheeltron.com`, by your design and openly flagged. The published site will be correct and
still fetching its assets from the old host. That is fine as an interim and it is not fine as
an end state — it has to be closed before the CMS could serve the domain.

---

`sheeltron` now holds 10 real pages, an entry template, and a `news` collection of 8 articles
at `/news/<slug>`, with every internal reference resolving to a CMS route. Nothing is live.
Send the word when the owner is ready.
