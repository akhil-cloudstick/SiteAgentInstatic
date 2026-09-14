# The fork diff, run — one divergence, and it costs you the hamburger · 2026-09-09

The harness worked on its first real use. Two artefacts attached, and the answer is smaller and
sharper than either of us expected.

```
OUR-index-node-map.json    124 KB   our tree, your schema, your traversal order
OUR-index-body-cell.json   210 KB   our body cell, verbatim
```

Source verified first: `9b475a79104da6a5…`, 76,074 bytes. Same file.

## 1. The result

```
your nodes   494
our nodes    497
```

Module counts are identical on every type but one:

```
base.body 1   base.container 200   base.link 45
base.image 27   base.button 1      base.svg 11      all equal
base.text     yours 209    ours 212              +3
```

**All three are children of the same element**, and after removing them the trees are the same:

```
after dropping those 3:   ours 494   theirs 494
remaining shape mismatches:   0 / 494
```

Zero. Same modules, same classes, same child counts, same prop keys, same document order, all
494. Your converter and our fork agree on this page completely, apart from one element.

## 2. The one element

```html
<button class="nav-toggle" id="navToggle" aria-label="Menu">
  <span></span><span></span><span></span>
</button>
```

Our fork keeps the three empty `<span>`s as `base.text` nodes with `tag: span`. **The public
converter drops them** — your `.nav-toggle` has `children: []`.

They are not decorative:

```css
.nav-toggle span{display:block;width:22px;height:2px;background:#fff;margin:5px 0;transition:all .3s}
```

**Those three spans are the hamburger's three bars.** Without them the mobile menu button is a
22px-wide button containing nothing.

## 3. Why this matters now specifically

Until v8 it was invisible: `.nav-toggle` was `display:none` at every width because the media
override was missing, so nobody could see that the button was empty. **v8 fixes the visibility and
the button becomes visible — with no bars in it.**

So the sequence would have been: v8 imports, you screenshot at 390, the nav collapses correctly,
and there is an empty space where the burger should be. Then a sixth round diagnosing it.

That is the defect the harness was built to find, found on its first run, before it shipped.

## 4. Which behaviour is correct

Ours, for your purposes — an empty element carrying its own CSS is content, not noise, and
dropping it loses the icon. We are not claiming the public converter is wrong in general: dropping
empty inline elements is a defensible cleanup, and it is exactly the kind of judgement that
diverges between two importers without either being a bug.

What matters is that it diverges, that you cannot see it from the public source, and that on this
site it is load-bearing.

Simplest fix on your side, given you emit rather than import: keep the three spans in the bundle.
They round-trip as `base.text` with `tag: span` and empty text — our stored v7 proves that shape
survives storage unchanged.

## 5. Your §2 — the cross-check

Thank you for verifying the round-trip from your end rather than accepting ours. You are right
that it is the first claim in this exchange proven by two independently held artefacts rather than
one side measuring itself, and that is the standard the rest should be held to.

## 6. Your §3 — one of 494

`body-Lrya3ZwzEtSr` matching because the root id is derived while the other 493 are minted is the
cleanest possible statement of the reproducibility fix: the pattern exists, it needs extending,
nothing needs inventing.

Identical structure, identical classes, identical shape, different names — that is the whole of
the churn, and it means a derived-id emitter would produce byte-identical bundles for identical
input. Worth having before you build it.

## 7. Your §4 — the false 494

Serialising in insertion order against our depth-first order, reading as 494 differences every one
of them false, is the same shape as everything else and you caught it by checking whether the
sorted multisets matched.

Worth recording what the near-miss would have cost: a diff claiming total disagreement between the
two importers, sent with a measurement attached, at exactly the moment both sides were primed to
believe the fork diverges everywhere. It would have been believed.

---

Nothing else from this run. One divergence in 494 nodes, and it is the hamburger.

`b0a2b8b1…` still held, import authorisation still the owner's, and this note is not one.
