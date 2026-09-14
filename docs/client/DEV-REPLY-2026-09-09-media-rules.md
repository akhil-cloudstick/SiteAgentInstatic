# Your §4 answered, and it is the same defect as your §2 · 2026-09-09

Checked in minutes as you said it could be. **No, media rules do not travel the class-rule path
and nothing selectively dropped them.** The bundle only ever contained one breakpoint.

That is also the answer to your §2: the nav cannot collapse because the rule that would collapse
it was never in the bundle. One cause, both symptoms.

## 1. How media rules are actually carried

They are not separate rules. A media override lives **inside** the class rule it modifies, as
`contextStyles`, keyed by a context id that is either a declared breakpoint or a declared
condition:

```
rule.contextStyles = { "media:(max-width: 640px)": { fontSize: "..." } }
site.conditions     = [{ id: "media:(max-width: 640px)",
                         condition: { kind: "media", query: "(max-width: 640px)" } }]
```

So a media override cannot be dropped independently of its class rule — it is a property of that
rule, and the tree-shaker keeps or drops whole rules. There is no separate survival decision for
responsive CSS.

## 2. What v7 actually carries

```
rules in bundle                    666
rules with any contextStyles         4      <- all four the same context
distinct conditions declared         1      media:(max-width: 640px)
```

Through the tree-shaker:

```
.article-hero h1    media:(max-width: 640px)   survived
.article-page       media:(max-width: 640px)   survived
.article-hero       media:(max-width: 640px)   survived
.article-quote      media:(max-width: 640px)   dropped
```

Three survive, which is exactly the **3 `@media` blocks** you counted in the published sheet. The
count matches because nothing was lost — that is all there was.

`.article-quote` dropped for the documented advisory reason: no node references that class, so
the rule is unused. It is in the `unresolvedClasses` family, not a media problem.

**The source's other seven media blocks were never converted.** They are not in the bundle in any
form — not as contextStyles, not as rawCss, not in a selector. Your 163,199-vs-31,368 instinct
was sound; the direction was the other way. The sheet is larger because it merges every page's
CSS, and it carries fewer breakpoints because only one breakpoint was ever ingested.

## 3. Why your nav does not collapse

The nav rules are in the bundle. Their mobile overrides are not:

```
.nav-links     display: flex    contextStyles: none
.nav-toggle    display: none    contextStyles: none
```

`.nav-toggle` is `display:none` unconditionally, at every width, because the
`@media (max-width: …)` block that flips these two was never ingested. The burger is in the
markup and can never appear; `.nav-links` stays `flex` and runs to 615px at a 390 viewport.

That is your §2 exactly: header renders full width, "BACK TO INDUSTRY NEWS" sits behind the
header pill, `innerWidth` inflates to 640 because Chrome expands the layout viewport to the
content's minimum width. Your reading of the mechanism was right in every part; the missing piece
was upstream of everything you could see.

It also explains your 834 → 884. Not a constant offset — the content's minimum width at that
viewport, which is why the delta differs per width.

## 4. What the emitter needs to do

For each `@media` block in the source CSS:

1. Declare the condition once in `site.conditions`:
   `{ id: "media:(max-width: 768px)", label: "(max-width: 768px)",
      condition: { kind: "media", query: "(max-width: 768px)" } }`
2. For each declaration inside that block, attach it to the matching class rule under
   `contextStyles["media:(max-width: 768px)"]` rather than emitting a second rule.

The context id and the condition id must match exactly — that string is the join. If a rule
carries a context id with no matching entry in `site.conditions`, the override has nowhere to
resolve to, which is the same shape of unvalidated join as the class ids. Worth asserting in your
pre-flight gate alongside the `classIds` check.

`site.breakpoints` already declares mobile/tablet/desktop (375/768/1440). Either reuse those ids
where a source query matches, or declare custom conditions as you did for 640px. Both work; do
not do both for the same query.

## 5. Your §3 and §5

Both are the good half of this fortnight's pattern and we will not add to them.

Computing overflow as `scrollWidth − innerWidth` when both inflate together, and reporting
`overflowX=0px` over a visibly broken header, is a check that fails open — the exact failure mode
we have been trading examples of, caught on your own instrument.

The regex that read zero `.nav-links` rules out of minified CSS is the second one you have caught
before sending. You were one command from telling us the stylesheet had dropped the nav rules
entirely, which would have sent us hunting in our pipeline for a defect that was in your
converter — and the measurement would have made it convincing.

## 6. Your §6 — all four confirmed, none disputed

Nothing to argue with. Restated only to confirm we hold the same list:

1. Entry bodies unconditionally Markdown-rendered, `format` never consulted.
2. `publish_site` does not publish collection entries and reports a page count that reads as
   success.
3. `publish_site` closes the connection while succeeding — 32, 33, 34.
4. Empty array truthy in the importer; a `replace` carrying `mediaFolders: []` wipes and restores
   nothing. **This one is fixed** — `?.length` rather than truthiness, on folders and redirects
   both. It ships with the next platform deploy.

Your framing is the right one: these are the four that make an unattended push unsafe rather than
merely slow. (2) and (3) are the pair that would bite hardest — a publish that succeeds, reports
failure, and silently leaves the collection unpublished is three-quarters of an outage with no
error anywhere in it.

## 7. On §7

The verification pass that does not trust HTTP 200 is the right instinct, and this round is the
argument for it: a missing URL served the homepage with a 200 and a plausible byte count, and
both of us read it as evidence.

The two assertions that would have caught everything we have hit: compare `<title>` against the
expected page, and compare byte count against a floor. Both are cheap and neither can be
satisfied by a fall-through.

---

Nothing outstanding from us. The media-block conversion is yours; the four in §6 are ours, with
the fourth already closed.
