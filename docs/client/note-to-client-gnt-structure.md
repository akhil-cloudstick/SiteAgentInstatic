# GNT build — rev 7 has not arrived, and rev 6 is flat

Reply to the note dated 2026-08-27, §1.

## What we actually received

Two deliverables reached us. Nothing else:

```
gnt-instatic-full-site-rev6      + .zip
lovedale-instatic-rev1           + .zip
```

`gnt-instatic-full-site-rev7.zip` and `lovedale-instatic-rev2.zip` are referenced in
the note as shipping with it. Neither is here. Please resend rev 7 — that is the
single blocking item.

## rev 6, verified against the folder rules

We unpacked it and counted, rather than reading the batch report:

| Check | Required | rev 6 |
|---|---|---|
| Collection entries at `blog/<slug>/index.html` | present | **0** |
| Contents of `blog/` | listing + entries | **`index.html` only** |
| Files at depth 3 anywhere in the tree | the entries | **0** |
| Top-level page folders | real pages only | **397** |
| Total HTML files | — | 397 |

Every one of the 397 HTML files sits at `<slug>/index.html`, one level down. Posts and
real pages are siblings — `10-reasons-computer-workstation-rental-is-smart/` sits next
to `3d-design-and-animation/`. `blog/` exists but holds only its listing page.

Its own `_batch-report.json` agrees: `"pages": 397`, and there is **no `blogPosts` key
at all**. The note quotes rev 7's report as reading `pages: 397, blogPosts: 189` — that
key's absence is the cleanest single signal that this is the pre-split build.

So rev 6 does not meet the structure, and the WARN it produces is accurate for the
build we hold. We are not disputing that rev 7 fixes it; we are saying rev 7 is not in
our hands.

## Lovedale rev 1 already had it right

Worth recording, because it settles whether the shape is achievable:

```
lovedale-instatic-rev1/
  index.html, about/, rooms/, dining/, …      12 top-level pages
  blog/
    index.html                                 listing, stays a Page
    two-days-in-kodaikanal/index.html          ┐
    kodaikanal-waterfalls/index.html           ├ 17 entries, one level deep
    poombarai-village-kodaikanal/index.html    ┘
```

12 top-level pages, 17 entries under `blog/`, nothing deeper than one level, `posts/`
unused. That is the contract met exactly — and it was met in **rev 1**, not rev 2. No
change is needed to Lovedale on structural grounds.

Since rev 1 already produced the correct shape, the same converter clearly can. That is
why rev 6's flatness reads as a build that predates the split rather than a
disagreement about the rules.

## On the import behaviour

Separately, and not a criticism of the build: a correctly structured folder does not by
itself produce collection entries on import today. We confirmed this with Lovedale rev 1
— correct structure in, 17 entries landed in Pages with slugs like
`blog/two-days-in-kodaikanal`. That is our side to fix and it is in progress; no action
for you, and no change to the folder contract. Keep building to the structure exactly as
specified.

## What we need

1. **`gnt-instatic-full-site-rev7.zip`** — the only blocker.
2. Confirmation that rev 7's `blog/` holds 189 entry folders, so we can check the
   delivery against a number before importing.

Nothing else from §1 is outstanding.
