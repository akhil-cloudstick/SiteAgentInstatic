# Deploy the relay on your own Cloudflare account

Everything runs from this folder on the shared server:

```
S:\SiteAgentHub\Relay
```

It takes about 30 minutes. Your Cloudflare credentials stay with you: you log in, you deploy, and
you log out at the end.

**Already set in `wrangler.toml`, do not change:**
- `OWNER_PUBLIC_KEY` — your owner key, fingerprint `b24cc51f0c688fbb`
- `ROLE_BUILDER_EMAILS` — the builder's login
- the `[env.test]` section — a separate test copy; ignore it

**You need:** Node.js and bun (both installed on this server), and a Cloudflare account where you can
activate R2 and Zero Trust (both have free tiers; R2 asks for a payment method).

Run every command in PowerShell from `S:\SiteAgentHub\Relay`.

---

## Part 1 — check and deploy

**1. Check the code. Not optional — a mismatch means stop.**
```
npm run sums:check
bun test
```

`sums:check` verifies this folder against `SHA256SUMS.txt`, the manifest of every file as we left
it, and changes nothing. It must end `ok: N/N files match`. Anything else — `CHANGED`,
`MISSING FROM MANIFEST`, `GONE FROM FOLDER` — means the folder is not what was handed over: **do
not deploy, report it back**. It exits non-zero so it can gate a script.

This step used to be marked optional and named no command, and the manifest twice went stale
because nothing in the release path regenerated it. `npm run sums` writes it; that is the builder's
job before handover, and `sums:check` is yours before deploying.

`bun test` should end `0 fail`.

**2. Log in to your Cloudflare account.** A browser page opens; approve it.
```
npx wrangler login
npx wrangler whoami
```
`whoami` must show your own account. If it shows any other account, run `npx wrangler logout` and
log in again.

**3. Create the database.**
```
npx wrangler d1 create deploy-relay
```
Copy the `database_id` it prints into `wrangler.toml` at the top, under `[[d1_databases]]`,
replacing `REPLACE_WITH_ID_FROM_wrangler_d1_create`.

**4. Create the file storage.** Activate R2 first: dashboard → **R2 Object Storage** → activate.
```
npx wrangler r2 bucket create deploy-relay-artefacts
```

**5. Create the tables.**
```
npx wrangler d1 migrations apply deploy-relay --remote
```

**6. Deploy.**
```
npx wrangler deploy
```
It prints the relay address, `https://deploy-relay.<your-subdomain>.workers.dev`. Opening it now
shows **"The relay stays closed until it is configured"**. That is correct; Part 2 configures it.

## Part 2 — the login (Cloudflare dashboard)

**7. Zero Trust team.** Dashboard → **Zero Trust**. The first time, choose a team name (free plan).
Your team domain is `<team-name>.cloudflareaccess.com`.

**8. Put the login in front of the relay.** Dashboard → **Workers & Pages** → `deploy-relay` →
**Settings** → **Domains & Routes** → the `workers.dev` row → **Enable Cloudflare Access**.

**9. Two service tokens.** Zero Trust → **Access** → **Service Auth** → **Create Service Token**:
- `relay-validator` — for your validator. Keep its **Client ID** and **Client Secret** on your side.
- `relay-builder` — for the builder's tooling, which opens tickets and uploads artefacts. Send its
  **Client ID** and **Client Secret** to the builder privately.

Each secret is shown only once.

**10. Who may log in.** Zero Trust → **Access** → **Applications** → open the application created in
step 8:
- **Policy 1, action Allow:** include **Emails** — the owner's email and the builder email from
  `ROLE_BUILDER_EMAILS` in `wrangler.toml`.
- **Policy 2, action Service Auth:** include **Service Token** — `relay-validator` and `relay-builder`.
- **Overview:** copy the **Application Audience (AUD) Tag**.

**11. Open the one public read.** Zero Trust → **Access** → **Applications** → **Add an
application** → **Self-hosted**. Domain: your `deploy-relay.<your-subdomain>.workers.dev`, path
`api/health`. One policy, action **Bypass**, include **Everyone**. Every other address keeps the
login.

**One application, one Bypass policy. Do NOT add a second one for `api/approvers`.**

This step used to say to add one, and that was wrong in a way worth spelling out, because it would
have broken the deploy in a way that is hard to diagnose. An Access application matches its path
**and everything beneath it**. A Bypass on `api/approvers` therefore also covers
`POST /api/approvers` and `POST /api/approvers/<property>/retire` — and a Bypass stops Cloudflare
adding the `Cf-Access-Jwt-Assertion` header. The relay reads the owner's identity from that header
and from nowhere else (no cookie fallback), and the owner is the only party permitted to register an
approver. So that second policy would have left the registry readable by everyone and writable by
nobody, including the one person it is for.

The registry's public read is therefore served at **`api/health/approvers`**, underneath the prefix
this one Bypass already covers. Nothing is written beneath `api/health`, so opening that subtree
opens only reads: a POST there falls through to the login like any other route.

`GET /api/approvers` still answers as well, for a checker that has not been updated — but it is not
the published path and must not be given a policy of its own.

