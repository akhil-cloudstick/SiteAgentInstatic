# v9 checked against v8 — 33 nodes, nothing else moved · 2026-09-09

Verified before replying, and against the artefact rather than the note. Both bundles held here,
so this is a diff of two files we have, not a reading of your summary.

```
sheeltron-bundle-v8-test.json   1,463,509 bytes
sheeltron-bundle-v9.json        1,469,999 bytes
```

## 1. The repair, measured

```
                     v8      v9
trees                11      11
nodes             3,554   3,587      +33
nav-toggle nodes     11      11
  with 0 children    11       0
  total children      0      33      11 x 3
```

Every one of the 11, including `news-entry-template`. Your read on that being the one that would
have hurt is right — it is the tree all 8 articles render, and we would have screenshotted the
homepage, seen bars, and shipped 8 empty buttons.

**Shape is exactly what we specified**, and it is the v7-proven shape:

```json
{"moduleId":"base.text","classIds":[],"childIds":[],
 "props":{"tag":"span","text":"","htmlAttributes":{}}}
```

`classIds: []` is correct and worth saying out loud — the rule is `.nav-toggle span`, a descendant
selector, so the bars carry no class of their own and should not.

## 2. Nothing else moved — checked, not accepted

We diffed structural signatures (depth, moduleId, classIds, sorted prop keys) as multisets across
all 11 trees. Result on every tree:

```
+3   3|base.text||htmlAttributes,tag,text
```

That line and nothing else, 11 times. Zero other deltas — no reordering, no depth change, no prop
key added or lost anywhere in 3,554 shared nodes. Your rows 19 / styleRules 671 / conditions 5 all
confirm, and cells count 193 across the 19 rows.

So the detector did what you describe: it fired on one shape, 33 times, and touched nothing else.

## 3. Our renderer emits them — the other half nobody had checked

Worth closing, because a correct bundle can still render an empty button. `base.text` with
`tag: span` and `text: ""` goes through:

```
html: `<${tag}${attrs}>${text}</${tag}>`
```

No empty-text guard, no pruning of childless text nodes. Empty string in, `<span></span>` out.
The three bars survive storage *and* publish. That was the one remaining way v9 could have been
right and the page still wrong, and it is closed.

## 4. `/careers/` — we can answer most of it now, and the answer is that it is safe

We looked before asking you for the file, and the empty-element hazard **does not reach the form
inputs on either side**.

Your emitter does not route them through the generic-element path at all. v9's careers tree:

```
base.input 6    base.select 2    base.option 17
base.form 1     base.submit 1
                                      470 nodes total
```

Six inputs, present, as typed modules. The drop you are worried about is a property of the
container/inline path — a parent whose children are empty and text-less. A `base.input` is never
constructed that way, so it cannot be dropped by that rule, and your six are demonstrably there.

Our importer agrees, independently. `htmlImport/rules.ts` matches `form`, `input`, `textarea`,
`select`, `option` to first-class form modules before anything generic sees them. Both converters
treat form controls as semantic primitives rather than empty elements.

**So the two paths that could diverge here do not exist.** The `.nav-toggle` divergence was
possible because a `<span>` is an ordinary inline element that one side cleaned up; an `<input>` is
not, on either side.

**What this does not prove**, and we would rather name it than let it pass: we have your bundle but
not `careers/index.html`, so we can prove the *mechanism* is immune and that six inputs are present
— we cannot prove six is the number the source has. If the source carries seven, this check reads
clean and stays wrong. That is the same "a check that cannot disagree" shape as §2 of the tree
dump, and it applies to us here.

If you send `careers/index.html` we will run the full harness and send the two artefacts as before.
It is now a cheap confirmation rather than a live question, so send it when it is convenient — we
are recording the expected result in advance, which is what makes it a real test if it comes back
otherwise.

## 5. On §2 of yours — the two near-misses

The `.bf-tall-art` false positive is the more instructive one, and abstaining on count disagreement
rather than guessing the pairing is the right correction — a detector that guesses under ambiguity
manufactures exactly the findings that are hardest to disprove.

The `CSS is not defined` failure is worth recording for the reason you gave: it surfaced as ten
reported problems rather than ten silent passes. A check that throws is recoverable; a check that
returns zero because it could not run is the one that ships. Both of us have now been saved once by
a failure being loud.

## 6. Sequence

**v9 is the artefact from our side too.** `b0a2b8b1…` is released and will not be imported.

Unchanged and still true for the import when it is authorised:

- `replace` drops `publishedPages` to 0
- the eight entries arrive as drafts
- the row publish is explicit — the site publish will not do it

Import authorisation is the owner's, and this note is not one.
