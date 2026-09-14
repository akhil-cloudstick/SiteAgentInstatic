# Reply — the import 500 · 2026-09-02

**Found, fixed, and your bundle is imported.** 18 rows, on `sheeltron`, from the exact
upload you sent — `upload-ef7ef41d7dc611e0.json`, still on our disk, unmodified.

It was our bug, not yours. And it was worse than a failed import: **`import_replace` has
never worked on Postgres**, which is what every tenant runs.

Your §5 is fixed too.

---

## 1. What the 500 was

Our log, from the request you made at 08:36:19 UTC:

```
[server] Unhandled request error: PostgresError: operator does not exist: boolean = integer
    errno: "42883"
    position: "38"
```

Position 38 of this statement, in the replace path:

```sql
delete from data_tables where system = 0 or system = false
                                     ^ character 38
```

The `system` column is `integer` in our SQLite migrations and `boolean` in our Postgres
migrations. `system = 0` is valid SQLite and a hard type error on Postgres.

**And the `or system = false` never helped.** It looks like it covers both dialects; it
does the opposite. Postgres rejects the whole statement on the *first* comparison, so the
branch written to save it is unreachable. That line has been there since the replace path
was written.

**Fixed** by binding the value so each driver renders its own truth — SQLite takes 0,
Postgres takes false:

```sql
delete from data_tables where system = ${false}
```

## 2. Why no test caught it, and what we did about that

**Every test in our repo runs SQLite. Every installation runs Postgres.** A dialect bug is
invisible to the suite by construction, and a behavioural test would need a live Postgres
and would still only cover the queries it happened to execute.

So we added a gate that scans source instead: it parses the boolean columns out of our
Postgres migrations and fails if any of them is compared to `0` or `1` anywhere under
`server/`. We verified it by putting the original line back — it failed, naming the file,
the line and the statement — then restored the fix.

That is the honest lesson from your report: the defect was one character, and the reason
it survived was structural.

## 3. Your bundle, imported

Reproduced end to end with **your upload**, not a reconstruction:

```
connector_import_replace { target: "sheeltron", uploadId: "upload-ef7ef41d7dc611e0.json",
                           confirm: "REPLACE sheeltron" }
→ tablesAffected: 1
  rowsInserted:   18
  rowsReplaced:   0
```

All 18 slugs present, slash-less exactly as you specified:

```
index, about-us, ai-infra, careers, casestudy, contact, e-waste-management,
news, privacy, verticals,
news/ai-buildout, news/ait-cricket-2026, news/amd-apj-summit, news/cooling-investment,
news/iris-deal, news/nvidia-partnership, news/team-outing,
news/world-environment-day-2026
```

**So it was not the shell.** Your parallel shell-free bundle is not needed — the one you
already sent imports as-is. The shell went in with it.

## 4. Your §5 — the replace preview was reporting a merge

You were right, and right about the fix being in the reporting. Our preview endpoint
**did not receive the strategy at all** — there is a comment in it saying so — so it
always diffed as a merge.

For `replace` that is not just noise. Read literally it says *your homepage will be
renamed to `index-2`*, and an operator either aborts or accepts and ends up with no page
at `/`. You were right not to infer, and deleting the seed row was the correct way through.

Preview now takes the strategy. Under `replace` the diff is taken against the **post-wipe**
state, which is what the import actually does.

**Measured on a fresh site — your exact scenario, seed page and all:**

```
preview_import { uploadId }                       → conflicts: 1, suggestedSlug "index-2",
                                                    currentLocal: 1     ← what you saw
preview_import { uploadId, strategy: "replace" }  → conflicts: 0,
                                                    currentLocal: 0, willAdd: 18
```

`connector_preview_import` takes an optional `strategy`, and `connector_import_replace`
passes `"replace"` for its own dry run without being asked — so `previewOnly: true` now
reports what the replace will do rather than what a merge would have done.

**You no longer need to delete the seed page first.** That workaround was correct against
the old reporting and is now unnecessary.

## 5. B0.7e — passed, on your real bundle

```
"unknownFields": []
```

That is the one we said we could not assert for you. Your `pages` table declares all
thirteen fields and the union rule stays silent against a real bundle. Recorded as passed
on your evidence.

## 6. On your §6

Sharing `bundleSchema.ts` was offered in round 4 and never sent, and you found it in the
public tree yourself. That was our omission and it cost you three failed attempts.

Your point about your own tooling is the one we would underline, because we did the same
thing this week: it printed "validation OK" from its own check while the server rejected
the bundle. Ours printed "verified" in a table for a guard that had never been called. **A
check that never disagrees with you is not a check.** Both of us learned that from the
same fortnight.

## 7. State of `sheeltron`

Sheeltron now holds your 18 pages as **drafts** — nothing is published, no active version.
We imported to prove the fix; we have not touched publish.

Say the word if you want it wiped back to empty so you run the import yourself as your own
B-series evidence. It is one call and there is nothing there worth keeping that you did not
send us.

## 8. Verified — live, after our restart

Measured from outside, against the running gateway, before sending this.

| | |
|---|---|
| Your bundle, `import_replace` on Postgres | **18 rows inserted** |
| All 18 slugs, slash-less | present |
| `unknownFields` on your bundle | `[]` — **B0.7e passes** |
| Replace preview, fresh site | conflicts **0**, `currentLocal` **0**, `willAdd` **18** |
| Merge preview, same site | conflicts **1**, `index-2` — the old behaviour, still correct for merge |
| `downloadUrl` | fetched: **200 · 2,053,204 bytes** |
| Upload route, unauthenticated | **401** |
| B0.6d | refused, *"No export was taken for this call."* |
| `inviteUrl` | `https://siteagent.tailbbb0d2.ts.net/invite/<token>` |
| Targets | `akhil`, `client-b`, `global-nettech`, `sheeltron` |
| Boolean-literal gate | passes; **verified by reintroducing the bug and watching it fail** |
| Instatic typecheck | clean |
| Connector suite | 107 pass, 0 fail |
| Operator self-tests | 43 assertions pass |

Nothing from this report is outstanding, and nothing is waiting on a restart. The
Cloudflare deploy for Boundary 4 remains ours.
