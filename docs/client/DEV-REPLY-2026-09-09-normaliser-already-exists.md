# Your happy-dom finding is correct — and you are building a normaliser we already ship · 2026-09-09

Reproduced your measurement exactly, and then found that our converter has carried the fix since
before this migration started. **You are running an older copy of `cssToStyleRules` than the one
in the repository**, and that is worth more of your attention than the normaliser itself.

## 1. Your diagnosis is right, byte for byte

happy-dom 20.9.0 — the same version we have installed — probed through the raw CSSOM:

```
SPACED  cssRules=2   type1:.nav-links | type4:(max-width: 640px)
TIGHT   cssRules=1   type1:.nav-links                              <- dropped
```

Identical to your table. The at-rule and every declaration inside it are gone with no warning.
Your generalisation holds too: it is the at-keyword followed directly by `(` that does it, which
is why `and(` is harmless.

## 2. But our converter never sees that CSS

`cssToStyleRules` normalises before it touches the sheet:

```ts
// e.g. `@media(min-width:1024px)` - valid CSS per spec but the parser
// mishandles it: `@media(` -> `@media (`, same for @supports and @container.
const normalized = cssText.replace(/@(media|supports|container|layer)(\s*)\(/gi, '@$1 (')
sheet.replaceSync(encodeSubstitutionDeclarations(normalized))
```

Run against the current converter, both forms survive:

```
SPACED @media      rules=2  withContextStyles=2  conditions=[media:(max-width: 640px)]
TIGHT  @media      rules=2  withContextStyles=2  conditions=[media:(max-width:640px)]
SPACED @supports   rules=1  withContextStyles=1  conditions=[supports:(display:grid)]
TIGHT  @supports   rules=1  withContextStyles=1  conditions=[supports:(display:grid)]
```

Your harness measured `conditions=0` for the tight form against what you described as our
converter. Ours returns `conditions=1` for the same input. Same happy-dom version, same CSS,
different result — so the copy you are calling predates that normalisation. It also covers
`@layer`, which your table does not mention and which has the same shape.

**Pin the version you are running before you build anything.** A vendored converter that drifts
silently is a worse problem than the bug it is currently causing: it will keep producing defects
that reproduce on your side and not ours, and this is the second time this fortnight we have
spent a round on that gap.

Your normaliser is not wrong and it is not wasted — it is defence in depth at the point CSS
enters your harness, and it works, as v8-test proves. But do not maintain it as *the* fix for a
bug we already fixed.

## 3. Your direct question

> does your editor's own HTML import path run in a real browser CSSOM?

**The admin import path runs in the browser** — real CSSOM, tight at-rules were never at risk
there.

**The server-side site importer uses happy-dom**, same as your harness, so it would have exactly
your hole. It does not, because of the normaliser above, not because of the environment. You were
right to ask: had the normaliser not been there, a site imported through our own server-side path
would have lost the same blocks just as silently.

## 4. v8-test measured

The fix landed. Against v7:

```
                          v7      v8-test
rules                    666          671
rules with contextStyles   4          124
conditions declared        1            5
```

```
media:(max-width:1024px)              83 rules
media:(max-width:640px)               87
media:(max-width:768px)                7
media:(max-width:980px)                6
media:(prefers-reduced-motion:reduce)  1
```

Through the tree-shaker: **603 of 671 rules survive** (307 class, 296 ambient), and **114 of the
124 context-carrying rules survive**, with all five conditions intact.

The two that matter:

```
.nav-links    survived  ctx=media:(max-width:1024px)
.nav-toggle   survived  ctx=media:(max-width:1024px)
```

The mobile nav override is present and survives shaking. That is the rule whose absence produced
your §2 — the uncollapsed header, the 615px `ul.nav-links` at a 390 viewport, and the inflated
`innerWidth` that made your own overflow check read `0px`. It should now collapse, and
`innerWidth` should report 390.

We have not previewed, imported or published anything. v8-test is measured, not staged.

## 5. Your §3 — you were right to refuse our §4 as written

Hand-declaring conditions and attaching `contextStyles` yourself would have duplicated the
matched-breakpoint folding and the `mediaTolerance` window, and owned a second implementation of
our format that drifts the first time we change ours. That reasoning was correct, and it is the
same reasoning that makes the vendored-converter drift in §2 worth chasing.

The part of our §4 you kept — the context-id to `site.conditions` join in the pre-flight gate —
is the right part. Every `contextStyles` key must resolve to a declared condition, exactly as
every `classId` must resolve to a rule.

## 6. Your at-rule parity gate

The best of the three you listed, and better than our `unresolvedClasses` check, because it
compares against the source rather than against internal consistency. A bundle can be perfectly
self-consistent and still have lost half its breakpoints; only a source-count comparison sees
that.

Worth extending to declaration counts inside each block, not just block counts — a partially
parsed at-rule would pass a block-count check.

## 7. Unchanged from our side

The four in your §6 stand, with the empty-array wipe fixed. The Markdown format defect and the
`publish_site` pair are still open and still ours; they remain the ones that make an unattended
push unsafe.

---

Send v8 when you are ready and we will preview it. The number to watch afterwards is
`innerWidth` at 390 — if the nav collapses, your §2, §3 and §4 close together, because they were
always one defect.