## Part 3 — configure and redeploy

**12. Fill in `wrangler.toml` → `[vars]`** at the top of the file (not `[env.test.vars]`):

| Setting | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team-name>.cloudflareaccess.com` (step 7) |
| `ACCESS_AUD` | the AUD tag (step 10) |
| `ROLE_OWNER_EMAIL` | the owner's email, replacing `owner-email-pending@relay.invalid` |
| `ROLE_VALIDATOR_TOKEN_ID` | the `relay-validator` Client ID (step 9) |
| `ROLE_BUILDER_TOKEN_IDS` | the `relay-builder` Client ID (step 9) |
| `PUBLIC_URL` | the relay address (step 6) |

Only Client IDs go in this file, never a Client Secret.

**13. Deploy again.**
```
npx wrangler deploy
```

**13a. Check what actually went live.** A deploy that succeeds is not the same as a deploy that
carried the change you meant, and the version field only tells you the truth if somebody remembered
to bump it — once, it was not bumped, and a whole requirement sat committed and undeployed for weeks
while `/api/health` reported the same number on both sides. So check a route instead of a number:

```
curl -s https://deploy-relay.<your-subdomain>.workers.dev/api/health
curl -s https://deploy-relay.<your-subdomain>.workers.dev/api/health/approvers
```

The first must report the `version` you just deployed, and its `approverRegistry` field names the
second URL. The second must return JSON with an `approvers` array — **not**
`{"error":"No such route."}` (the build predates the registry, step 13 did not take) and **not** an
HTML login page (the step 11 Bypass is missing, or was put on the wrong path). Run both from a
machine with no relay credential: that is the position the side checking approvals is in.

Then check the door that must STILL be closed:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://deploy-relay.<your-subdomain>.workers.dev/api/approvers
```

This must be **`302`** — Cloudflare Access redirecting an anonymous caller to the login, before the
request ever reaches the Worker. That is the correct, closed state.

**On THIS call — the one with no credential — a `403` is the alarm, not the pass.** It means the
request got PAST Access and reached the Worker, which then refused it for having no assertion header
— and the only way it gets past Access is if `api/approvers` has a Bypass policy on it. That is the
failure step 11 describes: the registry becomes readable by everyone and writable by nobody,
including the owner, whose browser identity lives in the very header the Bypass strips.

**Sent WITH a credential, `403` is the correct answer and the one to want.** Repeat the same POST as
the validator:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "CF-Access-Client-Id: <relay-validator Client ID>" -H "CF-Access-Client-Secret: <relay-validator Client Secret>" https://deploy-relay.<your-subdomain>.workers.dev/api/approvers
```

Access lets this one through — the token is in the Service Auth policy from step 10 — and the Worker
answers `403`, because registering an approver belongs to the owner alone. So the two `403`s mean
opposite things: **without a credential it means the door is open; with one it means the lock
works.** What separates them is only whether a credential was sent, which is why a result of "403"
is not a finding on its own — always record which of the two calls produced it.

A `302` on the credentialed call is a third answer and a different fault: it means Access is
**rejecting the service token** rather than admitting it, so the token is not in the Service Auth
policy from step 10, or its Client ID and Secret do not match. Nothing reached the Worker, so this
says nothing about the registry door — fix the policy and run the pair again.

| Call | `302` | `403` |
|---|---|---|
| No credential | correct, closed | **alarm** — `api/approvers` has a Bypass |
| `relay-validator` token | Access is rejecting the token | correct, the lock works |

(An earlier version of this step had the anonymous pair the wrong way round and told you `403` was
the pass there. It was corrected after testing the live relay: with no credential, closed really
does answer `302`.)

**14. Optional notifier.** To receive a webhook when tickets change or the validator stalls:
```
npx wrangler secret put NOTIFY_WEBHOOK_URL
```

## Part 4 — check

**15. Health, with no login:**
```
curl.exe https://deploy-relay.<your-subdomain>.workers.dev/api/health
```
Expect `"live": true` and `"ownerKeyFingerprint": "b24cc51f0c688fbb"`.

**16. Owner:** open the relay address in a browser and log in with the owner's email. The page header
shows **owner** and the key `b24cc51f0c688fbb`.

**17. Validator:**
```
curl.exe -H "CF-Access-Client-Id: <relay-validator Client ID>" -H "CF-Access-Client-Secret: <relay-validator Client Secret>" https://deploy-relay.<your-subdomain>.workers.dev/api/whoami
```
Expect `"role": "validator"`.

**18. Log out of Cloudflare on this shared server.**
```
npx wrangler logout
```

## Part 5 — tell the builder

Send:
- the relay address, and
- the `relay-builder` Client ID and Client Secret, privately.

The builder then confirms `whoami` for the builder role, creates `sheeltron-staging`, posts the
import-source snapshot, and sends you its ticket ID. After that, `ACCEPTANCE.md` is the check list
to run.

---

**If something fails:** the relay's own error messages name what is missing. A `503` lists every
setting that is not set yet; a `403` says which part of the login did not match. Send the message
text to the builder if it is not clear.
