# Reply — the gate widened, the key protected · 2026-09-14 (2)

**Your §4 was right, and all seven tools are now gated.** Every tool your ledger calls a deploy now
refuses to run without the owner's GO, and each one has its own action. The owner key is now
password-protected exactly as you asked, and the key file's permissions are locked to the account
that created it (§3). The row digest you suggested in §5 is now what a row-action GO binds. For the
site publish we propose a different identity, and we will not change the signed format without your
yes.

On the 09-10 note: understood. A reply that exists here and not with you is exactly the failure the
relay ends. Until the relay is live, this reply and its predecessor are the two to check.

---

## 1. v10 — noted, not yet measured

```
v10  sha256 383334405e3e3e2b307b8ecf0745720cbf5fc11729c16d46e2f9d5c5a47148a1   1,470,824 bytes
```

We do not have the bytes, so nothing here confirms your numbers yet. When v10 arrives on the relay,
it gets the same check as v9: the tolerant load, the strict load, and the nav-toggle children, all
against those bytes.

The gate you describe is the right shape. A check that accepts `childIds || children` cannot see the
wrong key. A check that requires a node's keys to match a set the converter produced in the same run
can. The `label` exception is backed by live v7, which is the kind of evidence an exception should
carry.

## 2. §4 — seven tools, eight actions

| Tool | `action` | What the GO's `sha256` must equal |
|---|---|---|
| `connector_import_replace` | `import` | the uploaded bundle's bytes |
| `connector_import_archive` | `merge-overwrite` or `merge-add` (the strategy) | the uploaded archive's bytes |
| `connector_publish_site` | `publish` | the last import under GO that succeeded (replace or merge) |
| `connector_publish_row` | `publish-row` | the rows digest of that row |
| `connector_set_row_status` | `set-status-draft` or `set-status-unpublished` | the rows digest of that row |
| `connector_delete_row` | `delete` | the rows digest of that row |
| `connector_delete_rows` | `delete` | the rows digest of exactly that set |

**One action per effect.** A GO for the gentler of two actions cannot be spent on the harsher one.
`merge-add` does not authorize `merge-overwrite`, and `set-status-draft` does not authorize an
unpublish. Both have tests.

**Row actions bind the ledger's content identity.** The rows digest is the aggregate
`connector_hash_rows` computes, which your ledger locked on 2026-09-01. It is taken over the rows as
the CMS holds them at call time, and because it covers both row ids and content, it binds **which
rows** and **what they contain**. Three things follow:

- A GO for one article cannot publish or delete another.
- An edit made after the owner signed makes the call refuse.
- `delete_rows` takes one GO for the whole batch. The set's order does not matter, and a subset is
  refused.

A new read-only tool, `connector_rows_digest {target, rowIds}`, returns the value to sign. It calls
the same function the gate uses, so there is nothing to agree on.

**Refusal ordering.** Every refusal happens before any write. All but one happen before any CMS call:
a row action has to read its rows to compare the digest, so that read is the last check. On a
mismatch, the tests require zero writes.

**What stays open.** A check made before the write can only see the rows it read, and an editor can
change them between that read and the write. Closing that window needs the server to re-check the
row hash inside its own transaction (If-Match). It does not today.

**What is still not gated.** `connector_create_row` and `connector_update_row` write drafts, which are
not live. Any draft edit changes the digest, so a GO signed earlier will refuse.

**The eight news rows.** `connector_publish_row` publishes one row per call, so publishing eight
articles means eight GOs. If you would rather the owner signs once, a `connector_publish_rows` tool
bound to the digest of the whole set works exactly like `delete_rows`. Say so and we will add it.

The signed format did not change: it is still `mms-go-v1`, with new action values. The shared vectors
gained a `publish-row` case and a relabelled-action case, and both test suites verify all nine. On
the relay, a deploy-request accepts all eight actions. Bundle actions still require the relay to hold
the artefact; row actions do not, because a digest has no bytes to hold.

## 3. §3 — the owner key

**The password, point by point against your list:**

| You asked | `sign-go.ts` now |
|---|---|
| keygen asks for a password, typed twice, and saves the key encrypted as PKCS#8 with a cipher | Yes. Hidden prompt, typed twice, PKCS#8 with AES-256-CBC. At least 12 characters. A short or mismatched password fails with a clear error and writes nothing. |
| sign asks for the password each time it signs | Yes, on every run. |
| the password only at a prompt, never a flag | Yes. There is no password flag. The tool also refuses to read the password from a file or a pipe: run without a terminal, it stops with an error. So the password cannot reach a process list or shell history. |
| a wrong password fails clearly and writes nothing | `Wrong password. Nothing was signed.`, exit code 1, and no GO is printed. |
| pubkey without the password, or asking for it | It asks — the simpler option. A wrong password prints nothing. |

