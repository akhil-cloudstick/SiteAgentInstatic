# Failed deployment and rollback — acceptance run (security class E10)

Run by someone other than the builder, against a running control plane. Each
step names what must happen; anything else is a failure to report rather than a
thing to work around.

The code's own self-test (`control-plane/deployer/rollback.selftest.mjs`) already
proves the decisions: that only a **verified** deploy is retained, that
`unverified` does not qualify either, that the newest generation is chosen by
default and a named one is honoured, that an empty ring refuses and says why, and
that the ring keeps exactly three generations. Its header says plainly what it
cannot reach — "the full `rollbackTenant` needs a database, Cloudflare
credentials and a real wrangler". **This run is that residue.** Nothing below is
covered by any test.

---

## What this does, stated first

**Every receipt this run writes is permanent.** `deploy_receipts` is append-only,
enforced by database triggers, so the deliberately-failed deploy in step 2 leaves
a receipt in the proof chain **forever**, with no way to remove it. That is the
property E9 exists to guarantee and it applies to this run too.

So: **use a throwaway project**, not a client's. One created for this and deleted
afterwards. The run publishes real bytes to a real Cloudflare Pages project and
briefly leaves a site serving the wrong thing on purpose.

It also does **not** roll back content. A rollback restores what the **site
serves**, not what the next publish would push — the CMS database still holds the
content that failed. That is a known gap (R15), and step 6 says what to do about
it.

---

## Setup

Run from `S:\SiteAgentHub\Operator`.

```sh
CP=http://127.0.0.1:4400
SLUG=zz-e10-acceptance        # a throwaway project, not a client's

# Sign in. The session comes back in the BODY, not a Set-Cookie header.
SESSION=$(curl -s -X POST "$CP/api/admin/login" \
  -H 'content-type: application/json' \
  -d '{"email":"<admin email>","password":"<password>"}' | jq -r .session)

cp() { curl -s -b "sa_admin=$SESSION" "$@"; }
```

**Before starting, confirm all four.** Any missing one makes a later step fail
for the wrong reason:

```sh
cp "$CP/api/tenants" | jq -r '.tenants[] | select(.slug=="'"$SLUG"'") | .slug'
```

1. The project exists and is **not** a client site.
2. `npm run migrate` has been applied — the `kind` and `restored_from_receipt_id`
   columns are `add column if not exists`, so an un-migrated database silently
   lacks them and every receipt write logs `RECEIPT NOT WRITTEN` instead.
3. A Cloudflare API token and account id are saved in Settings, or the rollback
   throws before it starts.
4. If the project has a custom domain, `search_indexing` must be true — a
   rollback onto an indexed custom domain is refused by design.

---

## 1. A verified deploy, so there is something to roll back to

```sh
cp -X POST "$CP/api/tenants/$SLUG/deploy" | jq '{ok, verification}'
```

Expect `{ "ok": true, "verification": "verified" }`. **Only a verified deploy is
retained**, so an `unverified` result here means the rest of the run has nothing
to work with — fix that before continuing rather than proceeding.

```sh
cp "$CP/api/tenants/$SLUG/known-good"  | jq '.generations[0]'
cp "$CP/api/tenants/$SLUG/receipts?limit=5" | jq '.receipts[0] | {id, kind, verification, known_good_path}'
```

Expect a new generation, and a receipt with `kind: "publish"`,
`verification: "verified"`, and `known_good_path` equal to that generation's
path. **Write down the receipt `id`** — step 4 checks it is referenced by name.

Repeat this step twice more if you also want to see the three-generation cap and
the eviction of the oldest.

## 2. Fail a deploy on purpose, and confirm a receipt is still written

This is the step the class exists for, and it has **two distinct forms that
produce different receipts**. Run both.

### 2a. The upload fails

Make `wrangler pages deploy` fail — the controllable levers are an invalid
Cloudflare API token in Settings, or a `cf_project` name that does not belong to
the account.

```sh
cp -X POST "$CP/api/tenants/$SLUG/deploy" | jq '{ok, error}'
cp "$CP/api/tenants/$SLUG/receipts?limit=5" | jq '.receipts[0] | {kind, verification, deploy_url, known_good_path}'
```

Expect `ok: false`, and a receipt with `verification: "failed"`,
`deploy_url: null` and `known_good_path: null`. **A failed deploy that writes no
receipt at all is the defect this class already found once** — the absence of a
row is a failure of the run.

### 2b. The upload succeeds and the site does not serve it

Point the project at a Pages project or custom domain that serves different
content, then deploy.

