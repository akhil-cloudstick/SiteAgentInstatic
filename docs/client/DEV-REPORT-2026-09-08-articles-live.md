# The articles are live, and neither of us was right about why they were not · 2026-09-08

Defect 2 is fixed and verifiable. **It was never a caching problem.** Your `age: 73123` was
real, our cache-buster was wrong, and both of our conclusions were wrong in the same direction:
we were arguing about what a CDN returned when there was nothing behind it.

## 1. What was actually wrong

**The eight articles were never published.**

The v7 replace landed every row as `status: draft`, which is what the bundle carries.
`publish_site` then published the 11 pages, reported `publishedPages: 11`, and left the
collection entries untouched. The baker only writes rows that are already published, so no
article files were produced at all.

The measurement that settled it — the baked output on disk, which no CDN can distort:

```
published/a/news/   8 .html files    <- the older v5 publish
published/b/news/   DOES NOT EXIST   <- the v7 publish
```

So `/news/<slug>` had nothing at the origin, fell through to the soft-404 you identified in your
§4(b), and returned the homepage with HTTP 200.

That is why your cache-busted request returned the homepage: **not because the query string
defeated the cache and hit a stale origin, but because it defeated the cache and hit nothing.**
Your diagnosis of the mechanism was exactly right; the thing it was masking was absence, not
staleness.

And our §1 was worse than wrong. We measured the homepage eight times, counted its zero escaped
fragments, and reported the defect fixed. You caught it in one request. We should have compared
the `<title>` — that single field distinguishes an article from the homepage and we did not
look at it.

## 2. Fixed, and measured three ways

The eight rows are published, a full publish baked them, deploy 34 is live.

**At the origin:**

```
published/b/news/   8 baked article files
  ai-buildout.html              0 escaped   0 <pre><code>
  ait-cricket-2026.html         0 escaped   0
  amd-apj-summit.html           0 escaped   0
  cooling-investment.html       0 escaped   0
  iris-deal.html                0 escaped   0
  nvidia-partnership.html       0 escaped   0
  team-outing.html              0 escaped   0
  world-environment-day-2026    0 escaped   0
```

**Over the wire, all eight, no query string:**

```
                               esc   bytes   cache   age   is-homepage
ai-buildout                      0   11647     -      -       false
ait-cricket-2026                 0    9264     -      -       false
amd-apj-summit                   0   11621     -      -       false
cooling-investment               0   11812     -      -       false
iris-deal                        0   10503     -      -       false
nvidia-partnership               0   11298     -      -       false
team-outing                      0    8923     -      -       false
world-environment-day-2026       0   14780     -      -       false
```

No `cf-cache-status`, no `age`, and every response carries its own title and its own byte count
rather than the homepage's 34 KB. **v7's dedent worked.** It could not be seen until there was a
page to see it on.

### The acceptance test that actually works

Fetch without a query string, and assert on the `<title>` rather than on a fragment count. A
count of zero is indistinguishable between "fixed" and "you are looking at the wrong page", and
that ambiguity cost us both a round. The origin-side file check is better still where you can
reach it.

## 3. The platform defect, and it is sharper than your §3(a)

Your finding was that publishing a row does not deploy it. The full shape is worse:

**`publish_site` does not publish collection entries at all.** It publishes pages, reports a
page count that reads as success, and leaves every post-type row a draft. After any `replace`
import — which lands everything as draft by design — a full publish produces a site whose
collections are silently empty. Nothing in the response, the admin, or the deploy says so.

`publishedPages: 11` was true and complete about pages, and said nothing about the 8 rows that
were the entire point of the publish. That is the same shape as `rowsInserted`, and you named it
before we did.

Ours to fix. At minimum the publish result has to report collection entries alongside pages, so
a number that looks like success cannot describe half the site.

## 4. Your §4 — our harness hypothesis was wrong

You are right: `innerWidth` and `scrollWidth` are separate fields in the same measurement, so a
mix-up between them is not available as an explanation. We offered it without checking what your
harness actually read. Withdrawn.

390 returning 640 and 834 returning 884, while 1440 returns 1440, remains unexplained. We have
nothing useful to add yet and will not offer another guess.

## 5. Your §3 — the two new homepage findings

Both noted, both yours, and neither is something we would have caught: the 50px overflow at 1440
that v5 did not have, and the green radial blobs the source hero does not carry. Flagging them
against the same deploy that introduced the linked stylesheets is the right call.

The observation that your copy shows *more* content than a headless screenshot of
`sheeltron.com` — because the js-gated drop makes those sections unconditionally visible — is
worth keeping. For a static copy with no script, that is the correct outcome and not a
difference to chase.

## 6. Your §6 — the correction against yourselves is the important part

The scan answers the question and we accept the conclusion: dedent is safe for the 189, one post
needs eyes for its four ordered-list lines.

The part worth more than the answer is the false positive you caught and reported. A naive
`_..._` match against a corpus full of `HP_Z6_G4` produced 35 hits across 9 posts, and the real
count is zero because CommonMark does not open emphasis on an intraword underscore. You would
have used that number to justify a wait, and it would have looked rigorous *because it arrived
with a measurement attached*.

That is the failure mode this fortnight has been circling from the other side. Every defect we
have both hit was invisible to a check that passed. This one was a check that failed and was
wrong to. Catching it before sending is the harder discipline.

## 7. Still ours

The Markdown format defect stands: entry bodies are unconditionally Markdown-rendered and the
field's declared `format` is never consulted. Your dedent is a workaround for our bug, on both
sites, and the fix happens regardless of what the Global Nettech scan said.

Adding to it from this round: `publish_site` reporting only pages, and `publish_site` closing the
connection while succeeding — three times now, deploys 32, 33 and 34 all went live after that
error. A call that succeeds and reports failure trains people to retry a publish, which is the
one operation where a reflexive retry is expensive.

---

The site is live: 11 pages, 8 articles at `/news/<slug>`, entry template published, chrome and
heroes styled. The screenshots are worth taking now — there is finally something behind every
URL.
