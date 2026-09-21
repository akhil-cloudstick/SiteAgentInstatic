# Deploy Relay

A ticket relay between three parties, replacing the owner as the courier:

| Role | Does | Never does |
|---|---|---|
| **Builder** | Opens tickets and deploy-requests, attaches artefacts, runs the import or publish after a GO | Grants GO |
| **Validator** | Validates claims against artefacts it holds, posts evidence, verifies live | Grants GO, imports, publishes |
| **Owner** | Signs, refuses or revokes GO; decides disputes | Carries files |

**What makes a GO a control and not a record:** the Connector's `connector_import_replace` and
`connector_publish_site` verify the owner's Ed25519 signature themselves before they run
(`Connector/src/go/`). The relay is hosted in the builder's Cloudflare account, so the builder
administers Access and could add identities — none of that lets anyone but the owner produce a
signature. The owner key's fingerprint is printed on every relay page, in every GO record in the
export, and in every gated Connector response, so a key swap is visible.

## How one deploy runs

1. **Builder** uploads the bundle: `PUT /api/artefacts` with `X-Content-Sha256`.
2. **Builder** opens a `deploy-request` naming `action` (`import` *or* `publish`), `target` and `sha256`.
3. **Validator** checks the artefact and posts an `evidence` message.
4. **Owner** signs on their own machine and pastes the GO into the ticket page:
   `bun cli/sign-go.ts sign --key <key file> --ticket DR-000001 --action import --target sheeltron --sha256 <hex>`
5. **Builder** moves the request to `executing` (this consumes the GO on the relay), fetches it with
   `GET /api/tickets/<id>/go`, and passes it as `go` to the Connector tool.
6. **Builder** moves to `verifying_live` with the `deployId`.
7. **Validator** moves to `done` or `failed`, citing confirming or refuting evidence.

Every deploy-class action is its own deploy-request with its own GO. What the GO's `sha256` names:

| `action` | Connector tool | `sha256` is | `contentDigest` is |
|---|---|---|---|
| `import` | `connector_import_replace` | the uploaded bundle's bytes | `-` |
| `merge-overwrite`, `merge-add` | `connector_import_archive` (that strategy) | the uploaded archive's bytes | `-` |
| `publish` | `connector_publish_site` | the bundle the last import under GO landed | the draft site hash |
| `publish-row` | `connector_publish_row`, `connector_publish_rows` | `connector_rows_digest` of exactly those rows | `-` |
| `set-status-draft`, `set-status-unpublished` | `connector_set_row_status` | `connector_rows_digest` of the row | `-` |
| `delete` | `connector_delete_row`, `connector_delete_rows` | `connector_rows_digest` of exactly those rows | `-` |

The signed string is `mms-go-v2|ticketId|action|target|sha256|contentDigest|expiresAt|nonce`.

For the bundle actions the relay must hold the artefact. A rows digest binds both which rows and
their content as they are when it is taken, so take it after the last edit and just before signing.
For a publish, `connector_site_digest` returns both values; the CMS re-checks the draft site hash
itself after flushing in-flight edits and refuses the publish (412) if it no longer matches.

## States

```
ticket          open → validating → confirmed | refuted | needs_info ; → disputed → (owner) confirmed | refuted
deploy-request  awaiting_go → go_granted → executing → verifying_live → done | failed
                awaiting_go → refused   go_granted → revoked | expired   verifying_live → disputed → (owner) done | failed
```

The full table, with who may make each move, is `src/state.ts`. Message text never changes state.

## API

Every `POST`/`PUT` needs an `Idempotency-Key` header. Same key + same body replays the stored
response; same key + different body is `409`.

| Method | Path | Who |
|---|---|---|
| `PUT` | `/api/artefacts` (header `X-Content-Sha256`) | anyone |
| `GET` | `/api/artefacts/<sha256>` | anyone (always a download) |
| `POST` | `/api/tickets` `{type, title, body?, artefacts?, action?, target?, sha256?}` | builder; validator for `ticket` |
| `GET` | `/api/tickets`, `/api/tickets/<id>` | anyone |
| `POST` | `/api/tickets/<id>/messages` `{kind, body?, evidence?, replyTo?, artefacts?}` | anyone; `evidence` and `reported-instruction` validator only |
| `POST` | `/api/tickets/<id>/transition` `{to, evidenceMessageId?, deployId?}` | per `src/state.ts` |
| `POST` | `/api/tickets/<id>/go` `{go}` | owner |
| `GET` | `/api/tickets/<id>/go` | anyone, while `go_granted` or `executing` |
| `GET` | `/api/export.jsonl` | anyone |
| `GET` | `/api/whoami` | anyone |
| `GET` | `/api/health` | **no login** — returns only `{live, version, ownerKeyFingerprint}` |

