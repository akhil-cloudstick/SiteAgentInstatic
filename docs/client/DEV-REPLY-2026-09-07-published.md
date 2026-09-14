# Published — v5 is live and styled · 2026-09-07

Done, and the numbers held end to end.

```
publish     publishedPages 11 · draftMatchesPublished true · 15:37:55Z
deploy 31   live · 15:38:44Z · https://siteagent-sheeltron.pages.dev
```

## 1. The stylesheet, before and after

```
before   style-8d687127e124.css     1,531 bytes    18 rule blocks
after    style-0ba723028d39.css   161,177 bytes  ~574 rule blocks
```

New hash, so it is a genuine rebuild rather than a cache. And the number you asked us to keep
producing did what it is supposed to do: **we predicted 564 surviving rules from the
tree-shaker before authorising the import, and the deployed file carries ~574 blocks** — the
excess is `@keyframes` inner braces counting in a crude block count. The prediction held
through bundle → import → publish → deploy → served CSS.

That is the argument for surfacing the survivor count in the preview response, which we agree
with and will do. A number you can check *before* a publish, against a file you can check
after, is worth more than either alone.

## 2. Your §3(a), now confirmed from our side

The deploy fired **four seconds after the publish**, automatically, and finished 45 seconds
later. So the mechanism is exactly as described: a full publish triggers the deploy webhook, a
row publish does not. Your four minutes were not latency and no amount of waiting would have
helped.

We are treating your suggestion as the fix rather than a doc change: a **"published, not yet
deployed"** state visible in the admin. An editor should not have to know what a deploy is to
understand why their article is not on the web.

## 3. Your corrections to our §3 — taken, and ours was the looser count

You are right that it is 11 and not 13. `icon-tt` and `ehf-head` have no rule in either source
stylesheet, so they render here exactly as they render on the live site; calling them defects
was us reporting a difference we had not checked against the source.

Your v6 note also corrects the count in the other direction: the real gap was **17**, and we saw
13 because we only counted classes some node references. Ours is the right number for
"what will look wrong", yours for "what did the extraction miss". Both worth having, and we
should have said which question ours answered.

The linked-stylesheet blind spot is a good find, and the reason it hid is worth recording: the
homepage inlining the whole design system meant nine of eighteen pages contributing nothing
still looked like a mostly-working site.

## 4. What we built, and the one that concerns v6

All four of your asks are in, tested, and will ship with the next deploy of the platform.

**a. `unresolvedClasses` in the import preview** — node `classIds` matching no style rule,
counted and reported next to `unknownFields`.

**Built advisory, never blocking, exactly as your §2 asked.** Your `.reveal` case is in the
code comment as the reason, so nobody hardens it later without reading why:

> *A sender may reference a rule it chose not to ship: a class whose stylesheet was gated behind
> JavaScript that import strips would hide the node rather than style it, so dropping the rule
> and keeping the class is the correct call. Refusing the bundle would reject it for the one
> thing it got right.*

So v6 will report 6 unresolved `.reveal` references and import cleanly. You do not need a
declare-intentional-omissions mechanism, and we would rather not add one — a bundle that has to
list its exceptions ends up listing them by habit.

It also stays silent when a bundle carries no style registry at all, since otherwise every
style-free bundle would report every class as broken.

**b + c. The publish-version wipe is stated in both places** you asked for — in the preview
output as `destructiveEffects`, and in the `import_replace` description, including the part that
made it matter: recoverable by republishing, unless publishing needs another party to approve,
which is when it stops being a step and becomes an outage.

**d. The empty-array wipe is fixed** — `mediaFolders: []` and `redirects: []` no longer trigger
a wipe that restores nothing. That one was ours and it is closed before your media tranche
rather than during it, which is what we said we would do.

## 5. The js-gated CSS trap

Worth saying plainly: you found a defect whose fix would have been **worse than the bug**.
Ingesting those eleven rules correctly would have left most of the site's content permanently
invisible — strictly worse than unstyled, and it would have passed every check on both sides
because the CSS would have been *right*.

We strip `<script>` on import and had never considered that a stylesheet can depend on it. The
general form — a class hidden by default whose reveal never arrives — applies to any site whose
JS we strip, not just yours. That is ours to think about, and we would not have found it.

## 6. What we need for v6

Send us the artefact and we will run the tree-shaker and report the survivor count the way we
did for v4 and v5, before any import. We are not treating your note as authorisation for the
preview, the import or the publish — each gets its own, as you set out.

We will hold to `82979a4f…` being the only valid v6, given the emitter is not reproducible.

---

Expect the article chrome and hero sections to still look wrong in your screenshots. That is the
gap v6 closes and it is expected. The bar for this publish was "no design at all" → "mostly
right, some sections broken", and that is where it landed.
