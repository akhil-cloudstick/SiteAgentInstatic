# Re: withdrawal, and the entry template — 2026-09-04

Answering §2 first, because it is the blocker. The withdrawal needs a correction that runs
the other way from the one you made.

## 1. What a minimum entry template is

**The outlet is not bound to anything. There is nothing to author.**

That is the piece that cannot be worked out from the manifest side, and it is why the search
came up empty: every `base.outlet` carries an implicit binding, injected at render time and
never persisted on the node —

```ts
const OUTLET_BODY_BINDING: DynamicPropBinding = {
  source: 'currentEntry',
  field: 'body',
  format: 'html',
}
```

`effectiveNodeBindings()` merges it into any node whose `moduleId` is `base.outlet`, on both
the publisher and the editor canvas. There is no UI for it and no bundle field for it. An
outlet is, by definition, the hole the current entry's body flows into — so a bare outlet
already renders the entry.

Two consequences worth having:

- A bundle that tries to author `dynamicBindings: {html: …}` on the outlet is doing work that
  the renderer overwrites. Harmless, but it will look like it is doing something it is not.
- Outside an entry route the entry stack is empty, `currentEntry.body` resolves to nothing,
  and the outlet renders empty. That is how the same mechanism serves an `everywhere` layout.

### The minimum shape

A `pages` row. Three cells make it a template:

```
cells.templateEnabled  : true
cells.templateTarget   : { kind: 'postTypes', tableSlugs: ['news'] }
cells.templatePriority : 0
cells.body             : a pageTree whose root is base.body and which contains
                         EXACTLY ONE base.outlet
```

That is the whole requirement. A root and an outlet will render every entry — unstyled, but
resolving with a 200 rather than a 404.

**Exactly one outlet, not "at least one."** A document holds at most one; the composer fills
the first and leaves any others empty, so a second outlet is a silently dead node.

`templatePriority` matters only when two templates target the same collection — ties resolve
by document order, which is nobody's intent. One template per collection, and priority is
irrelevant.

### Emitting it directly vs authoring it

Emitting it in the bundle is supported and is the right call for your pipeline — the shape
above is the contract, not an implementation detail of the editor. Authoring in the Site
editor produces the same three cells.

In practice most people want more than a bare outlet: the collection's chrome — header, nav,
article container, footer — around the hole. The approach we use when converting a folder of
posts is to take one real article, empty its content region, and drop the outlet in its
place. That keeps the delivered design and needs no new authoring. If you have 8 converted
news articles already, one of them is your template with its `<article>` contents replaced.

Two things that may save you the work entirely:

- `connector_create_entry_template` builds a conforming template through the connector,
  including the duplicate-target refusal.
- The site importer now creates collections and their entry templates automatically from the
  folder layout (`<collection>/<slug>/index.html`), deriving the template from the first
  entry. If you would rather ship a folder tree than a hand-built bundle, that path exists.

## 2. Your reading of the 404 is correct — and now says so

Confirmed exactly as written: a post-type row with no matching template in its chain is
skipped by the baker and 404s at the router, while the row reads `status: published` in the
admin. `status` describes the row. It has never described whether anything exists to render
it, and nothing in the UI closed that gap.

You were right that it deserves a signal. The Data workspace now prints a warning band above
the grid whenever a routed collection has no entry template targeting it:

> **No entry template targets `news`, so its entries return 404 even when published.**
> Create a page in Site with Template enabled, targeting this collection, containing one
> Outlet block.

It distinguishes *unknown* from *absent*: if the template read fails, no band appears. A
warning we cannot stand behind is the same failure as the missing one, pointed the other way.

So the outcome you were protecting against — 8 rows landing in a state that reads healthy and
serves 404s — is now visible from the grid rather than only from the live site.

## 3. On the withdrawal — half of it should be withdrawn

The self-criticism about method is yours and we will not argue with it. The conclusion about
our code is over-corrected, and you should have this before you file it as a non-issue.

**We did not check and find no lag. We found a real defect and fixed it.**

The admin grid was calling the row-list endpoint with no field projection, so it pulled full
rows — page bodies included — to populate five text columns. Measured on Sheeltron's actual
data:

```
DB query, full rows     18 rows, 1.37 MB    126 ms
DB query, summary       18 rows               42 ms
JSON serialisation      1.37 MB               17 ms
```

The server was never slow. The request was wrong. **Your hypothesis in §1 was correct** —
"the grid may be pulling full rows to populate five columns that need none of the body" is
exactly what it was doing, and a summary projection was most of the fix.

One correction to it: the existing `fields=summary` dropped `cells` entirely, which would
have blanked Title, SEO title and SEO description. The projection now keeps the full row
shape and strips only document-valued cells, so the grid gets every column it renders without
the megabytes.

What we cannot claim is that this explains six to eight minutes. 1.37 MB does not take
minutes to move, and we did not reproduce the symptom — so something amplified it
client-side, and a transient is still a plausible reading of the rest. The projection removes
the input to whatever that was. If it recurs after the next deploy, capture it live as you
suggest and we will chase the amplifier rather than the payload.

So: the measurements did not license the conclusion, and the conclusion happened to name the
right file. Both things are true, and only the first is a method fault.

## 4. The `/news` index loop

No gotcha in authoring a loop against a freshly created post-type table — the table needs to
exist first, which yours will.

One behaviour worth knowing before you build it: inside a `base.loop`, `currentEntry` refers
to **the loop's current item**, not the page's entry. The renderer pushes each item onto the
entry stack for the duration of that iteration, so bindings inside the loop resolve against
the row being iterated, and bindings outside it resolve against the page. That is what you
want for an index — it is only surprising if you expect `currentEntry` to mean one fixed
thing per document.

Loop data is prefetched server-side at publish time, so an index page bakes static with the
articles baked in. Adding a ninth article means republishing, exactly as with your frozen
snapshot — the difference is that the list stops being hand-maintained.

## 5. `site.webmanifest`

Fixed. The admin shell's `<link rel="manifest">` pointed at a file that was never served;
the manifest now exists and references the icons that were already there. Ships with the next
deploy.

## 6. §4

Agreed on both, and neither is on our list. The `chrome.runtime.onMessage` warning is an
extension. The absolute `sheeltron.com` image URLs resolve and render — worth migrating when
you do the media tranche, not a platform gap.

---

Nothing blocking from our side. §1's shape is the contract; if you emit it and an entry still
404s, send us the row and the template and we will look at the chain rather than guess.
