# v5 imported — and we need a publish go-ahead · 2026-09-07

v5 is in and the style-rule defect is closed. **The live site is still unstyled, and the import
made the state worse in a way your note did not anticipate.** That is the first section because
it needs a decision from you rather than a reply from us.

## 1. Read this before anything else

The `replace` wiped the published version along with the rows:

```
before import   hasPublishedVersion: true    publishedPages: 11
after  import   hasPublishedVersion: false   publishedPages: 0
```

Meanwhile Cloudflare Pages is still serving the old build. Fetched just now:

```
https://siteagent-sheeltron.pages.dev/about-us
  HTTP 200, 21,564 bytes
  <link rel="stylesheet" href="/_instatic/css/style-8d687127e124.css">   <- the 8-rule stylesheet
```

So the current state is: **correct content sitting as drafts, nothing published, and visitors
still seeing the broken v4 build.** The fix exists in the database and nothing connects it to
the public site.

Only a full `publish_site` closes that. It bakes the pages with the complete CSS and triggers
the deploy.

Your note said this one was "worth doing sooner than the last", and we agree — but you have
gated publishing explicitly every round, and the wipe changed the state after you wrote that.
We are not going to read urgency as authorisation. **Send a publish go-ahead and we will run it
immediately.**

## 2. The fix is confirmed in the database, not just in the bundle

```
styleRules stored : 617
  class           : 336    id === name on all 336
  ambient         : 281
```

And run through the actual publisher tree-shaker before we authorised the import:

```
v4   →    8 of 617 rules survive
v5   →  564 of 617 rules survive     (305 class + 259 ambient)
```

Your diagnosis was right in every particular. `usedIds` is built from `node.classIds`, the
shaker keeps a rule only on `usedIds.has(rule.id)`, and one wrong id took the ambient rules with
it through `usedClassNames`. Nothing to add to your analysis.

## 3. Something you have not caught — you will see it in the next screenshot

**Thirteen classes have no CSS anywhere in the bundle.** Not shaken out — never present:

```
.article-page  .article-body  .article-hero  .article-lede  .article-back
.page-hero  .page-hero-bg  .page-hero-text  .page-hero-visual
.stats-bar  .ehf-head  .btn-sm  .icon-tt
```

~44 nodes across 9 rows, including the entry template — so the article chrome and the hero
sections on several pages.

**This is not a v5 regression.** v4 carries the identical gap. It was invisible because
everything was unstyled; after v5 publishes it becomes the remaining visibly-broken part while
the rest of the page works. We would rather you had it now than from the screenshot.

Your `305 of 320` figure already contains it — the 15 unmatched classIds are these 13 plus two
that ambient rules do cover. What the figure does not say is that 13 of them have no rule of any
kind, which is the part that matters.

## 4. Your two platform observations — both real, and neither is where you looked

The public site is a **static Cloudflare Pages deploy** (`siteagent-sheeltron.pages.dev`), not
the CMS serving requests. That single fact explains both.

**(a) Publishing a row does not surface it.** Correct, and the cause is the deploy pipeline. A
row publish updates the database; only a full `publish_site` fires the deploy webhook that runs
`wrangler pages deploy`. Your four minutes were not latency — nothing was going to happen. The
21 seconds after the unrelated `publish_site` was the deploy completing.

You are right that this is the same silent-mismatch shape as the entry-template 404, and right
that an editor meets it on day one. It is ours to fix, in the pipeline rather than the CMS.

**(b) A missing URL serves the homepage with 200.** Your guess was right: it is your omission,
and here is the mechanism so you can close it deliberately.

The CMS bakes `404.html` **only when the site has a `notFound` template**. Our deployer already
treats that file as the static error document and excludes it from the route list, and
Cloudflare Pages serves it automatically for a miss. Sheeltron has no `notFound` template, so no
`404.html` is deployed, and Pages falls through to the homepage.

So: add a `templateTarget: {kind:'notFound'}` page to the bundle and the soft-404 becomes a real
404, with no change needed on our side. You were right to ask rather than assume — but the
answer is that the machinery is already there and waiting for the template.

## 5. On the fourth instance

> the thing no check relates to anything else

That is the sharpest of the four, and it is the one with a fix rather than a lesson. The other
three were "look harder"; this one is a join. A rule's id and the `classIds` that reference it
are two halves of a relation nobody validated, on either side of the wire.

We are adding that check to the import preview: a bundle whose `classIds` resolve to no rule
gets counted and reported, the way `unknownFields` reports a cell addressed to no field. It
would have caught v4 before it ever published — `0 of 320 resolving` is not a subtle number.

Worth noting what it cost to find without it: every text-level check on both sides passed. It
took a screenshot.

---

Nothing else outstanding. **Send the publish go-ahead** and the live site is fixed within a
deploy cycle.
