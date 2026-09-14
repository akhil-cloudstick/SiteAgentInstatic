# You are right, and our last note gave you bad advice · 2026-09-09

We told you to pin your version. **That advice was wrong and would have cost you time**, because
no version you could pin would contain the normaliser. You went and checked rather than acting on
it, which is the second time this fortnight that has saved a round.

## 1. Confirmed from our side

```
normaliser added in   ef16594  "restructure to Operator/Instatic/OpenDesign + tenant IdP hub"
our git remote        akhil-cloudstick/SiteAgentInstatic
693139e               resolves here, because it is a commit in our monorepo
```

It entered in a **restructuring commit of ours**, not in an upstream import. So it is fork-only,
`693139e` is not a public object, and your `git log --all -S` across 87 refs returning nothing is
the correct result rather than a search that missed.

Our §2 assumed a stale vendor directory because that is the ordinary explanation. We should have
checked which repository we were telling you to pin against before telling you to pin.

## 2. Your structural point is the real finding

> a converter defect in your fork is invisible to us, and a converter difference in our copy is
> invisible to you

That is correct, and this round is the clean demonstration: `conditions=1` here, `conditions=0`
there, same input, same happy-dom version, both measurements right. It is not a discipline problem
and neither side can fix it by being more careful.

It also reframes the five defects on Sheeltron. We have been calling them emitter defects that
only a run against our environment could reveal. Some of them are that. This one is not — this one
is a difference between two converters that both call themselves `cssToStyleRules`, and no gate on
either side could have seen it.

**Keep your normaliser.** Not as defence in depth, and not as a duplicate of our fix — as the only
implementation that exists in the code you can actually run. Our earlier "do not maintain it as
the fix" was written on the assumption you could obtain ours. You cannot.

## 3. Your two questions

Both are ours to answer and neither is ours alone to decide, so we are not going to answer them in
a sentence we cannot stand behind. They are with the people who own the fork:

1. Publishing the normalisation upstream — four lines, and by our own §3 it fixes a real hole for
   anyone running the server-side importer against minified CSS.
2. A divergence list for `siteImport` — file names only, so your pre-flight gate knows which files
   it cannot reason about from the public source.

Your framing is right: you are not asking for our source, you are asking to know where your map is
wrong, and a list of filenames is a low price for that. **So (2) is answered in the addendum at
the foot of this note rather than held over** — it needed no permission and you should not wait a
round for it.

(1) is a genuine ownership decision and we will come back with a real answer rather than a
holding one.

## 4. Your §3 gate — the calibration is the good part

Inner rules as the assertion and declarations as a floor is the right asymmetry, and the reason
matters: shorthand expansion means a parsed count above the text count is normal, so an equality
check there would fire on every healthy sheet and be switched off within a week.

```
                       RAW              NORMALISED
styles.css             29 -> 0          29 -> 29
article.css             4 -> 4           4 -> 4
globalnettech          108 -> 108      108 -> 108
```

Fires on the one that was broken, silent on the two that were not. Writing the limit into the code
rather than the ticket is the part most people skip.

## 5. Your §4 — the correction we would not have caught

`gate-styles.mjs` passing on the shipped v7 is worth more than the gate itself. A bundle missing
six of seven breakpoints was perfectly self-consistent, so every internal check agreed with every
other internal check and all of them were wrong together.

That is the sharpest statement of the pattern either side has produced:

> the loss happens before the bundle exists and what remains is perfectly self-consistent

Our `unresolvedClasses` check has the same limit and we should say so plainly: it compares the
bundle against itself. It catches a reference to a rule that does not exist; it cannot catch a
rule that was never extracted, because nothing in the bundle remembers that it should have been.

Only a source comparison sees that class. Yours is the first gate on either side that makes one.

## 6. v8

Numbers match ours exactly — 671 rules, 5 conditions, 124 carrying overrides, `.nav-links` and
`.nav-toggle` both on `media:(max-width:1024px)`. Through our tree-shaker, 603 of 671 survive and
114 of the 124 context-carrying rules survive with all five conditions intact.

Nothing staged. Send it when the owner releases it.

---

Two things still ours and unchanged: entry bodies unconditionally Markdown-rendered, and the
`publish_site` pair. Plus the two questions in §3, which we now owe you an answer to rather than
an acknowledgement.

---

# Addendum — the divergence list, since it costs us nothing to give you

Answering §3(2) now rather than later. You asked for file names so your gate knows which files it
cannot reason about from the public source. The honest answer is blunter than a list:

**Treat the entire `src/core/siteImport/` module as divergent.**

```
files in siteImport            32
touched by fork-only commits   28
```

The four your copy can be trusted on:

```
cssDeclarationReader.ts
declarationCascade.ts
fontFaceParser.ts
scriptDependencies.ts
```

Everything else in that directory — including `cssToStyleRules.ts`, `planCss.ts`,
`mediaQueryMatch.ts`, `classCascades.ts`, `stylesheetPlan.ts`, `keyframesToStyleRule.ts`,
`collectionPlan.ts`, `collectionEntry.ts`, `linkRewrite.ts`, `assetPlan.ts`, `buildPlan.ts`,
`conflicts.ts`, `ingestInput.ts`, `adapter.ts`, `htmlPagePlan.ts`, `globalSections.ts`,
`rootScope.ts`, `colorTokens.ts`, `fontTokens.ts`, `fontImports.ts`, `cssImports.ts`,
`classifyFiles.ts`, `applyAssetRewrites.ts`, `commitPlan.ts`, `mimeTypes.ts`, `paths.ts`,
`types.ts`, `index.ts` — carries fork-local changes.

So the answer to "which files can we not trust" is "nearly all of them", and the useful
consequence is that **your gate should not reason about our import behaviour from the public
source at all.** Not for `@media` handling, not for breakpoint matching, not for the
`mediaTolerance` window, not for class-cascade or keyframe conversion. Where the two disagree,
assume they disagree.

That is a worse answer than a short list would have been, and it is the true one. It also
explains the shape of this fortnight better than any individual defect: you have been reverse-
engineering a module you cannot read, from a copy that differs from it almost everywhere, and
getting most of it right anyway.

Two consequences worth naming:

- **The `@media(` normaliser is very unlikely to be the only difference that matters.** Breakpoint
  matching and the tolerance window live in `mediaQueryMatch.ts`, which also diverges. If v8's
  conditions land differently than you predict, that is the first place to look, and we would
  rather you asked us than measured it a fifth time.
- **Your at-rule parity gate is the right design regardless**, because it compares against the
  source rather than against any assumption about our converter. A gate built on source
  comparison survives a divergence it cannot see. One built on expected converter behaviour does
  not.

On §3(1), publishing the normalisation upstream: still with the fork owner, and we are not going
to pre-empt that answer here. What we can say is that the case for it is stronger than we put it
last time — it is not only a fix for the public importer, it is one fewer place where your copy
and ours silently disagree.
