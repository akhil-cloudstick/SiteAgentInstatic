# Unsafe HTML from an anonymous visitor — acceptance run (security class E8)

Run by someone other than the builder, against a running tenant. Each case gives
the request, the response, and the verdict that makes it a pass. Anything else is
a failure to report rather than a thing to work around.

---

## What this class actually turns on

Worth reading before the first curl, because it decides which of the steps below
matter most.

**The store is raw, by design.** A public form submission is written to the
database exactly as it was typed — `forms/handler.ts` hands the validated cells
straight to `createDataRow`, and nothing on that path sanitises. This is
deliberate: the original submission survives for a human to read. It means the
render-time sanitiser is not defence in depth, it **is** the defence, and step 2
below is where the class is won or lost.

**There are two layers, and the second one is a meta tag.** Published pages carry
`<meta http-equiv="Content-Security-Policy" … script-src 'none'>`. They do *not*
carry a CSP response header — `securityHeaders.ts` sends that for `/admin` only —
so checking headers alone will tell you a public page is unprotected. It is not.
Check the document.

**One defect was found here already, by writing the tests for it.** One pass of
the sanitiser removed only the *first* disallowed element among a run of
siblings: `<img onerror><img onerror><img onerror>` came back with two of the
three intact, handlers and all. Both sanitisers now loop to a fixpoint. Step 2's
payload is deliberately a RUN of elements rather than a single one, because a
single one passed throughout.

---

## Setup

Run from any shell with `curl` and `jq`. Substitute the tenant's public origin.

```sh
SITE=https://<tenant>.example            # the published site, not the admin
FORM_PAGE=/                              # a published page carrying a CMS form
```

**Before starting, confirm all three.** A missing one makes a later step fail for
the wrong reason:

1. The tenant has a published page with a `base.form` in `cms` mode, pointed at a
   non-system `data` table. That is the only kind of table a stranger can write
   into (`isFormSubmissionTargetTable`), so there is no other ingress to test.
2. A second published page displays those rows — a `base.loop` over `data.rows`
   filtered to that table. Without it nothing renders the submission and step 2
   has nothing to read.
3. Use a throwaway tenant or a table you are willing to leave rows in. **The rows
   this run writes are real rows.** Deleting them afterwards is step 5.

---

## 1. Submit the payload as an anonymous stranger

No session, no cookie, no admin. The form requires a challenge first, and the
challenge requires the page token that the publisher embedded in the page — so
read it from the page source rather than inventing one.

```sh
# The page token and form id are in the published HTML.
curl -s "$SITE$FORM_PAGE" | grep -o 'data-instatic-form-token="[^"]*"'
curl -s "$SITE$FORM_PAGE" | grep -o 'data-instatic-form-id="[^"]*"'
```

Request — the challenge:

```http
POST /_instatic/form/challenge
content-type: application/json
origin: https://<tenant>.example
sec-fetch-site: same-origin

{ "formId": "<form id>", "pageId": "<page id>", "pageToken": "<token from the page>" }
```

Response:

```http
HTTP 200

{ "token": "…", "challenge": "…" }
```

Request — the submission. The message field carries **four vectors and a run of
them**, which is the shape that found the defect:

```http
POST /_instatic/form/submit
content-type: application/json
origin: https://<tenant>.example
sec-fetch-site: same-origin

{
  "formId": "<form id>",
  "pageId": "<page id>",
  "token": "<from the challenge>",
  "challenge": "<from the challenge>",
  "values": {
    "email": "stranger@example.test",
    "message": "Loved the new site <script>alert(1)</script><img src=a onerror=alert(1)><img src=b onerror=alert(2)><svg onload=alert(1)></svg>",
    "link": "javascript:alert(1)"
  }
}
```

Response:

```http
HTTP 200

{ "ok": true, "rowId": "…" }
```

**Verdict: accepted is the PASS.** This is not a refusal test. The submission is
supposed to be stored; the platform's promise is about what it serves, not about
guessing which visitors are hostile. A `400` here means the form's own field
validation rejected it — check the field types and try again, because a refusal
at this step means step 2 never ran.

