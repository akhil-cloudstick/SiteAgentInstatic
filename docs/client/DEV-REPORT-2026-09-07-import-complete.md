# Import complete — bundle v3 on `sheeltron` · 2026-09-07

Done. Counts below, then the row-level check, then the one number that matters.

**Nothing was published.** `publishedPages: 0`, `hasPublishedVersion: false`, both before and
after. `sheeltron.com` is untouched.

## The counts

```
ok: true    strategy: replace    tablesAffected: 2
rowsInserted: 19    rowsReplaced: 0    rowsSkipped: 0
mediaImported: 0    mediaFoldersImported: 0    redirectsImported: 0
```

Against your expectation, and against the dry run the import took immediately before writing:

| | Expected | Preview | Actual |
|---|---|---|---|
| `pages` | 11 added | 11 | **11** |
| `news` | new table, 8 added | 8 | **8** |
| total rows | 19 | 19 | **19** |
| media / folders / redirects | 0 | 0 | **0 / 0 / 0** |

No divergence anywhere.

## We checked the rows, not the number

You wrote that `rowsInserted` is a true statement about a number and not about the rows. So
before reporting, we enumerated what is actually in the database:

```
news/ai-buildout                 draft   The Enterprise AI Infrastructure Buildout…
news/ait-cricket-2026            draft   Team Sheeltron Reaches AIT Cricket Tournam…
news/amd-apj-summit              draft   Sheeltron Recognised by AMD at APJ Partner…
news/cooling-investment          draft   India's Data Centre Cooling Market Targets…
news/iris-deal                   draft   Sheeltron Delivers ₹18 Cr BFSI Enterprise…
news/nvidia-partnership          draft   Sheeltron Expands AI Infrastructure Practi…
news/team-outing                 draft   Sheeltron Team Bonding at Club Cabana, Ban…
news/world-environment-day-2026  draft   This World Environment Day, the Climate Fi…
pages/about-us                   draft   About Us — Sheeltron Digital Systems
pages/ai-infra                   draft   AI Infrastructure — Sheeltron Digital Syst…
pages/careers                    draft   Careers — Sheeltron Digital Systems
pages/casestudy                  draft   Case Studies — Sheeltron Digital Systems
pages/contact                    draft   Contact — Sheeltron Digital Systems
pages/e-waste-management         draft   E-Waste & Asset Recovery — Sheeltron Digit…
pages/index                      draft   Sheeltron Digital Systems — Mastering the…
pages/news                       draft   News — Sheeltron Digital Systems
pages/news-entry-template        draft   News article template
pages/privacy                    draft   Privacy Policy — Sheeltron Digital Systems
pages/verticals                  draft   Our Verticals — Sheeltron Digital Systems
```

19 rows, every title intact, every one `draft`.

We also ran the loss check before authorising the wipe rather than after it: each of the 18
pre-existing rows was matched against the URL the bundle would serve in its place. **Zero URLs
lost.** The 8 articles keep `/news/<slug>` byte-for-byte, as you designed — they changed table,
not address.

## The number that matters

Before the import:

```
templates: []    count: 0
```

After:

```
templates: [
  { slug: "news-entry-template",
    target: { kind: "postTypes", tableSlugs: ["news"] },
    priority: 0, status: "draft" }
]    count: 1
```

And as stored in the database, read back directly rather than echoed from the bundle:

```
templateTarget : {"kind":"postTypes","tableSlugs":["news"]}
stored JSON type = object
```

**Object, not string.** That is the evidence your §1 asked for, and it is the first point in
this whole exchange where either side could *show* the cell shape rather than infer it from a
passing check. v2 would have landed here as a string, registered zero templates, and 404'd all
eight articles while the admin reported them healthy.

## One thing worth recording: the import refused first

The first attempt returned `401 step_up_required` and changed nothing — a clean-site import is
gated behind step-up re-authentication on top of the ordinary session. We mention it because
the failure was total rather than partial: 18 rows before, 18 rows after, no half-applied
state. If you ever see that status, nothing has happened yet.

## Publishing — not done, and the ordering still applies

All 19 rows are `draft`, which is what the GO note asked for. We have not published and will
not until a message says so explicitly.

When it comes, your ordering constraint applies and the template is currently a **draft**:
publish it **with** the articles or **before** them. A draft template wraps nothing, and eight
articles published against a draft template is exactly the silent 404 we have spent a
fortnight removing — with the admin reporting them Published throughout.

## Two open items on our side

**1. The field-type declaration is unchanged.** `templateTarget` is still declared `longText`.
Your bundle works because our reader is now tolerant, not because the declaration was
corrected. That fix still needs a new field type and a migration across every installation,
and we are not shipping it on an estimate. The position from our last note stands: keep your
own cell-shape assertion, it remains the only check in the system that can catch this class.

**2. A latent defect we found while checking your bundle, disclosed because it will matter to
you later.** The importer guards its media-folder and redirect wipes with a plain truthiness
test, and an **empty array is truthy**. Your bundle carries `mediaFolders: []` and
`redirects: []`, so both wipes ran and then restored nothing.

Harmless here — Sheeltron had zero of each, which we verified before authorising. It would
silently destroy them on a target that had any. Relevant the moment you do the media tranche:
until we fix it, a `replace` whose bundle omits media folders will delete the folders already
on the site. We are recording it rather than waiting for it to bite.

---

`sheeltron` now holds the structure you designed: 10 real pages, an entry template, and a
`news` collection of 8 articles at `/news/<slug>`. Nothing is live. Send the word when the
owner is ready to publish, and we will apply the template-first ordering.
