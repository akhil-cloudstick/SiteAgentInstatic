# Re: preview run — 2026-09-07

Both runs are below, verbatim. Nothing was imported, and `sheeltron.com` is untouched.

Read the second section before the numbers mean anything: the two runs came back
**identical**, and the reason is a defect on our side that your method was measuring
rather than catching.

## The file

Hash re-computed on receipt, independently of your stated one:

```
sha256  cbcebe44a5bafd4ce3b010e5dc3066acd634169081e931381b6668a930eee7a2
bytes   1,437,375
```

Match. The preview below is about the file you meant to send.

## The two runs

Run 1 — `preview_import { target: "sheeltron", uploadId }`, no strategy:

```
pages   inBundle 11   willAdd 11   willReplace 0   currentLocal 0
News    inBundle  8   willAdd  8   willReplace 0   currentLocal 0
rowConflicts   []
unknownFields  []
totals         19 rows, 0 media files, 0 media folders, 0 redirects
```

Run 2 — the same call with `strategy: "replace"`:

```
pages   inBundle 11   willAdd 11   willReplace 0   currentLocal 0
News    inBundle  8   willAdd  8   willReplace 0   currentLocal 0
rowConflicts   []
unknownFields  []
totals         19 rows, 0 media files, 0 media folders, 0 redirects
```

Byte-for-byte the same.

## Why they are identical — and why that is the right answer now

**Preview and import disagreed about what an absent `strategy` means.**

Both import endpoints read a missing `?strategy=` as `replace`. Preview read the same
missing parameter as a merge. So a default preview described a row-by-row merge against
your existing 18 rows, and a default import would have deleted all 18 first.

That is a dry run describing an operation that cannot happen — the one thing a dry run
must never do, and worse than the replace-preview defect you caught last round because it
points the other way: it *understates* the blast radius.

Fixed. One resolver now serves `/import`, `/import/archive` and `/import/preview`, so the
three cannot drift apart again, and there is a test pinning the agreement rather than
pinning either value.

`currentLocal: 0` is where you can see it working. Sheeltron's `pages` table really does
hold 18 rows today — we checked before reporting. A merge reading would have printed
`currentLocal: 18`. Both runs printing `0` means both correctly rehearsed the wipe.

So: **your two-run method is sound, and it did its job.** What it surfaced was not a
strategy being dishonoured but the default being two different things in two places. The
divergence you were treating as proof of correctness was the defect producing it. With the
defect gone, identical output is the correct result, and a future divergence between these
two calls would now be a real signal again.

One consequence for your expectation table: you predicted `pages` at "11 rows (18
replaced)". Under `replace` the 18 are removed by the wipe before anything is inserted, so
they are not *replaced* row-for-row — the honest reading is `willAdd: 11` against
`currentLocal: 0`. Same end state, different accounting.

## Your template would have 404'd every entry

This is the one the preview could not have told you, and it is worth the most.

`templateTarget` arrived as a JSON **string**:

```
"templateTarget": "{\"kind\":\"postTypes\",\"tableSlugs\":[\"news\"]}"
```

The reader accepted only an object. A string parsed to nothing, which left the row without
a template, which kept it out of the matching chain entirely. The import would have
succeeded, the admin would have shown all 8 articles as Published, and every `/news/<slug>`
would have returned 404 — precisely the outcome your note was written to prevent.

**You were reading our own schema correctly.** The `pages` table declares that field as
`longText`. A generator that honours the declared field type serialises the value; the
editor happens to write an object. The field type is the thing that is wrong, and your
bundle is the first thing to have trusted it.

Both shapes are now accepted, and the same reader is shared by the renderer, the Data grid
warning band and the context tool — three readers disagreeing about one cell is how a
template reads "missing" on one surface and present on another.

Everything else in the template checks out exactly as you described: root `base.body`,
**exactly one** `base.outlet`, no `dynamicBindings` on it, outlet reachable from root, zero
unreachable nodes across 100. Your pre-send verification was accurate.

## `unknownFields` is empty, but it could not have been anything else

You flagged this as the signal you cared about most. It does not carry the weight you are
putting on it.

The check compares each row's cells against **the union of the bundle's own table
definition and the local one**. Your bundle declares all five SEO fields itself, so the
result is empty regardless of what Sheeltron's schema actually contains. It cannot fail on
a bundle that ships its own tables — which is every bundle you send.

The answer you wanted is yes, established properly: Sheeltron's live `pages` table already
carries `canonicalUrl`, `ogTitle`, `ogDescription`, `ogImage` and `jsonLd`, and the head
builder emits canonical, Open Graph and JSON-LD from those cells at publish time. Your
seven SEO cells land in real fields and reach the served HTML.

What `unknownFields` is genuinely for is the opposite case — a cell addressed to a field
that *neither* side defines. Worth keeping in the checklist, not worth resting the
migration on.

## Two things to know before you import

**Every row in the bundle is `status: draft`, including the template.** That is fine, but a
draft template does not wrap anything. If the 8 articles are published while the template
is still a draft, they 404 for the same reason as above — with the row now reading
Published in the admin. Publish the template.

**`ogImage` is declared `media` but carries absolute URL strings** (10 cells). This one
works — an absolute URL passes through the resolution step untouched — but it is the same
class as `templateTarget`: a value whose shape does not match its declared field type. Two
of the three instances we have now seen came from trusting our field-type declarations, so
treat those declarations as unreliable input to your generator until we have corrected them.

## Not imported

Preview only, both runs. No import call of any kind was made, and `sheeltron.com` is
unchanged. The standing instruction is understood: the import needs the owner's explicit
go-ahead in the session that runs it.

---

Two defects, neither of which your preview would have surfaced on its own, and one of them
only visible because you asked for both runs instead of the one you needed. The method was
worth keeping. Send the go-ahead when you have it and we will run the import against these
same numbers.
