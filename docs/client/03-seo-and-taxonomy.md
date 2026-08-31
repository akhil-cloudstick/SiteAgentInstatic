# SEO fields and taxonomy

## What the stock schema held

```
pages : title, slug, body, seoTitle, seoDescription,
        templateEnabled, templateTarget, templatePriority
posts : title, slug, body, featuredMedia, seoTitle, seoDescription
```

No canonical URL. No Open Graph. No JSON-LD. No taxonomy table of any kind — tags and categories had nowhere to live, which is a missing feature rather than a bad import.

## A larger problem underneath

While adding those fields, a more serious gap surfaced: **`seoTitle` and `seoDescription` were stored but never rendered.**

The published `<head>` was built only from site-level settings — `metaTitle` and `metaDescription` — falling back to the page title. Per-row SEO values were saved by the editor, returned by the API, and then ignored by the publisher entirely.

For a collection, that means every entry shared one site-wide title and description. Filling in per-post SEO would have changed nothing in the output.

So this was not simply "add three fields". The renderer had to start reading row-level SEO at all.

## What changed

**New fields**, added to `pages` and `posts`:

| Field | Type | Purpose |
|---|---|---|
| `canonicalUrl` | url | The indexed form of the URL |
| `ogTitle` | text | Social card title |
| `ogDescription` | longText | Social card description |
| `ogImage` | media | Social card image |
| `jsonLd` | longText | Structured data |

**The head builder now resolves SEO per document**, in this order: an explicit value passed by the caller, then the row's own cells, then site settings. For a collection entry the row's cells arrive on the render context, so each entry gets its own tags without any caller change.

It emits `<title>`, `<meta name="description">`, `<link rel="canonical">`, the `og:` set, and a JSON-LD script block — each only when a value exists.

Three deliberate choices:

- **Open Graph falls back** to the page title and description rather than being omitted. A share card with no title is worse than a duplicated one.
- **`ogImage` falls back to the featured image** when not set explicitly. The loop source already resolves it to a public URL, and it is almost always the right picture.
- **A document with no SEO of its own emits nothing new.** Pages that never opted in keep exactly the head they had before.

JSON-LD is authored content, so `<` is escaped inside the script block — a stored `</script>` would otherwise close the tag and turn data into live markup.

## Why this is core rather than a plugin

A plugin cannot do it. The `publish.html` filter receives only `{ siteId, pageId, slug }` — it cannot identify which row it is rendering or what the real URL is. Per-entry canonical and Open Graph are not expressible through that surface at all. The head builder is the only place the information exists.

## Taxonomy

`relation` and `multiSelect` are both supported field types, and tables can be created through the connector, so taxonomy is buildable rather than blocked:

```
connector_create_table   name: "Tags", slug: "tags", kind: "data"
connector_add_table_fields
  tableId: "posts"
  fields:  [{ id: "tags", type: "relation", label: "Tags" }]
```

`kind: "data"` is deliberate for a taxonomy — unrouted, so tags do not get their own public URLs unless that is wanted. Use `postType` only if tag archive pages are needed, and then it needs its own entry template.

## Applying it

```
connector_step_up                                  # schema changes need this
connector_add_seo_fields   tableId: "pages"
connector_add_seo_fields   tableId: "posts"
```

Field changes are additive. Existing fields are read and merged rather than replaced — the underlying update overwrites the field array wholesale, so sending only the new fields would drop any custom field added earlier. Built-ins are protected by the server and cannot be removed.

After adding them, populate in bulk and confirm the tags reach the served HTML. Storing without rendering was the original failure here, so it is the thing worth testing for.
