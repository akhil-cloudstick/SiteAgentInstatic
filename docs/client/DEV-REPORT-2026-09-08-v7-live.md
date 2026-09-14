# v7 shipped — preview, import, publish, live · 2026-09-08

All three steps ran under your authorisation. Both defects you found by screenshot are fixed.

```
preview     pages 11 add · news 8 add · 19 rows · unknownFields []
import      ok · rowsInserted 19 · rowsReplaced 0 · rowsSkipped 0
publish     publishedPages 11 · draftMatchesPublished true · 06:06:20Z
deploy 32   live · 06:07:26Z
stylesheet  style-7c65632638ae.css   163,199 bytes   (v5 was 161,177)
```

## 1. Read this before you screenshot

**Cloudflare served stale HTML for the article URLs after the deploy landed, and it nearly cost
us the result.**

Our first check of the eight articles counted **181 escaped fragments** — worse than the 2–47
you reported. We were about to tell you v7 had failed. Re-fetched with a cache-busting query
string, the same eight articles return **0**.

The CSS URL is content-hashed so it updated immediately; the page HTML is not, and it did not.
A screenshot taken in that window photographs the previous deploy.

Given your method is screenshots rather than text checks, and that the method is the right one:
**append a cache-buster or hard-reload before capturing.** Otherwise the acceptance test will
show you the defect you just fixed.

## 2. Against your expectations, one at a time

| You expected | Result |
|---|---|
| The eight `opacity:0` bands filled in | **Yes** — none of `.pillar` `.case-card` `.news-card` `.vertical-section` `.tl-item` `.ai-card` `.ai-spot-card` `.bf-card` carries `opacity:0` in the deployed CSS |
| Articles free of `&lt;p&gt;` / `&lt;strong&gt;` / `&lt;/li&gt;` | **Yes** — 0 fragments across all 8, and no `<pre><code>` anywhere |
| Article chrome and heroes styled | **Yes** — 600 of 666 rules survive; `.article-body` has 12 rules, `.page-hero` 11, `.article-hero` 5 |
| `.icon-tt` and `.ehf-head` still unstyled | **Yes** — correct, and they render as they do on sheeltron.com |

The entry template is now `status: published`, so the articles resolve through it rather than
falling through.

## 3. `unresolvedClasses`, as promised

The check we built for you did not run in this preview — the platform change is not yet deployed
to your tenant. Run against your artefact locally it reports, and does not block:

```
.bf-card 8 · .pillar 7 · .vertical-section 7 · .ai-card 6 · .reveal 6
.tl-item 5 · .ai-spot-card 4 · .news-panel 2 · .ehf-head 1 · .trust-partner--more 1
```

Ten classes, `.reveal` among them, all advisory. That is the js-gated set you dropped on purpose
plus the two dead source-site classes — exactly the shape you asked us not to block on.

## 4. The publish reported a failure that was not one

`publish_site` returned `The underlying connection was closed`. The publish had already
succeeded: deploy 32 fired 14 seconds later and went live. The HTTP response was lost, not the
operation.

Recording it because the obvious reaction is to re-run, and a re-run would have been a second
full publish. **Check `publish_status` before retrying a publish that appears to have failed.**
We will look at why the connection drops on a long publish; a call that succeeds and reports
nothing is its own defect.

## 5. Your open item — one branch closed

We looked, since it was one request rather than a hunt. The viewport meta is present and correct
on all three page types:

```
/                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
/about-us         same
/news/iris-deal   same
```

So a missing or malformed viewport is ruled out. Combined with the 2,155px horizontal overflow
you measured on article pages, the numbers look like genuine content overflow rather than a
scaling fault — worth checking whether the harness reads `scrollWidth` (content) where you want
`clientWidth` (viewport). That would explain 3336 on a page that overflows and a correct 390 on
a page that does not.

Not a diagnosis, and we have not reproduced it. Just the branch we could close for free.

## 6. Global Nettech

Your position is better than either of the options we offered, and we withdraw the pair. Neither
of us knows whether the 189 carry the other Markdown constructs, and choosing between "dedent
now" and "wait" without that number is exactly the guessing this fortnight has punished.

Measure, then decide. We will hold the format fix scoped and ready either way, and the fix
happens regardless of what the scan says — it is our defect, and your dedent is a workaround for
it whether or not you need one today.

Sheeltron came through clean on all eight constructs, and you are right that eight short news
items prove nothing about 189 prose posts.

---

Live and correct as far as we can measure from here. The screenshots are yours — with the cache
buster.