`live` is true only when Access and the roles are configured and an owner key is set. A status page
can poll `/api/health` and alert when `ownerKeyFingerprint` stops matching the owner's own record.

Evidence block: `{claim, prediction, artefacts: [sha256], commands: [..], output, verdict: confirmed|refuted|abstain, blindSpots}` — every field required.

## Deploy (from `S:\SiteAgentHub\Relay`)

The full step-by-step guide, with every dashboard click, is **`DEPLOY.md`**. In short:

1. `npx wrangler d1 create deploy-relay` — paste the `database_id` into `wrangler.toml`.
2. `npx wrangler r2 bucket create deploy-relay-artefacts`
3. `npx wrangler d1 migrations apply deploy-relay --remote`
4. Cloudflare Zero Trust → Access → Applications → self-hosted, on the relay's custom domain:
   - policy **Allow**: the owner's email and the builder emails;
   - policy **Service Auth**: a service token for the validator;
   - copy the application's **AUD tag**.

   Then a **second** self-hosted application for the same domain with path `api/health`, policy
   action **Bypass**, include **Everyone**. That is the only path without a login; the Worker itself
   answers nothing else without a valid Access assertion.
5. Fill `[vars]` in `wrangler.toml`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ROLE_OWNER_EMAIL`,
   `ROLE_BUILDER_EMAILS`, `ROLE_VALIDATOR_TOKEN_ID`, `PUBLIC_URL`, and `OWNER_PUBLIC_KEY` once the
   owner sends it. Optionally `ROLE_BUILDER_TOKEN_IDS`: service token IDs that act as the builder,
   for tooling that opens tickets and uploads artefacts without a browser.

   Do **not** set `PROPERTY_APPROVERS`. It used to hold a property → approver map; approvers now
   live in the registry (below) and that setting designates nobody, so the relay refuses to start
   while it is present rather than let anyone believe otherwise.
6. `npx wrangler secret put NOTIFY_WEBHOOK_URL`
7. `npx wrangler deploy`, then attach the custom domain to the Worker.
8. As each identity, `GET /api/whoami` must return the right role.

Any missing Access or role setting keeps the whole relay closed with a `503` naming it.

## Owner key

The owner runs, on their own machine (needs only bun):

```
bun cli/sign-go.ts keygen --out <a path outside any git repository>
```

It prints `ownerPublicKey` and `fingerprint`. The public key goes into `OWNER_PUBLIC_KEY` here and
into `S:\SiteAgentHub\Connector\go-policy.json` (template: `go-policy.example.json`). The private key
never leaves that machine; `keygen` refuses to write inside a git working tree.

## The approver registry

Which key approves a property is decided in one place, which both ends read (R6). `OWNER_PUBLIC_KEY`
above is the owner's own identity for display; it approves nothing by itself, and there is no
fallback — a property with no registered approver refuses every GO, deliberately.

Registering is an owner-only call:

```
POST /api/approvers        {"property":"sheeltron","level":"project","publicKey":"<base64>"}
POST /api/approvers        {"property":"acme-group","level":"business","covers":["sheeltron"],"publicKey":"<base64>"}
POST /api/approvers/sheeltron/retire
```

Re-registering a property **is** the rotation: the previous identity is retired in the same
transaction and stops being accepted immediately, while its row is kept so an old receipt can still
be explained. Retiring without a replacement leaves that property refusing every gated action —
that is the intended outcome, and the response says so.

One key may not be registered for two properties, and two business approvers may not both cover one
property; both are refused at registration.

`GET /api/approvers` needs no login (every field is a public key) and is what the Connector reads,
so the two sides cannot drift.

## Tests (from `S:\SiteAgentHub\Relay`)

```
bun test
```

`tests/acceptance.test.ts` is the partner plan's P1 list, one test per bullet. `ACCEPTANCE.md` is the
same list as curl commands, for the owner to run against the deployed relay.
`docs/relay/go-test-vectors.json` is read by both this suite and the Connector's, so the two GO
verifiers cannot drift.
