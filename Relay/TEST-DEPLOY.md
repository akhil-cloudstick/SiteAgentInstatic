# Test deploy on your own Cloudflare account

A separate test copy of the relay: its own Worker (`deploy-relay-test`), database, file bucket and a
**test** owner key. It cannot touch the real relay, and it will never accept the real owner's GO.

**You need:** a Cloudflare account, Node.js (for `npx`), bun, and **two email addresses you can log
in with**. One plays the owner and one plays the builder; the relay refuses one email in both roles.

Run every command in PowerShell from:

```
cd S:\SiteAgentHub\Relay
```

---

## Part 1 — create and deploy (about 10 minutes)

**1. Log in to Cloudflare.** A browser window opens; approve it.
```
npx wrangler login
```

**2. Create the database.**
```
npx wrangler d1 create deploy-relay-test
```
It prints a `database_id`. Paste it into `wrangler.toml` under `[[env.test.d1_databases]]`,
replacing `REPLACE_WITH_ID_FROM_wrangler_d1_create_deploy-relay-test`.

**3. Create the file bucket.** R2 must be switched on once in the Cloudflare dashboard (R2 → enable;
the free tier is enough). Then:
```
npx wrangler r2 bucket create deploy-relay-artefacts-test
```

**4. Create the tables.**
```
npx wrangler d1 migrations apply deploy-relay-test --remote --env test
```

**5. Make a TEST owner key.** This is for testing only; it is not the customer's key.
```
bun cli/sign-go.ts keygen --out C:\Users\itsinfra\relay-test\owner.key
```
Copy the `publicKey` it prints into `wrangler.toml` → `[env.test.vars]` → `OWNER_PUBLIC_KEY`.

**6. Deploy.**
```
npx wrangler deploy --env test
```
It prints an address like `https://deploy-relay-test.<your-name>.workers.dev`. Opening it now shows
**"The relay stays closed until it is configured"** — that is correct; Part 2 configures it.

## Part 2 — the login (Cloudflare dashboard)

**7. Zero Trust team.** Dashboard → **Zero Trust**. The first time, pick a team name (free plan).
Your team domain is `<team-name>.cloudflareaccess.com`.

**8. Put the login in front of the relay.** Dashboard → **Workers & Pages** → `deploy-relay-test` →
**Settings** → **Domains & Routes** → the `workers.dev` row → **Enable Cloudflare Access**.
Then Zero Trust → **Access** → **Applications** → open the application that was just created:
- **Policies:** allow your two email addresses.
- **Overview:** copy the **Application Audience (AUD) Tag**.

**9. The validator's service token.** Zero Trust → **Access** → **Service Auth** → **Create Service
Token**, named `validator-test`. Copy the **Client ID** and the **Client Secret** (the secret is shown
only once). In the relay's Access application, add a policy with action **Service Auth** that
includes this token.

**9b. Open the health check.** Zero Trust → **Access** → **Applications** → **Add an application** →
**Self-hosted**. Domain: your `deploy-relay-test.<your-name>.workers.dev` address, path `api/health`.
Policy action **Bypass**, include **Everyone**. This is the only address that needs no login.

**10. Fill in the settings** in `wrangler.toml` → `[env.test.vars]`:

| Setting | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team-name>.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step 8 |
| `ROLE_OWNER_EMAIL` | email address 1 |
| `ROLE_BUILDER_EMAILS` | email address 2 |
| `ROLE_VALIDATOR_TOKEN_ID` | the Client ID from step 9 |
| `PUBLIC_URL` | the address from step 6 |

Then deploy again:
```
npx wrangler deploy --env test
```

## Part 3 — check it works

**11. As the builder:** open the address in a browser, log in with email 2. The page header shows
**builder** and the owner key fingerprint from step 5.

**12. As the owner:** open a private window, log in with email 1. The header shows **owner**.

**13. As the validator:**
```
curl.exe -H "CF-Access-Client-Id: <Client ID>" -H "CF-Access-Client-Secret: <Client Secret>" https://deploy-relay-test.<your-name>.workers.dev/api/whoami
```
Expect `"role": "validator"`.

If all three show the right role, the test relay is working. `ACCEPTANCE.md` is the full check list
to run against it.

## Part 4 — remove it when finished

```
npx wrangler delete --env test
npx wrangler d1 delete deploy-relay-test
npx wrangler r2 bucket delete deploy-relay-artefacts-test
Remove-Item -Recurse C:\Users\itsinfra\relay-test
```
Also delete the `validator-test` service token and the Access application in Zero Trust.
