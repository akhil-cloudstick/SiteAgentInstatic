# Reply — mms-go-v2, one GO for the news rows, a stronger key file · 2026-09-14 (3)

**The owner key is installed, and both of your yeses are built.** We computed the fingerprint from the
public key you sent, and it matches the fingerprint you sent. A site-publish GO now binds the draft
site document. One GO publishes a whole set of rows. The key file is now protected with scrypt, and
the key you already created keeps working.

Building v2 turned up one thing neither of us had named: the check has to happen **inside the CMS**,
not before it. §2 explains why.

---

## 1. The owner key — installed

```
publicKey     IbuwxxkoUKlL6vPcfpjb8LMukD0n1tEev5UMu/f3hks=
fingerprint   b24cc51f0c688fbb   computed from that key here — matches the one you sent
```

It is in the Connector's GO policy and takes effect on our next restart. From then on, every gated
Connector response carries `go.ownerKeyFingerprint: "b24cc51f0c688fbb"`. The relay gets the same key
as `OWNER_PUBLIC_KEY` when it is deployed.

## 2. `mms-go-v2` — the site publish binds the draft, and the CMS enforces it

```
mms-go-v2|<ticketId>|<action>|<target>|<sha256>|<contentDigest>|<expiresAt>|<nonce>
```

`contentDigest` is the draft site hash for `publish` and `"-"` for every other action. A v1 GO does
not parse as v2.

**Why the check lives in the CMS.** Before a site publish bakes the draft, it flushes editor changes
still waiting in the save debounce window. A draft hash read before the publish therefore does not
describe what gets baked. An edit in flight would go live under a signature that never covered it.
Comparing hashes in the Connector alone cannot close that, so we changed the publish itself:

- **`GET /publish/status` now returns `draftSiteHash`.** The publisher computes it with its own
  `siteContentHash`, the same function that stamps each published snapshot. There is no second
  implementation to drift.
- **`POST /publish` accepts `If-Match: "<draftSiteHash>"`.** The CMS compares it after the flush,
  under the publish lock, against the exact document it is about to bake. On a mismatch it answers
  **412 and writes nothing**. A malformed `If-Match` is refused with 400, so a caller who asked for a
  conditional publish never gets an unconditional one.
- **`connector_publish_site`** checks in order:
  1. `sha256` equals the last import under GO that succeeded.
  2. `contentDigest` equals the draft site hash, read last.
  3. It spends the GO and publishes with that hash as `If-Match`.

  If an edit lands between the check and the bake, the CMS answers 412. The GO is then spent and
  recorded as failed, and a new GO is needed.
- **`connector_site_digest {target}`** is new and read-only. It returns both values to sign, plus
  which import `sha256` came from.
- **On the relay,** a publish deploy-request must carry `contentDigest`. It is fixed at creation,
  cannot be changed, and appears in the export, and the GO must match it.

For the site publish, this closes the check-then-write gap our previous reply said was open. **For
row actions that gap is still open:** a row publish has no `If-Match` yet, so the rows digest is
checked just before the write rather than inside it.

## 3. `connector_publish_rows` — one GO for the eight articles

- **Input:** `{target, rowIds, go}`, where the GO is **one** `publish-row` GO. Its `sha256` is
  `connector_rows_digest` of exactly that set; the order does not matter.
- **Binding:** a GO for a different set, or for a subset, is refused with zero writes. So is a set
  whose rows were edited after signing.
- **Result:** each row is reported individually, so a partial failure is visible. The GO is
  single-use.
- **Shape:** the same binding as `connector_delete_rows`.

## 4. The key file — scrypt, and your existing key keeps working

**New key files** use scrypt with N=2^17, r=8, p=1 — about half a second and 128 MB of memory per
guess on our machine. That feeds AES-256-GCM. The public key and every scrypt and cipher parameter
are authenticated together with the ciphertext, so a file edited to show another public key or
weaker parameters fails to decrypt instead of misleading anyone.

**Your key**, created with PBKDF2 at 2,048 rounds, still works for `sign` and `pubkey`, and `sign`
prints a note about the older protection. To move it to scrypt:

```
bun cli/sign-go.ts rewrap --key <your key file>
```

It asks for the current password, then a new one twice (it may be the same). It writes the scrypt
file beside the old one, then replaces the old one. **Same key, same fingerprint: `b24cc51f0c688fbb`.**
A wrong current password changes nothing. We tested this end to end on a PBKDF2 key made the same
way yours was.

**Unchanged:** the password is typed at a hidden prompt only, never taken from a flag, pipe or file.
A wrong password prints nothing, the Windows permission lock stays, and the tests-only pipe switch
works as before. `pubkey` on a scrypt file no longer needs the password, because the public key is
readable in the file and `sign` verifies it against the private key on every use.

## 5. `go.ts` — you are right

You measured 4,031 bytes in our first reply and 4,705 in the second, which added the six new
actions. Our "unchanged" compared the second reply's own files, not the first, so the record should
say it changed. It changes again now, for v2:

```
sign-go.ts   17,844 bytes   sha256 54f3f630ad4a7ad405d7e8f2caa7e2a5c8946e5318149501dc2cb5a0f8b3ffbf
go.ts         5,546 bytes   sha256 d26fda85dd2fc9d866bc8e7260705572b8c17fc74d97e9a0c479be12a4bdc922
```

## 6. Order

1. **Rewrap your key** (recommended). The fingerprint stays `b24cc51f0c688fbb`.
2. We restart. The gate, v2 and the CMS precondition go live.
3. Relay deployed with your key; `whoami` correct for all three identities.
4. `sheeltron-staging` created; importer snapshot posted.
5. Validator isolation proven (your P0.5).
6. The owner runs `ACCEPTANCE.md`; its §10 now covers `connector_publish_rows` and the draft binding.
7. v10 on the relay, then:
   - preview on staging;
   - import GO;
   - `connector_site_digest`;
   - publish GO;
   - one `publish-row` GO for the eight articles.

## 7. Verified state

| | |
|---|---|
| Owner key | installed; fingerprint computed from your key: `b24cc51f0c688fbb`, matches |
| Connector tests | **137 pass, 0 fail** — the gate suite is 24 tests |
| Relay tests | **34 pass, 0 fail** |
| Instatic publish tests | **9 pass, 0 fail**, including: status reports `draftSiteHash`; an expected-hash publish on a changed draft is refused with nothing written; a matching one publishes |
| Site publish, draft edited after signing | refused by the Connector before publishing |
| Site publish, edit landing during the publish | refused by the CMS (412); GO spent and recorded failed |
| `publish_rows` | subset refused with 0 writes; whole set published once; the GO cannot be reused |
| `rewrap` of a PBKDF2 key | same public key; old password then refused; new password signs |
| Altered scrypt key file | refused, nothing signed |
| Shared vectors | 9 v2 cases, including a publish GO with a changed `contentDigest` (refused); both suites |
| Type-check | relay clean; changed Connector and Instatic files clean |
| Wider Instatic runs | 8 static-artefact and re-bake tests fail because this machine refuses to create symlinks (`EPERM`). 2 fail on the wording of a site-document error message. None of that code is in this change. |
| Gate, v2, CMS precondition live | **not yet** — on our next restart |
| Relay deployed | **not yet** |

## 8. What we need from you

- **Rewrap your key** when convenient, and confirm the fingerprint printed is still `b24cc51f0c688fbb`.
- **v10 on the relay** once it is live.

Nothing else is blocked on you.
