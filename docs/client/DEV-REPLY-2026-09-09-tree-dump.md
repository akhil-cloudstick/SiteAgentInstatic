# The homepage dump, and why it cannot answer the question you want to ask · 2026-09-09

Two files attached, as requested. Read §2 before you diff them, because the comparison you
described would come back clean for the wrong reason.

## 1. What is attached

```
sheeltron-home-body-cell.json   210 KB   the row's `body` cell, verbatim as stored
sheeltron-home-node-map.json    153 KB   flattened, one record per node, diff-friendly
```

The row: `/` — id `8z-CfBkhaqJb4BqGOGNLf`, status `published`, root `body-Lrya3ZwzEtSr`.

```
nodes 494   reachable 494   orphans 0   distinct classIds 111

base.text 209 · base.container 200 · base.link 45 · base.image 27
base.svg 11 · base.body 1 · base.button 1
```

The node map carries `id`, `depth`, `reachable`, `moduleId`, `classIds`, child count, sorted
prop keys and a `hasDynamicBindings` flag — the shape we would want if we were diffing two trees
and did not want prop-value noise drowning the structural differences. Say the word if you want
prop values as well; it is the same query with one field added.

## 2. ⚠ This tree is your own output, round-tripped

The homepage in our database arrived in **your v7 bundle**. Our importer never touched it — a
bundle import writes `cells` verbatim, so this pageTree is byte-for-byte what your emitter
produced, stored and handed back.

So diffing it against the tree your emitter produces for the same source HTML compares your
output to itself. **It will match, and the match will mean nothing.** That is the same shape as
`unknownFields` on a bundle that declares its own tables, and as your `gate-styles.mjs` passing
on a v7 that was missing six of seven breakpoints: a check that cannot disagree.

What it *does* prove, and this is worth having: **our import path stores your trees without
modifying them.** 494 nodes in, 494 out, all reachable, no orphans introduced, module ids and
classIds intact. If you suspected our storage layer of normalising or dropping anything, it does
not. That question is now closed.

What it cannot tell you is anything about `htmlImport`, because `htmlImport` never ran.

## 3. What would actually answer it

Send us the **source `index.html`** — the file your emitter reads — and we will run it through
our `importHtml()` and send you the resulting tree in the same two forms.

Then the diff is the real one: your emitter's tree against our fork's tree, from identical input.
Every difference is an observed fact about the fork, which is exactly the asset you described
wanting to accumulate.

Without that, the harness records agreement it did not test. We would rather say so now than
after you have built it — you have twice caught a measurement that looked rigorous and was
answering a different question, and this would have been a third with our name on it.

If the source is large or awkward to send, one page is enough, and `/` is still the right page
for the reason you gave: widest spread of the classes we argue about.

## 4. Your §1 — the reproducibility finding

The leaf-level diff is the useful part, and the conclusion is the right one:

> a content digest of our bundle cannot bind an approval, because we cannot re-derive it

Style rule ids stable, node ids not, 920 of 1,501 differing leaves being timestamps. That
localises the fix precisely — derive the ids, pin `--exported-at` — and it explains every
"same size, different hash" we have both been shrugging at for a week.

Worth adding one consequence you did not name: **until node ids are derived, a `replace` import
of a re-emit is not idempotent for us either.** Row ids are stable so rows match, but every node
id inside every body changes, which means our collab CRDT documents and any per-node state keyed
on those ids are rebuilt wholesale on each import. Nothing has broken because of it and we are
not asking you to hurry — but it is why re-importing "the same" bundle is not a no-op on our
side, and it stops being true the moment you derive them.

## 5. Your §2 — the substring hazard

`ambientSel.includes('.' + c)` excusing `.news-card` because something mentions `.news-card-title`
is the better catch of the two, and the fact that it measures identically on this bundle is what
makes it dangerous — a latent hazard that a green run would have confirmed as correct.

We will state the same limit on our side plainly: our strict check has no lenient mode, so it
over-reports rather than under-reports, and 13/94 on a bundle with 11 deliberate drops is noise
we are asking you to read past. Yours is the more useful number now that both are printed.

## 6. Sequence

Unchanged. Import authorisation is the owner's, this note is not one, and we are holding
`b0a2b8b1…` as the artefact. When it comes: replace drops `publishedPages` to 0, the eight
entries arrive as drafts, and the row publish happens explicitly — the site publish will not do
it.