**Then confirm it was stored RAW.** In the admin Data grid, open the row. The
cell must read back exactly what was sent, angle brackets and all. If it has been
stripped or escaped at rest, say so — it is not the documented behaviour, and it
would mean step 2 is testing a different string than the one an attacker
controls.

## 2. Fetch the page that displays it, and read the bytes

The whole class comes down to this response body.

```sh
curl -s "$SITE/<the page with the loop>" > /tmp/e8.html
```

Now four checks on that file. Run all four: they fail independently.

```sh
# a. No script element with a body.
grep -o '<script[^>]*>[^<]\+' /tmp/e8.html

# b. No inline event handler on any element. This is the one the defect hit.
grep -oE '<[a-zA-Z][^>]*\son[a-z]+\s*=' /tmp/e8.html

# c. No javascript: URL in anything that navigates or loads.
grep -oiE '(href|src)\s*=\s*"?\s*(javascript|vbscript):' /tmp/e8.html

# d. The payload ARRIVED and was defanged, rather than the page coming back empty.
grep -c 'Loved the new site' /tmp/e8.html
grep -c '&lt;script&gt;' /tmp/e8.html
```

**Verdict:**

| Check | Pass |
|---|---|
| a | no output |
| b | **no output** |
| c | no output |
| d | both counts ≥ 1 |

Check (d) is not a formality. Without it, a page that failed to render at all
passes (a), (b) and (c) perfectly — which is how a test of this kind quietly
stops testing anything.

And note what a pass looks like in the body: the escaped text
`&lt;img src=a onerror=alert(1)&gt;` **is a pass**. That is the stranger's words
rendered as words. What must not appear is `<img src="a" onerror="alert(1)">` as
markup. Check (b) draws exactly that line; a plain `grep onerror` does not, and
will report the safe result as a failure.

**Check the anchor too.** The `javascript:` URL was bound to a link. In the served
page that link must read `href="#"` — inert, not absent. `isSafeUrl` substitutes
rather than drops, so the link still renders and goes nowhere.

## 3. Confirm the second layer is present

```sh
grep -o 'http-equiv="Content-Security-Policy"[^>]*' /tmp/e8.html
```

Expect a policy containing **`script-src 'none'`**.

**Verdict:** present and containing `script-src 'none'` with no `unsafe-inline`.

This is what kept the sanitiser defect from being an incident rather than a bug,
so its absence changes the severity of everything above. Checking the response
*headers* for a CSP instead will show nothing and mean nothing — the policy is in
the document.

## 4. Re-run against the baked page

Everything above may have been answered by the live renderer. In production a
published page is served from a pre-rendered file on disk, and that is what a real
visitor gets.

```sh
# Publish, then fetch again with a cache-busting query the renderer ignores.
curl -s "$SITE/<the page with the loop>" > /tmp/e8-baked.html
diff /tmp/e8.html /tmp/e8-baked.html
```

Re-run every check from step 2 against `/tmp/e8-baked.html`.

**Verdict:** identical results. A difference between the live and baked answers is
the finding — it would mean one of the two paths sanitises and the other does not,
and the baked one is the one visitors see.

## 5. Put the world back

1. Delete the submitted rows from the Data grid.
2. If a throwaway tenant was used, remove it.

Nothing else persists: this class writes rows, not receipts, and rows are
deletable.

---

## What this run does not cover

Stated so the gap is not mistaken for a pass.

- **The admin preview surfaces.** The Content workspace mounts an editor against
  the same content. This run covers the published page only.
- **Imported HTML.** A site imported through `importSiteHtml` reaches the
  publisher by a different door, with its own guard.
- **A post body, as opposed to a form submission.** The richtext outlet path — the
  one with no HTML escaping at all, where `sanitizeRichtext` is the only
  protection — is covered by the automated test
  (`src/__tests__/server/unsafeHtmlChain.test.ts`) rather than by this run,
  because there is no anonymous way to write a post body and pretending otherwise
  would be theatre.
