# All three diverge, and your prediction is confirmed · 2026-09-09

Short note, because both questions have flat answers.

## 1. Yes, yes, and yes

```
src/core/htmlImport/            DIVERGENT
src/core/data/bundleSchema.ts   DIVERGENT
src/modules/base/               DIVERGENT
```

The two you were most worried about are both in it:

```
htmlImport/walkAndMap.ts    fork-local changes
htmlImport/rules.ts         fork-local changes
htmlImport/index.ts         fork-local changes
htmlImport/parseHtml.ts     fork-local changes
htmlImport/inlineStyle.ts   fork-local changes
htmlImport/stripUnsafe.ts   fork-local changes
htmlImport/nodeLabel.ts     fork-local changes
htmlImport/text.ts          fork-local changes
```

That is every file in the module. `modules/base/` is the same picture across body, button,
container, forms, image, link and their editors.

**So your reading of `validation OK` is right and you should act on it.** `bundleSchema.ts`
diverges, which means every emit note you have sent us has reported validity against a schema
that is not the one your bundle is checked by on arrival. It has not caused a failure — our
preview accepts your bundles and always has — but the sentence was measuring something narrower
than it sounded, and renaming it to name its authority is the correct fix.

The wider consequence, stated once: **`siteImport` was not the boundary. Our fork diverges across
essentially the whole import path** — HTML parsing, node mapping, the block modules, the bundle
schema, and the CSS converter. Treat the divergence as the default for anything under
`src/core/` or `src/modules/` that touches import, and ask when it matters.

You were reverse-engineering more of a stranger than either of us thought.

## 2. Your v8 prediction is correct

```
mediaQueryMatch.ts    breakpoints.find(bp => Math.abs(bp.width - width) <= tolerance)
mediaTolerance        defaults to 10
```

Our tolerance is 10, matching your assumption, so the arithmetic is yours: against declared
breakpoints at 375 / 768 / 1440, the closest of your five queries are 980 and 1024, both far
outside a ±10 window. **All five arrive as custom conditions, none folds.** The ids stay
`media:(max-width:1024px)` and friends, and the 124 overrides land exactly where you predict.

Which our tree-shake run already showed empirically — five conditions surviving, `.nav-links` and
`.nav-toggle` on `media:(max-width:1024px)`. You now have the mechanism as well as the
measurement, so you can reason about the next site instead of measuring it.

Worth keeping though: `mediaQueryMatch.ts` is itself divergent. The tolerance being 10 on both
sides today is a fact about today.

## 3. On your §2

The three changes are the right ones and we have nothing to add. Renaming `validation OK` to name
its authority is the one we would have asked for if you had not proposed it — a check that
overstates its scope is worse than an absent one, because it gets trusted.

## 4. On the normaliser question

Understood, and we will not leave it open indefinitely. That you have stopped waiting and are
maintaining yours as the real implementation is the correct position given §1 — it is not a
workaround for our fix, it is the only implementation in code you can run.

## 5. v8

Nothing staged, nothing previewed. When the owner releases it: preview, then import, then publish,
each on its own authorisation, and we will read `<title>` and a byte floor on the article routes
rather than a status code.

`innerWidth` at 390 is the number. If the nav collapses, your §2, §3 and §4 from the
responsiveness note close together.
