# v8 previewed — clean, with two things to settle before the import · 2026-09-09

Preview only. Nothing imported, nothing published.

```
pages   inBundle 11   willAdd 11   willReplace 0   currentLocal 0
News    inBundle  8   willAdd  8   willReplace 0   currentLocal 0
rowConflicts   []
unknownFields  []
totals         19 rows, 0 media, 0 folders, 0 redirects
```

Every number you stated in advance is confirmed:

```
rules                    671
rules with contextStyles 124
conditions                 5   all custom, none folded
.nav-links   media:(max-width:1024px)  { display: none }
.nav-toggle  media:(max-width:1024px)  { display: block }
tree-shake   603/671 survive · 114/124 context-carrying rules survive
```

## 1. The artefact you sent has no hash, and it is not the one we measured

Your note gave no sha256, and the file differs from the v8-test both sides measured:

```
measured earlier   7e522a7c…   1,463,509 bytes
sent now           b0a2b8b1…   1,463,509 bytes
```

Same byte count, different content — a re-emit, consistent with your standing caveat that node
ids are re-minted each run. **By your own rule, the verified artefact is the only valid one, and
this is not it.**

In substance it is fine: we measured the file you sent, not the earlier one, and every figure
above comes from `b0a2b8b1…`. It matches your expectations exactly, so we are not asking for a
re-send.

We are asking you to confirm `b0a2b8b1…` is the intended artefact before we import it. Every
previous round carried a hash and this is the first that did not — worth noticing on a note whose
whole subject is release discipline.

## 2. Your advisory count and ours disagree, and neither is obviously wrong

You predicted two known advisories. Our `unresolvedClasses` check reports thirteen classes across
94 node references:

```
.news-card 18   .icon-tt 17   .case-card 12   .bf-card 8   .pillar 7
.vertical-section 7   .ai-card 6   .reveal 6   .tl-item 5   .ai-spot-card 4
.news-panel 2   .ehf-head 1   .trust-partner--more 1
```

Eleven of those are your js-gated drops — the set you removed on purpose so the nodes render
visible rather than invisible. So nothing here is a new defect, and nothing needs fixing.

But your `1448/1472` implies 24 unresolved references and we count 94, which means the two checks
are counting different things. Ours is strict: a `classId` resolves only if some rule's **id**
equals it. If yours also counts a class as resolved when an ambient selector mentions it, that
would explain the gap.

Not blocking, and stated only so the preview output does not read as a regression when you see
thirteen where you expected two. Worth reconciling before either of us trusts the number in a
gate.

## 3. What the preview did not show you

`unresolvedClasses` and `destructiveEffects` are absent from the output above. They are built and
tested but the tenant is running a build that predates them, so this preview could not report
them. The figures in §2 come from running the same check locally against your bundle.

They ship on the next platform deploy. Until then, treat the preview's silence on those two
fields as "not yet deployed", not "nothing to report" — which is exactly the kind of ambiguity we
have both been trying to remove, so it is better said than left.

## 4. On your §2 — the fixture harness

Build it, and the offer stands from our side: **a dump of the imported tree for a page is easy
for us and we would rather give you that than have you infer it.** Say which page and which
form — the row's `body` cell as stored, the resolved node map, or both — and it is a short job.

Given §1 of our last note, observing behaviour is the only method available to you, so anything
that shortens the observation is worth more than another round of measurement.

## 5. Sequence

Preview done. **The import needs its own authorisation and we are not treating this note as one**
— you set that rule and it is the right one.

When it comes: expect `publishedPages` to drop to 0 on the replace, and expect the eight news
entries to arrive as drafts. **The site publish will not publish them** — that is the defect from
the v7 round, still open on our side. The articles need an explicit row publish before or with
the site publish, or `/news/<slug>` serves the homepage again.

We will run it in that order and report `innerWidth` at 390 with `<title>` and byte floors on the
article routes.
