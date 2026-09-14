# Re: does page-level SEO reach the published head? — 2026-09-03

**Short answer: yes. Page SEO is rendered by the core renderer, not by a plugin.
There is no install step, no per-tenant dependency, and nothing blocking your demo.**

Taking your three questions in order, then the ⚠, then §6.

## 1. Is page SEO delivered by a plugin?

No. It is delivered by the core publisher, on the page path, unconditionally.

`renderPublishedSnapshot` does pass the SEO argument you have as missing —
`server/publish/publicRenderer.ts`:

```ts
const rendered = await renderMergedTemplate(
  merged, snapshot, templateContext, ctx,
  await readPageSeo(ctx, snapshot.pageRowId),
)
```

`renderMergedTemplate` takes a fifth `seo?: DocumentSeo` parameter and threads it into
`publishPage`. `readPageSeo` re-reads the row by `pageRowId` and pulls the SEO cells
directly.

**Your reading of `pageFromRow` is correct, and it is the reason that function exists.**
`pageFromRow` does copy only those six cells, and the `Page` type has nowhere to put SEO.
Rather than widen `Page` — which would push SEO through the whole page-tree engine that
has no use for it — the renderer re-reads the row at publish time. The comment above
`readPageSeo` says exactly this: *"A collection entry carries its cells into the render on
the entry stack, but a page does not."*

So: same conclusion you reached about the storage boundary, different resolution than you
inferred.

## 2. Is the plugin installed on `sheeltron` and `global-nettech`?

The question does not arise, and it is worth being precise about why, because you built a
deployment concern on it.

**"SEO Suite" is not a plugin.** It appears exactly once in the entire repository — the
doc comment you quoted, at `server/publish/publishedHtmlPipeline.ts:12`. It is prose,
naming a hypothetical plugin to illustrate what `publish.before` is for. There is no
manifest, no package, no install path, and nothing in the publish path depends on one.

You were right to ask rather than assert. The inference was reasonable from a host comment
that names a thing as though it exists.

**The operational consequence you were bracing for does not exist.** *"The SEO fields are
migrated"* and *"the SEO will render"* are the same statement here. No human step stands
between a new tenant and its first correct publish.

## 3. What do those 18 pages publish with today?

Their own SEO. `readPageSeo` returns title, description, canonical, the Open Graph set and
JSON-LD from the row's cells, and `src/core/publisher/render.ts` emits each one when
present — `rel="canonical"`, `og:title` and `application/ld+json` are all in that file.
Your "zero occurrences" count is accurate against your mirror and stale against the current
build.

One detail worth having, since it affects what you will see on the Sheeltron pages:
`readPageSeo` resolves `ogImage` from a media-asset id to a real path before emitting it.
An editor-picked image is stored as an id, so without that step `og:image` would publish a
value with no scheme that silently resolves as a relative URL. If a migrated row carries an
absolute URL in that cell instead, it is left alone.

Two deliberate omissions, so they do not read as bugs:

- **The 404 template gets no page SEO.** A 404 body is served at whatever URL missed, so a
  canonical resolved from the template row would point a crawler at the error page as if it
  were a real document.
- **Collection entries do not use this path.** Their cells arrive on the entry stack and are
  read from there. That is the commit `a0b1e4e5` you found — it is entry-specific because
  the page path is handled separately, not because the page path was forgotten.

## 4. Your ⚠ was right, and it is now fixed

This is the one thing in your note that was a live defect, and you found it by reasoning
about precedence rather than by testing. It was real:

```ts
const title = seo.title ?? settings.metaTitle ?? page.title ?? site.name
```

A row's own `seoTitle` did win first, so your worst case — one title across every page —
did not occur for pages carrying SEO. But for any page **without** its own `seoTitle`,
`settings.metaTitle` beat `page.title`. On a site with a Meta Title set, every
un-optimised page published under one identical `<title>`. On 497 pages that is 497
documents a crawler cannot tell apart, produced by a setting whose name promises a default
and whose behaviour delivered an override.

Now:

```ts
const title = firstNonEmpty(seo.title, page.title, settings.metaTitle, site.name)
```

`firstNonEmpty` rather than `??` because an unset page title is `''`, not `undefined` —
`??` would have handed an empty `<title>` to exactly the pages the change was meant to
help. That was caught by a test rather than by review, which is the honest account of it.

Four regression tests pin the new order, including the one that matters: two pages with
different titles publish two different `<title>` tags while a site-wide Meta Title is set.

## 5. §6 — confirmed, and fixed

Your finding is correct and the reasoning is exactly right: an import held a privilege two
other surfaces deny.

Both `updateDataTable` call sites in `server/handlers/cms/import.ts` — the `replace` path
and the `merge-overwrite` path — now run the bundle's table through the same
`assertSystemTableUpdateAllowed` guard the admin UI and the HTTP PATCH apply. A bundle can
no longer repoint a system table's `routeBase`, rename it, or rewrite a built-in field.

One design note, since it changes what you would observe: frozen fields are **dropped**,
not the import **rejected**. A bundle exported from this same CMS carries its system tables
back verbatim, so a strict guard would fail the equality check on every ordinary round-trip
over values the bundle never meant to change. Dropping keeps the round-trip working and
makes the disallowed change a no-op. Custom tables pass through untouched.

Your workaround was the right call regardless — a custom post-type table with its own
`routeBase` is the supported path, and it stays supported.

## 6. On §2 of your note

Recorded, and not something we would have raised. "We verified stored, called it verified,
and never published a page to find out" is a sharper statement of the problem than the
question that prompted it. The check that cannot disagree is worth naming every time it
appears.

For what it is worth, the same gap existed on this side: page SEO rendering had no test
until the title-precedence fix above added one.

---

**Nothing here blocks the demo.** Page SEO renders from the core on every published page.
The title-precedence fix matters most on Global Nettech's 497 pages — if any were published
before today with a site-wide Meta Title set, republish to pick up per-page titles.
