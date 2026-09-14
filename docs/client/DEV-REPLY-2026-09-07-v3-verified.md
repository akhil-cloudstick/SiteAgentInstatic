# Re: v3, and the check that cannot exist yet — 2026-09-07

v3 verified and previewed. Both runs below. Nothing imported; `sheeltron.com` untouched.

Your §1 is correct and we are not going to soften it: the defect class you describe is
invisible to every automated check on our side too, and we have not shipped a fix for it.
What we can do today is tell you exactly why, and what a real fix requires.

## 1. v3 — verified, including the claim that it is v2 plus one cell

```
sha256  f2b0d9287e671e0e2a76f374821f6d2e4ffa2d88d8334c40ac23ce10e0a4b294
bytes   1,437,365
```

Match.

We did not take "templateTarget corrected" on trust — we diffed v3 against v2 structurally.
The raw diff is 8,467 nodes, which looks alarming and is not:

```
row set, row IDs          identical
node COUNT per page       identical, all 11 pages
node CONTENT (module+props) byte-identical, all 11 pages
non-body cell changes     exactly 1
    templateTarget: "{\"kind\":...}"  ->  {"kind":"postTypes","tableSlugs":["news"]}
```

Everything else is your generator re-minting auto-generated node IDs and timestamps. Your
statement holds exactly as written.

One observation from that, offered because you may not have noticed it: **node IDs are
regenerated on every build.** Harmless under `replace`, which is what you are running. It
would matter if you ever moved to a merge strategy, where a bundle is diffed against what is
already there — every node would read as new. Worth knowing before that day rather than on it.

## 2. Both runs

Run 1, no strategy — and Run 2, `strategy: "replace"`:

```
pages   inBundle 11   willAdd 11   willReplace 0   currentLocal 0
News    inBundle  8   willAdd  8   willReplace 0   currentLocal 0
rowConflicts   []
unknownFields  []
totals         19 rows, 0 media files, 0 media folders, 0 redirects
```

Identical, as expected now that the strategy defaults agree. `currentLocal: 0` against a
`pages` table that really holds 18 rows is the evidence both runs rehearsed the wipe.

## 3. Your §1 — right, and the cause is one line

You concluded `SiteBundleSchema` validates structure and is blind to cell shape. That is
true, and it is not a gap in that one schema. Cells are declared as:

```ts
Type.Record(Type.String(), Type.Unknown())
```

Untyped, everywhere. Not just in the bundle schema — **nothing validates a cell against its
declared field type at write time, at import, or at preview.** So there is no check on either
side of the wire that could have caught this, and your `Value.Check → VALID` on both shapes
is not a shortcoming of your harness. It is the honest output of the contract we published.

Your line — "each one a real check, each one silent on the thing that mattered" — is the
correct reading, and the count is three because the same root cause produced all three.

## 4. What we did fix, what we did not, and why not

### Shipped

- The reader accepts `templateTarget` as an object **or** a JSON string, so the shape that
  produced your 404 no longer produces one.
- The same reader is now shared by the renderer, the Data grid warning band and the context
  tool. Three readers disagreeing about one cell is how a template reads "missing" on one
  surface and present on another.
- One strategy resolver behind `/import`, `/import/archive` and `/import/preview`, with a
  test pinning their agreement rather than pinning either value.

### Not shipped: the check that would have caught it

A check needs the declaration corrected first. Here is the whole reasoning, because you
should be able to audit it rather than take "it is complicated" from us.

**1. There is no type to migrate to.** The full set is text, longText, richText, number,
boolean, date, dateTime, select, multiSelect, url, email, media, relation, repeater,
pageTree, fieldSchema. None means "a JSON value". That absence is why the seed reached for
`longText`, and it is the entire origin of your 404 — so the fix starts by inventing a type,
not by correcting a typo.

**2. Adding a field type is not additive in practice.** Every surface that branches on field
type has to handle it — editor field rendering, grid cell rendering, export, the plugin SDK.
We have not yet traced those paths. An unhandled type does not fail loudly; it renders blank
or throws inside the workspace, which is the same class of silent defect we are trying to
remove.

**3. The migration alters a seeded system table on every existing installation.** It has to
be written twice, once per database dialect, with identical semantics. Installations run
migrations automatically on upgrade and a committed migration cannot be rewritten afterwards
— a wrong one is permanent for everybody, not just for this project.

**4. The preview check cannot ship on its own.** While `templateTarget` is still declared
`longText`, cell-shape validation would flag **v3** — the correct bundle — and pass v2, the
broken one. A check that fails on the right answer is worse than no check, and it would burn
the one signal you have left.

**5. We are not estimating it against your migration window.** Items 2 and 3 need the survey
done before anyone can say how large they are. Quoting you a date derived from a guess is how
the wrong thing ships in a hurry, and this defect class has already cost you three rounds.

### Where that leaves you

Our reader is now **tolerant, not validating**. It stops the bleeding and detects nothing: a
future bundle with a differently-wrong cell will import clean and fail the same silent way.

So keep your own cell-shape assertion in the pipeline. Right now it is the only check in the
system that can catch this class — ours cannot, and saying otherwise would be the fourth
green light in a row that meant nothing.

We will confirm the field type before you build against it, rather than after.

## 5. §2, §3, §4

`unknownFields` — agreed, and nothing to add. The empty array is structurally incapable of
failing on a bundle that declares its own tables, which is every bundle you send.

The strategy default — agreed, including that it understated rather than overstated the blast
radius, which is the more dangerous direction.

Publish order — confirmed, and your framing as an ordering constraint rather than a
preference is the right one. Template first, or the whole site at once. Articles alone
produces rows that read Published and serve 404s, which is the failure with no visible
symptom on our side either.

## 6. No go-ahead

Understood, and recorded the same way: a preview result is not an authorisation, this note is
not one, and we will wait for a message that says so explicitly.

---

v3 is good and will import correctly when you send the word. The thing that caught the defect
was a person reading a cell, and until the three items above land, that remains true — so we
would rather you hear it from us than infer it from a green preview.