```sh
cp -X POST "$CP/api/tenants/$SLUG/deploy" | jq '{ok, error, url}'
cp "$CP/api/tenants/$SLUG/receipts?limit=5" | jq '.receipts[0] | {verification, routes_checked, routes_failed, deploy_url}'
```

Expect `verification: "failed"` with a **non-null** `deploy_url` and non-zero
`routes_checked` / `routes_failed` — the difference from 2a, and the reason both
are worth running.

### 2c. The ring is untouched by either

```sh
cp "$CP/api/tenants/$SLUG/known-good" | jq '.generations | length'
```

Expect the same count as after step 1. **Run the failing deploy three times and
check again**: three bad deploys must not evict the good generation. That was a
real defect — a bundle that failed verification was once filed as known-good, so
the ring a rollback reads from could be emptied by exactly the failure a rollback
exists to recover from.

## 3. Roll back

```sh
cp -X POST "$CP/api/tenants/$SLUG/rollback" -H 'content-type: application/json' -d '{}' \
  | jq '{ok, verification, restoredFrom, restoredFromReceiptId, receipt}'
```

Expect `ok: true`, a **freshly measured** `verification`, and `receipt` naming a
real id. **`receipt: "NOT WRITTEN"` is a failure of the run, not a pass** — it
means the rollback happened and left no proof.

Then the two refusals, which cost nothing to check:

```sh
# A generation that does not exist
cp -X POST "$CP/api/tenants/$SLUG/rollback" -H 'content-type: application/json' \
  -d '{"to":"1999-01-01T00-00-00-000Z"}' | jq -r '.error // .message'

# A project whose ring is empty
cp -X POST "$CP/api/tenants/zz-never-deployed/rollback" -H 'content-type: application/json' -d '{}' \
  | jq -r '.error // .message'
```

Expect the first to name what IS available, and the second to say "Only a deploy
that verified is kept, so there is nothing known-good to roll back to." A refusal
that silently defaults to the newest generation instead of refusing is a failure.

## 4. Read the rollback receipt

```sh
cp "$CP/api/tenants/$SLUG/receipts?limit=5" \
  | jq '.receipts[0] | {kind, restored_from_receipt_id, previous_receipt_id, known_good_path, verification, content_hash}'
```

Five things must hold:

| Field | Expected |
|---|---|
| `kind` | `"rollback"` |
| `restored_from_receipt_id` | the **step 1** receipt id you wrote down |
| `previous_receipt_id` | the **step 2** failed receipt — time order, not provenance |
| `known_good_path` | the restored generation's path |
| `verification` | measured fresh, never copied from the receipt being restored |

The last two rows are the ones worth dwelling on. `restored_from_receipt_id` and
`previous_receipt_id` are deliberately separate: one says which generation was
put back, the other says what came immediately before in time. If they are equal
here, something has merged them and the provenance is lost.

And a rollback that did not actually restore the site **must** read `failed`. A
`verification` copied from the older receipt would make every rollback look
successful by construction.

## 5. The invariants

```sh
cp "$CP/api/tenants/$SLUG/known-good" | jq '.generations | length'
curl -s "$(cp "$CP/api/tenants" | jq -r '.tenants[]|select(.slug=="'"$SLUG"'")|.pages_url')" | head -c 400
cp "$CP/api/audit?tenant=$SLUG&limit=5" | jq '.events[0] | {action, detail}'
```

1. **The ring is unchanged** — a rollback deliberately retains nothing. Rolling
   back to a bundle does not make it "newly good".
2. **The site serves the restored content**, checked by fetching it yourself
   rather than believing the platform's own verdict.
3. **The audit carries `tenant.rollback`** with `detail.restoredFrom`.
4. **No `rollback-<timestamp>` directory is left** under the project's published
   folder — the staging copy is removed on both the success and failure paths.
5. **The retained bundle is byte-identical** — it is copied, never moved.

## 6. Put the world back

1. Restore the real Cloudflare token if step 2a revoked it.
2. Re-deploy so the project serves current content:
   `cp -X POST "$CP/api/tenants/$SLUG/deploy"`.
3. Delete the throwaway project.

**What you cannot put back:** the receipts. Every row this run wrote is permanent
by design, including the deliberately-failed ones. That is the correct behaviour
and the reason this run uses a throwaway project.

**And note what a rollback did not do:** the CMS database still holds the content
that failed. The next publish will push the same thing again. Rolling back the
site and rolling back the content are different operations, and only the first
exists today.
