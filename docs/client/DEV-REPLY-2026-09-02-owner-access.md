# Reply — owner access · 2026-09-02

**Both done.** The link below works, and it opens the site with your 18 pages in it.

Your ask 2 was the right question to ask rather than guess — the answer was no, and the
reason was ours.

---

## The link

```
https://siteagent.tailbbb0d2.ts.net/invite/E4XN5loTDclOIeloR3q-SB_SHDiCZ-60XGgQnRTR638
```

For **`gear1.dinesh@gmail.com`**. Opened from outside before sending: **200**, *"Welcome —
set your password."*

Treat it as a password — it sets the account on first use.

## 1. Your side question first: yes, re-addressing would have worked

You asked whether swapping the host on the original token would have been enough, because
that would mean a smaller fix. **It would have.** The token was always valid; only the
printed host was wrong. Invite links here do not expire either, so the day-old one was
still live.

You were still right to ask for a reissue rather than assume it — but the diagnosis is the
smaller one, and the defect was one line building the URL from the control plane's own
loopback address instead of the public origin. That was fixed on 2026-09-01, which is why
this link comes out correct.

## 2. Ask 2 — no, that account could not see `sheeltron`. Now it can.

Your reading was exactly right:

| Site | Owner before | Contents |
|---|---|---|
| `global-nettech` | `gear1.dinesh@gmail.com` — the human | empty |
| `sheeltron` | `sheeltron@tenant.local` — a machine address nobody holds | **your 18 pages** |

Each site is a separate instance with its own login; there is no shared account across
them. When you called `create_site` for Global Nettech you passed an owner email, so that
site carried a person. **We** created Sheeltron and passed none, so it auto-generated a
placeholder owner — a random credential held encrypted in our registry and never issued to
anyone.

So the person and the content were on different sites, and fixing the link alone would have
dropped them into an empty CMS. That is our omission, not a design constraint: we should
have created Sheeltron with your owner email in the first place, given we created it on
your behalf.

**Fixed:** `sheeltron` now belongs to `gear1.dinesh@gmail.com`, and the link above is its
invite. Verified in the registry, not assumed.

## 3. One thing we found while doing it, and fixed

Putting your address on a second site surfaced a real defect, so we are reporting it rather
than leaving it.

Login accepts an email **or** a site name. The email query ended `limit 1` with no
ordering — so once one address is active on two sites, it matched an **arbitrary** row:

> Not an error. Not a wrong password. The wrong site — and potentially a different one on
> the next attempt.

On a system where each site is a different client's content, silently choosing is the one
thing that must not happen. It now refuses and names the way through:

```
That email owns more than one site (global-nettech, sheeltron).
Sign in with the site name instead of the email.
```

Eight assertions cover it, including that a single match still returns cleanly and that the
list is sorted so the message does not change between attempts.

**What this means for you in practice.** Right now only Sheeltron has a live invite, so
`gear1.dinesh@gmail.com` signs in and lands there with no ambiguity. If you later activate
Global Nettech under the same address, both become live and the email alone stops being
enough — sign in with `sheeltron` or `global-nettech` as the identifier instead. Both work
today; the site name always has.

**Global Nettech invite, since you may as well have it:**

```
https://siteagent.tailbbb0d2.ts.net/invite/T9teOGnQFiqX00V3C39HV38zRLuKrQX9ByI4RGbe5VU
```

Also verified 200. Two things worth saying about it:

- **It replaces the old one.** The `127.0.0.1` link from `create_site` is now dead — minting
  a new invite burns the previous token. So there is no stale password-set link for that
  account still floating around, which is the right state for a link you told us carries a
  password-set token.
- **Activate Sheeltron first if you only want one.** Once both are active,
  `gear1.dinesh@gmail.com` alone stops being enough and you sign in with `sheeltron` or
  `global-nettech` as the identifier. That is the §3 behaviour working as intended, not a
  fault — but if the owner only needs to see the pages, activating just Sheeltron keeps the
  simplest sign-in.

## 4. What the owner will see

Sheeltron, 18 pages, **all drafts**. Nothing published, `sheeltron.com` untouched — that
instruction stands and this changes nothing about it. This is read access to drafts, which
is what you asked for.

They can edit. If you would rather they could not yet, tell us and we will look at a
narrower role — we did not want to guess at a permission model change while you were
blocked.

## 5. Not affected

The connector token is unchanged and unrelated — that is the machine credential your agent
authenticates with. Nothing about today touches it.

The plugin note is noted as not urgent. We will answer it properly rather than quickly.
