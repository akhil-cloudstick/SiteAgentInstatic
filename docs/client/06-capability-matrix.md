# Capability matrix

Every tool, what it touches, and whether it can be undone.

**Reversible** means the content survives and the action can be walked back. **Not reversible** means content is destroyed or made public with no version to return to.

## Read — writes nothing

| Tool | Returns |
|---|---|
| `connector_target` | Configured sites and which have an open session |
| `connector_environment` | Runtime version and available building blocks |
| `connector_doctor` | Conversion-engine health against a fixture |
| `connector_list_tables` | Content types with field definitions |
| `connector_get_table` | One table in full |
| `connector_list_rows` | Rows, paginated; summaries by default |
| `connector_get_row` | One row with all field values |
| `connector_list_media` | Media library |
| `connector_list_templates` | Templates and what each targets |
| `connector_publish_status` | Whether the draft differs from what is live |
| `connector_preview_import` | What an import would change |
| `connector_export_bundle` | Writes an archive to disk |
| `connector_export_manifest` | Bundle manifest as JSON |
| `connector_hash_rows` | Content fingerprints |
| `connector_verify_approval` | Checks a sign-off against current state |

## Session

| Tool | Effect |
|---|---|
| `connector_connect` | Opens a session against one site |
| `connector_disconnect` | Drops one or all sessions |
| `connector_step_up` | Elevates for destructive or schema work |

## Write — reversible

| Tool | Effect | How to undo |
|---|---|---|
| `connector_create_row` | Creates a draft | Delete it |
| `connector_update_row` | Edits a draft | Edit again; a published page keeps showing the old version until republished |
| `connector_set_row_status` | Draft ⇄ unpublished | Set it back |
| `connector_create_table` | New collection or data table | Delete the table |
| `connector_add_table_fields` | Adds fields | Fields are additive; built-ins are protected |
| `connector_add_seo_fields` | Adds the SEO set | As above |
| `connector_create_entry_template` | Creates a template page | Delete or unpublish it |
| `connector_upload_media` | Adds a file | Delete the asset |
| `connector_import_draft` | Adds or updates rows as drafts | Nothing goes public until published |
| `connector_import_archive` | Same, from a ZIP | As above |

Everything here lands as **draft**. Nothing in this section changes what the public sees.

## Write — NOT reversible

| Tool | Effect | Guard |
|---|---|---|
| `connector_publish_row` | Live immediately | — |
| `connector_publish_site` | Publishes everything, and can trigger a public deploy | Requires step-up |
| `connector_delete_row` | Destroys a row | — |
| `connector_delete_rows` | Destroys many | `confirm: "DELETE <count> FROM <target>"` |
| `connector_import_replace` | Deletes the entire site, then imports | `confirm: "REPLACE <target>"` + dry run first |

**Publishing has no version rollback.** Unpublishing retracts the route; it does not restore earlier content. And a full-site publish can reach the public internet — see `04-publishing-and-deploys.md`.

**Deletion has no trash.** To take a page off the site while keeping it, use `connector_set_row_status` with `unpublished`.

## Not available

| Capability | Why |
|---|---|
| Redirect management | No HTTP route exists. Redirects travel inside a `replace` bundle, or are handled at the edge |
| Bulk site generation from HTML | The converter that produces a bundle from an existing website is not built |

## Working across sites

Two sites are configured. Every tool takes a `target`, and **with more than one configured, a call that omits it is refused rather than guessed** — the check that stops content landing in the wrong site.

## Audit

Every call, including refusals, is logged with time, caller, tool, outcome and duration:

```
2026-08-27 12:31:23  1a145a  content  list_rows     ok      0.0s  rows=12
2026-08-27 12:43:00  1a145a  DELETE   delete_row    FAILED  0.0s  Not connected to "akhil"
```

`REPLACE`, `PUBLISH` and `DELETE` are uppercase so every irreversible action can be found with a single grep.
