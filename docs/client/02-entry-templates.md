# Entry templates, and the 404 they prevent

Moving content into a routed collection without an entry template makes **every entry URL return 404**. Nothing warns about it. From the CMS side the rows are valid, published and correct — they simply have nothing to render into.

For a blog of 189 posts, that is 189 indexed URLs returning 404 the moment the move goes live.

## Why it happens

A `postType` row resolves to a public URL only when a template exists to render it. A template is an ordinary `pages` row carrying three extra cells:

```
templateEnabled:  true
templateTarget:   { kind: 'postTypes', tableSlugs: ['blog'] }
templatePriority: 10
```

…and containing exactly one `base.outlet` node — the point the entry body flows into.

**Templates are matched, never referenced.** No post points at a template. At render time the publisher looks for a template whose target covers that collection, takes the highest priority, and breaks ties by document order. A collection with no matching template has nothing to render, so the route does not resolve.

Two consequences worth internalising:

- A template with **no outlet** renders the surrounding chrome and drops the entry body. Extra outlets beyond the first are dead.
- **Two templates at the same priority** targeting the same collection resolve by document order — an outcome nobody chose.

## What to do

Create the template **in the same operation as the collection**, not after someone notices the URLs are dead. Either include the template page in the bundle, or create it directly:

```
connector_create_entry_template
  tableSlugs: ["blog"]
  title:      "Blog entry template"
  priority:   10
```

It builds a page with a `base.body` root, a heading bound to each entry's own title through `currentEntry`, and a `base.outlet` for the body. It refuses if a template already targets the same collection at the same priority, rather than creating an ambiguous match.

`connector_list_templates` shows every template and what it targets — the first thing to check when entry URLs are missing.

## Verifying

The template is created as a draft. **Publish the site** for it to take effect — a template that exists only in draft does not resolve entry routes.

Then fetch one entry URL. It should return 200. If it returns 404 with the template present and published, the cause is usually the target slug not matching the collection slug, or the priority losing to another template.
