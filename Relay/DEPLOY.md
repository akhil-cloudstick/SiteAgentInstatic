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

**1. Check the code (optional).**
```
bun test
```
Expect `37 pass, 0 fail`. `SHA256SUMS.txt` in this folder lists the hash of every file as we left it.

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

**11. Open only the health check.** Zero Trust → **Access** → **Applications** → **Add an
application** → **Self-hosted**. Domain: your `deploy-relay.<your-subdomain>.workers.dev`, path
`api/health`. One policy, action **Bypass**, include **Everyone**. Every other address keeps the
login.

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
