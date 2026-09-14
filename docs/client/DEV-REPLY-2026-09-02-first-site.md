# Reply — round 13 · 2026-09-02

Congratulations on Sheeltron. Eighteen pages, 108 SEO fields, 0 mismatches, and you
checked it against the live site rather than against the import's own report — which is
the only check that would have caught what you were actually worried about.

Your §2 is answered below with evidence, and the answer is "your cache", but **the fix is
still ours** and it is shipped. Detail in §1.

---

## 1. §2 — the schemas are published. Your cached copy is not.

You said you could not tell from your side. We can, so here is the raw `tools/list` from
the running server:

```
connector_preview_import
   properties: target, bundle, uploadId, path, strategy
   required  : (none — `bundle` is not required)

connector_import_replace
   properties: target, bundle, uploadId, path, confirm, previewOnly
   required  : confirm

connector_import_archive
   properties: target, uploadId, path, strategy
```

Everything you asked for is already advertised, including `bundle` no longer being
required — which is what would otherwise reject an `uploadId`-only call before it reached
the handler. Reconnecting the client will pick it up.

**That is not a satisfying answer, and your reasoning is why.** "Reconnect" assumes
someone knows to. An agent reading a stale schema does not conclude its copy is old; it
concludes the parameter does not exist, and falls back to inlining — 1.7 MB for Sheeltron,
~40 MB for Global Nettech. The wall we started at. Telling you to refetch fixes today and
nothing else.

**So `connector_environment` now reports a tool-surface revision.** Live, right now:

```json
"toolSurface": {
  "count": 34,
  "revision": "63c7ce630a4d",
  "note": "Changes whenever any tool name or input schema changes.
           Record it with your cached tools/list; a different value here means refetch."
}
```

If your cached list does not have 34 tools, or you recorded a different revision, that is
your answer without having to diff anything.

Record it beside your cached list; compare it at the start of a session. Nothing to hash
your side, no algorithm to agree on — just *is this the same string I saw when I cached?*
It covers input schemas, not only names, because the failure you hit was a schema gaining
properties while its name stayed put. Reordering tools does not move it, so you are not
told to refetch for nothing.

Pinned by tests, including the one that matters: **the revision must change when a tool
gains a property.** A marker that never moves is worse than none — it reads as proof of
freshness.

We also pinned the schemas themselves, so `uploadId` and `strategy` cannot quietly
disappear from those three tools again.

**Live now** — restarted and verified from outside before sending this. Nothing in this
reply is pending on our side.

## 2. On how you verified

Two things we want to name, because they are the reason this landed today.

**You checked the replace preview by contrast.** Same bundle, same site, one parameter
apart — merge 18/18/0 against replace 0/0/18. A single clean reading would have proved
nothing, and we would have accepted it. We reproduced the same divergence here, and on a
*fresh* site your original conflict reappears on the merge path and vanishes on replace:

```
preview_import { uploadId }                       → conflicts 1, suggestedSlug "index-2"
preview_import { uploadId, strategy: "replace" }  → conflicts 0, willAdd 18
```

**You ran the Postgres fix against a site that already held rows.** That is the part we
would have got wrong: on an empty target the `delete from data_tables` statement barely
matters, and a pass would have meant nothing. Exercising the statement that was broken is
the whole test.

**And you compared against the live site, not the import's report.** *"18 rows inserted"
was true on every attempt while the rows were wrong inside"* is the sharpest sentence in
your letter. It is the same failure as our verified-state table and your `validation OK`:
a report describing the request rather than the result.

## 3. Your §3

Not our business to grade, but two are worth noting because they change what we would
watch for on Global Nettech:

**`styleRules` as an array** would have imported a site with no styling and told nobody.
Our `parseStyleRuleRegistry` returning `{}` for an array is tolerant where it should be
loud — a shape it cannot read should fail, not silently produce an empty registry. We are
looking at that; it is our defect that your bug could have been invisible.

**The truncated `og:description`** is the one that would have shipped. 118 characters lost
on 7 of 18 pages, and nothing in our pipeline would have objected — we store what we are
given. Worth remembering when the 497-page site goes through: our import validates
structure, never plausibility.

You did not have to list any of these. That you did is why the next site will be faster.

## 4. Still ours

**The Cloudflare deploy for Boundary 4**, on `sheeltron`. Nothing else, and nothing is
waiting on you.

Understood that nothing is published and that publishing is your gate, not ours. We have
not touched it. Sheeltron holds your 18 pages as drafts exactly as they arrived — say the
word if you would rather we wipe it so the import is yours end to end, as your own
evidence rather than ours.

## 5.

Your closing is the right summary, and the symmetry is exact: your validator agreed with
you, our tests ran a different database from our installations. Both defects survived
because the thing checking was shaped like the thing being checked.

The one that is genuinely gone is `import_replace` on Postgres. It could not have been
found by reading code, and it took a real bundle from a real site to surface — which
means the three days of prerequisites were not a detour, they were the only route to it.