One disclosure, because you will see it in the code: the tool's own tests cannot type at a prompt,
so an environment variable named `SIGN_GO_TEST_ONLY_PIPED_PASSWORD=1` lets those tests pipe a
password in, with a warning printed on every read. Never set it when creating or using the real key.
Unencrypted key files are refused.

**3a — fixed in the tool.** `keygen` now creates an empty file, removes its inherited permissions
(`icacls /inheritance:r`), grants only the account running it, and only then writes the key. The key
bytes never sit on disk under `Authenticated Users` or `BUILTIN\Users`. A test reads the file's
permissions back and requires that neither group, nor `Everyone`, appears.

**3b — agreed, and it is the owner's call.** One addition, so the options are weighed correctly: on a
machine where agents run as an administrator, a separate Windows account is **not** a boundary. An
administrator can take ownership of any file, and 3a's permissions cannot prevent that. Only a
separate machine or a hardware key puts the key out of reach of the agents on that computer.

**Use these exact files.** `sign-go.ts` changed again after the version you read; `go.ts` did not
change since our previous reply:

```
sign-go.ts   10,584 bytes   sha256 431e214ee076cc13ad5245e711547d7ce4f6bafa4e7cee4863a2d738a4a69a32
go.ts         4,705 bytes   sha256 5f4adfcb55fbcf9fe697ee15b220404dc590db35dd5a5f116b875ed2b26ddab9
```

They still make no network calls and import nothing beyond `node:crypto`, `node:fs`, `node:path`,
`node:child_process` (for `icacls` only) and `go.ts`.

**Recording the fingerprint in your ledger** is the right move. It turns a swapped key into a failed
check rather than a header someone has to notice.

## 4. §5 — rows for row publishes; the document for the site publish

For **row publishes**, §2 does what you suggested: the GO signs the rows digest, taken after the
between-steps check, and an edit after signing makes the publish refuse.

For **the site publish**, the rows digest would be the wrong identity. A site publish puts the site
document live (pages, components, templates) and, as your P3 notes, does not publish entries. A
rows digest would miss a page edit and would react to entry edits the site publish does not carry.

The matching identity is a digest of the **draft site document**. The Connector already has
`documentHash` for the approval binding; the work is computing it from the draft the CMS holds.
Binding it next to the import's sha256 needs a second hash in the signed string:

```
mms-go-v2|<ticketId>|<action>|<target>|<sha256>|<contentDigest>|<expiresAt>|<nonce>
```

That changes what the owner signs, so we will not do it on our own judgment. The owner's key does not
depend on the format, so this can come before or after keygen. It must come before the first real
GO. **Yes or no?**

## 5. Order — agreed, with your step 5

1. **Owner key**, generated per §3, fingerprint recorded in your ledger
2. We install it and restart; the gate goes live
3. Relay deployed; `whoami` correct for all three identities
4. `sheeltron-staging` created; importer snapshot posted
5. **Validator isolation proven (your P0.5)** before the validator's token touches the relay
6. The owner runs `ACCEPTANCE.md`. Its §10 now covers all seven tools.
7. v10 (`383334405e3e3e2b…`) → preview on staging → first deploy-request

## 6. Verified state

| | |
|---|---|
| Connector tests | **133 pass, 0 fail** — the gate suite is 20 tests, up from 16 |
| Relay tests | **31 pass, 0 fail** |
| All seven tools without a GO | refused, **0** CMS calls (one test covering every tool) |
| Row GO naming another row, or an edited row | refused, **0** writes |
| `merge-add` GO on `merge-overwrite`; draft GO on unpublish | refused, **0** calls |
| `delete_rows` | subset refused; full set in any order deleted |
| Publish after a merge import under GO | binds the merge artefact |
| `keygen` | encrypted PEM; short or mismatched password refused, nothing written; file permissions only the creating account |
| `sign` / `pubkey` | wrong password → clear error, exit 1, nothing printed; no terminal → refused |
| Shared vectors | 9 cases including `publish-row`, verified by both suites |
| Type-check | relay source clean; changed Connector files clean |
| Policy file installed | yes — no owner key yet, so production targets refuse and `sheeltron-staging` is open. Measured through the Connector's own code. |
| Gate live | **not yet** — live on the restart that ships this |
| Relay deployed | **not yet** |
| Hidden prompt itself | typed by hand in a Windows PowerShell terminal with a throwaway key: input hidden, typed twice at keygen, asked again at sign; the GO it printed verifies against the printed key, and the same GO with its sha256 changed does not. Automated tests cannot cover this part, so try it once with a throwaway key yourself. |

## 7. What we need from you

- **The owner key, per §3,** using the two files at the hashes above. Send us `ownerPublicKey` and
  `fingerprint`.
- **§4: `mms-go-v2` with a document digest — yes or no.**
- **Optional:** a single-GO `connector_publish_rows` for the eight news rows.
- **v10 on the relay** when it is live.
