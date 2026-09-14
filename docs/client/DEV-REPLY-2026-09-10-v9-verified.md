# v9 verified — the fix is right, and one word stops it loading · 2026-09-10

Every number in your note checks out. The hamburger fix is correct and it is more thorough than
ours. **Do not import this build**, because the 33 nodes it restores are named with the wrong key
and all eleven pages drop on load.

## 1. The artefact

```
sheeltron-bundle-v9.json   1,469,999 bytes
sha256   04a0a7b4ac0ebfd877107a44fb845be20f4b511694b22f4a030555733e1fa39b
```

Matches the hash in your note. Measured against that file throughout.

## 2. Everything you stated is confirmed

```
rows                     19          11 pages + 8 news
styleRules              671
rules with contextStyles 124
conditions                5          all custom, none folded
cells                   169/169      non-empty, all shapes valid
classId references     1472
```

The repair, verified independently:

```
trees carrying a .nav-toggle       11 of 11
each with exactly 3 span children  11 of 11
restored nodes total               33
index tree                        497 nodes
```

497 is the number our fork produced from the source HTML. Your emitter and our importer now agree
on that page exactly — 494 shared nodes plus the same three bars.

And you were right that it was not one page. `news-entry-template` carries the header too, so all
eight articles render through it. Detecting the shape against the source rather than hard-coding
three spans found ten trees we never looked at.

## 3. ⚠ The blocker — `childIds` where the field is `children`

The 33 restored nodes are shaped differently from every other node in the same tree:

```json
restored     {"id":…,"moduleId":"base.text","parentId":…,"classIds":[],"childIds":[],"props":{…}}
every other  {"id":…,"moduleId":"base.text","props":{…},"breakpointOverrides":{},"children":[],"classIds":[],"parentId":…}
```

`children` is a **required** field with no fallback — `parseBaseNodeFields` calls
`requireArrayField(r, 'children')` and throws when it is absent. `childIds` is not read anywhere.

`parsePage` does not catch per node, so one bad node fails the whole page. We ran your bundle
through the real load path:

```
[persistence/validate] dropping unparseable page 0  pages[0].nodes.n-BN5iaRMROfFz.children: Expected array
[persistence/validate] dropping unparseable page 1  pages[1].nodes.n-9lVY0zU8n3uk.children: Expected array
…all eleven…
TOLERANT LOAD -> pages surviving: 0 of 11
```

**Zero pages.** The import itself would succeed — a bundle import writes `cells` verbatim, and the
preview validates the bundle, not the trees inside it — so this passes every gate on both sides and
then the site is empty in the editor. The eight news entries are unaffected as rows, but they
render through `news-entry-template`, which is one of the eleven.

This is the same shape as the rest of the fortnight: the loss happens after the bundle is checked,
and the bundle is perfectly self-consistent.

## 4. The fix, verified

Rename the key. Nothing else:

```
nodes renamed childIds -> children: 33
TOLERANT LOAD -> pages surviving: 11 of 11
index nodes: 497
nav-toggle children after load: 3   base.text:span | base.text:span | base.text:span
STRICT LOAD -> error: (none)
```

Strict as well as tolerant, so it is not passing on leniency.

One smaller thing while you are in there: the restored nodes also omit `breakpointOverrides`.
That one is harmless — it has a tolerant fallback to `{}` — but emitting it keeps the restored
nodes identical in shape to their siblings, which is what the claim in your note describes.

Worth naming precisely, because the note said the restored shape is the one our stored v7 proves
survives storage: v7's stored nodes carry `children` and `breakpointOverrides`. The v7 evidence is
sound, it just describes the other shape.

## 5. Your classId count and ours, again

```
yours   1448 / 1472
ours    1378 / 1472        strict — resolved only when a rule id equals the classId
unresolved  13 classes across 94 references
```

Same 13 and same 94 as v8 — `news-card` 18, `icon-tt` 17, `case-card` 12, `bf-card` 8 and the
rest. Eleven are your deliberate js-gated drops. Nothing moved, and this is the counting
difference from our v8 §2 rather than a new finding. The total, 1472, matches exactly on both
sides.

## 6. Sequence

Nothing imported, nothing published, nothing staged. `04a0a7b4…` is held and not authorised.

Send v10 with the key renamed and we will preview it the same way, then import on the owner's
word, then publish — with the eight news rows published explicitly, since the site publish still
will not carry them.

`innerWidth` at 390 is still the number that closes this out, and with 497 nodes on the homepage
there will finally be something inside the button when it appears.
