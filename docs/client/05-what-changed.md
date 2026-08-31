# What changed

Six fixes and a set of new capabilities. Three of the fixes were defects with causes that are not deducible from the symptom, so each says what was actually wrong.

## Reading a table no longer fails

**Symptom:** listing rows with `limit: 12` returned `MCP server session expired`. `limit: 1` worked. The session stayed connected afterwards, so it looked like a payload problem — which it was, but not for the reason it appeared.

**Cause:** the row-listing endpoint never read query parameters at all. `limit`, `offset` and `fields` were silently ignored, and the handler returned **every row in the table with its complete body tree**. A single page row is around 3.78 MB, so 398 pages is roughly 1.5 GB in one response.

Paging existed in the repository layer already — it was reachable from the plugin API but had never been wired to HTTP.

**Fix:** the endpoint now paginates, and takes a `fields=summary` projection that omits row bodies entirely. Paging alone would not have been enough; 25 full page rows is still ~94 MB.

```
before   limit: 12  →  session expired      (~26 MB)
after    limit: 12  →  5.5 KB in 0.37s      totalCount: 398
```

The connector defaults to summaries. Ask for `fields: "full"` when the body is genuinely needed.

## Export produces a file

It previously reported a byte count and discarded the response. There was nothing to open, diff or keep.

It now writes the archive to disk and returns the path, size and entry count. `connector_export_manifest` pulls the manifest JSON out and returns it directly, which is the part worth diffing.

**A second defect surfaced while testing this.** The export endpoint defaults `includeMedia` to **false**, while defaulting site, media folders and redirects to true. The first working export therefore produced an archive with correct table and row counts and **every image missing** — the worst kind of wrong for a snapshot, because it looks complete. Media is now requested explicitly:

```
content only   38 MB    1 entry
with media     57 MB    261 entries (260 media files)
```

## Clean-site import is available

`replace` is exposed, as a separate tool rather than a strategy value. A strategy enum would make the difference between "add these pages" and "delete the entire site first" a one-word edit in an argument.

`connector_import_replace` requires `confirm: "REPLACE <target>"` — the target is named in the phrase, so a confirmation copied from one context cannot authorise a wipe somewhere else. It runs a dry run first and returns the counts before applying.

`connector_import_archive` handles ZIP uploads. `replace` remains the only strategy that carries redirects and media folders.

## The collections checker was inverted

It keyed on each file's immediate parent directory. For the mandated nested layout `blog/<slug>/index.html`, that yields `<slug>` — a unique segment per post, count one each — so a correct build scored as "no collections" and printed WARN. The flat `blog/<slug>.html` layout, which the rule forbids, keyed on `blog` for every file and printed PASS.

The checker contradicted its own remedy text, which tells the author to use exactly the layout it was warning about.

**Fix:** it keys on the collection root — the grandparent for `index.html` entries — and excludes `<root>/index.html` listing pages so a collection cannot count itself.

| Layout | Before | After |
|---|---|---|
| `blog/<slug>/index.html` (required) | WARN | **PASS** |
| `blog/<slug>.html` (forbidden) | PASS | **WARN** |
| Small correct tree | *printed nothing* | PASS |
| Many flat top-level folders | WARN | WARN |

The third row was a separate bug: when neither branch fired, nothing printed at all, so anything looking for the PASS line saw a missing line rather than a result.

## Per-row SEO now renders

`seoTitle` and `seoDescription` were stored but never reached the published HTML — the head was built from site-level settings only. New canonical, Open Graph and JSON-LD fields were added, and the head builder now resolves SEO per document. Full detail in `03-seo-and-taxonomy.md`.

## Entry templates can be created

A routed collection without an entry template returns 404 for every entry. `connector_create_entry_template` builds one, and refuses to create a duplicate that would resolve ambiguously. Full detail in `02-entry-templates.md`.

## New capabilities

| Tool | Purpose |
|---|---|
| `connector_step_up` | Elevate for destructive or schema operations |
| `connector_delete_rows` | Bulk delete with a counted confirmation |
| `connector_upload_media` | Push files into the media library |
| `connector_list_media` | List media assets |
| `connector_get_table` | Read a table with its field definitions |
| `connector_create_table` | Create a collection or data table |
| `connector_add_table_fields` | Add custom fields, merging with existing |
| `connector_add_seo_fields` | Add the standard SEO set in one call |
| `connector_create_entry_template` | Create the template a collection needs |
| `connector_list_templates` | Show templates and their targets |
| `connector_import_archive` | ZIP import |
| `connector_import_replace` | Clean-site import |
| `connector_export_manifest` | Bundle manifest as JSON |

## One thing deliberately not built

**There is no redirect tool.** Instatic exposes no HTTP route for redirects — they exist only as a bundle category, carried by the `replace` strategy alone. A tool would have failed at call time rather than at design time, so redirects travel inside a bundle or are handled at the edge.

## Everything is logged

Every call, including every refusal, is written to an activity log with time, caller, tool, outcome and duration. The irreversible ones are tagged `REPLACE`, `PUBLISH` and `DELETE` so they can be found by grep alone. Details record shape rather than content — `rows=2`, never which rows — so the log never becomes its own disclosure.
