# P1 acceptance — run by the owner, with curl

These are the partner plan's P1 acceptance checks, run against the deployed relay by the owner (or
Claude on the owner's behalf), not by the validator. Each check names its expected result; anything
else is a failure to report on the relay.

## Setup

```sh
RELAY=https://relay.example.com

# Owner identity (browser login once):
cloudflared access login "$RELAY"
owner() { cloudflared access curl "$@"; }

# Validator identity (the service token):
validator() { curl -H "CF-Access-Client-Id: $VALIDATOR_TOKEN_ID" -H "CF-Access-Client-Secret: $VALIDATOR_TOKEN_SECRET" "$@"; }

key() { echo "acceptance-$(date +%s%N)"; }
```

**Fixtures (builder).** Deploy-requests are opened by the builder only, so we open these before the
run and post their ids on the relay: `DR_A` (import, artefact `acceptance-A.txt`), `DR_B` (import,
artefact `acceptance-B.txt`), `DR_C` (import, for the double-consume check) and a plain ticket `T`.

```sh
printf 'acceptance-A' > acceptance-A.txt; SHA_A=$(sha256sum acceptance-A.txt | cut -d' ' -f1)
printf 'acceptance-B' > acceptance-B.txt; SHA_B=$(sha256sum acceptance-B.txt | cut -d' ' -f1)
DR_A=...; DR_B=...; DR_C=...; T=...
```

## 1. Upload → returned sha256 equals local sha256; a wrong hash is rejected

```sh
validator -s -X PUT "$RELAY/api/artefacts" -H "Idempotency-Key: $(key)" \
  -H "X-Content-Sha256: $SHA_A" --data-binary @acceptance-A.txt
```
Expect `200` or `201` and `"sha256": "$SHA_A"`.

```sh
printf 'changed' > changed.txt
validator -s -o /dev/null -w '%{http_code}\n' -X PUT "$RELAY/api/artefacts" -H "Idempotency-Key: $(key)" \
  -H "X-Content-Sha256: $SHA_A" --data-binary @changed.txt
validator -s -o /dev/null -w '%{http_code}\n' "$RELAY/api/artefacts/$(sha256sum changed.txt | cut -d' ' -f1)"
```
Expect `422`, then `404` (nothing was stored).

## 2. Illegal transition → 4xx

```sh
owner -s -w '\n%{http_code}\n' -X POST "$RELAY/api/tickets/$T/transition" \
  -H "Idempotency-Key: $(key)" -H 'content-type: application/json' -d '{"to":"go_granted"}'
```
Expect `409`. The same with `{"to":"confirmed"}` from `open` as the validator: `409`.

## 3. A GO signed for sha256:A does not satisfy a deploy-request for sha256:B

```sh
bun cli/sign-go.ts sign --key "$OWNER_KEY" --ticket "$DR_B" --action import --target acceptance --sha256 "$SHA_A" > go-wrong-sha.json
owner -s -w '\n%{http_code}\n' -X POST "$RELAY/api/tickets/$DR_B/go" -H "Idempotency-Key: $(key)" \
  -H 'content-type: application/json' -d "{\"go\": $(cat go-wrong-sha.json)}"
```
Expect `422` with `"mismatched": ["sha256"]`.

## 4. An unsigned or wrongly signed GO is rejected

```sh
bun cli/sign-go.ts sign --key "$OWNER_KEY" --ticket "$DR_B" --action import --target acceptance --sha256 "$SHA_B" > go-b.json
# unsigned: drop the signature field
jq 'del(.signature)' go-b.json > go-unsigned.json
# wrongly signed: a throwaway key
bun cli/sign-go.ts keygen --out /tmp/throwaway.pem > /dev/null
bun cli/sign-go.ts sign --key /tmp/throwaway.pem --ticket "$DR_B" --action import --target acceptance --sha256 "$SHA_B" > go-other-key.json
```
POST each to `/api/tickets/$DR_B/go` as in 3. Expect `422` both times, the second saying the
signature does not verify.

## 5. A GO past expires_at is rejected

```sh
bun cli/sign-go.ts sign --key "$OWNER_KEY" --ticket "$DR_B" --action import --target acceptance --sha256 "$SHA_B" --ttl 1m > go-short.json
sleep 70
```
POST it. Expect `422`, "expired".

## 6. A GO cannot be consumed twice (executing → failed → executing refuses)

Grant a valid GO on `DR_C` (expect `200`). The builder then moves it `executing` → `failed` →
`executing` while you watch the export; the last move must be `409`. Confirm in
`GET /api/tickets/$DR_C`: state `failed`, `go.consumedAt` set.

## 7. A deploy-request's sha256 is immutable after awaiting_go

```sh
owner -s -o /dev/null -w '%{http_code}\n' -X PATCH "$RELAY/api/tickets/$DR_A" -H "Idempotency-Key: $(key)" \
  -H 'content-type: application/json' -d "{\"sha256\": \"$SHA_B\"}"
owner -s "$RELAY/api/tickets/$DR_A" | jq -r .ticket.sha256
```
Expect `405`, then `$SHA_A` unchanged. There is no route that edits a ticket.

## 8. The export, re-read by your code, reproduces every ticket and message

```sh
validator -s "$RELAY/api/export.jsonl" > export.jsonl
```
Rebuild tickets and messages from `export.jsonl` with your own code, and compare with
`GET /api/tickets` and `GET /api/tickets/<id>` for every id. Lines are ordered by `seq`; ticket
state is `initialState` advanced by `transition` lines; `flag` lines set `validatorStalled`.
Our reference rebuild is `replayExport` in `src/export.ts` — a cross-check, not a substitute.

## 9. The validator service token can read and comment but cannot grant GO

```sh
validator -s -o /dev/null -w '%{http_code}\n' "$RELAY/api/tickets"
validator -s -o /dev/null -w '%{http_code}\n' -X POST "$RELAY/api/tickets/$DR_A/messages" -H "Idempotency-Key: $(key)" \
  -H 'content-type: application/json' -d '{"kind":"comment","body":"acceptance check 9"}'
validator -s -o /dev/null -w '%{http_code}\n' -X POST "$RELAY/api/tickets/$DR_A/go" -H "Idempotency-Key: $(key)" \
  -H 'content-type: application/json' -d "{\"go\": $(cat go-b.json)}"
```
Expect `200`, `201`, `403`.

## 10. The Connector enforces the same GO (through your MCP token)

Against a gated target, each of `connector_import_replace`, `connector_import_archive`,
`connector_publish_site`, `connector_publish_row`, `connector_set_row_status`,
`connector_delete_row`, `connector_delete_rows` and `connector_publish_rows` must refuse with no
`go`, before any CMS call.

- With a GO for other bytes (imports) or other rows (row actions), it must refuse without writing.
- With a GO for a different action (`merge-add` on `merge-overwrite`, `set-status-draft` on
  unpublish), it must refuse.
- For a row action, take `connector_rows_digest`, sign it, edit the row, then call: it must refuse.
- For a site publish, take `connector_site_digest`, sign both values, edit the draft, then call:
  it must refuse. A publish whose draft changes while the CMS is publishing must fail with 412.
- With the right GO it must run once, and refuse the same GO again.

Against `sheeltron-staging` every one of them must behave **exactly as above** — staging is gated
like production. It used to be exempt; the exemption was removed because "a staging project
exempted from the approval gate proves nothing" (PRD 5.4), and a rehearsal that starts there has
to exercise the real loop. Each gated response carries `go.ownerKeyFingerprint`, which must equal
the fingerprint registered for that property in the approver registry (`GET /api/approvers`).
