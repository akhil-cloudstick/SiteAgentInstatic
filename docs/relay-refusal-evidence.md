# The four approver refusals — raw request and response

Produced from the relay's own code paths, so the wording below is the wording
a live relay returns. Every one of these is a REFUSAL: the interesting part is
the status and the message, and that nothing was written on the way to it.

Refused by the **relay** in all four cases — the Connector refuses separately,
against the same registry, and its messages are its own.

---

## AC-B6.1 — a property is approved by its own key, and never by another

**Criterion:** AC-B6.1

The GO is well formed and correctly signed — but signed with a key that is not the one registered for this property. The signature check is reached and fails.

Request

```http
POST /api/tickets/DR-000004/go
content-type: application/json

{
  "go": {
    "ticketId": "DR-000004",
    "action": "import",
    "target": "sheeltron",
    "sha256": "2e23945be9b9b8f6250cb871f77a923074aabe5b75f527ed6b620d0621958b1d",
    "contentDigest": "-",
    "expiresAt": "2026-09-14T09:00:00.000Z",
    "nonce": "P6wRlNip4ZemKw_7iFdG4LQr",
    "signature": "CS5bsOK1uoxvDn6Bvg6go08JUMNz53Em7SJp8CLa03RU1wpGfAbcGizpcKtKF6m1/iBPqY0J/e8Hnn3940lxCA=="
  }
}
```

Response

```http
HTTP 422

{
  "error": "The GO signature does not verify against the approver key for \"sheeltron\".",
  "ownerKeyFingerprint": "f91e145ff761386b",
  "approverScope": "property"
}
```

---

## AC-B6.3 — a property with no registered approver is refused, never handed to another key

**Criterion:** AC-B6.3

No approver is registered for anything. There is no platform-wide fallback key, so the request cannot be satisfied by anyone — which is the requirement, not a gap.

Request

```http
POST /api/tickets/DR-000002/go
content-type: application/json

{
  "go": {
    "ticketId": "DR-000002",
    "action": "import",
    "target": "sheeltron",
    "sha256": "2e23945be9b9b8f6250cb871f77a923074aabe5b75f527ed6b620d0621958b1d",
    "contentDigest": "-",
    "expiresAt": "2026-09-14T09:00:00.000Z",
    "nonce": "WPDW6jCjch03V-bGlrUYj25I",
    "signature": "4B7ED/PJ7pvARlyCVZl/TiYpE7dY2bCFc4WtOb0CnRgQ1bZavK6SfpaujZmY8nd+QAg47RZVZxXF96qSqfKiAA=="
  }
}
```

Response

```http
HTTP 503

{
  "error": "No approver is registered for \"sheeltron\", so no GO can be granted for it. Register one, or configure a business-level approver that names it."
}
```

---

## AC-B6.2 — after rotation the retired identity is refused immediately

**Criterion:** AC-B6.2

The property's approver has been rotated to a new key. A GO signed by the PREVIOUS key is refused from the moment the rotation is recorded — there is no grace period.

Request

```http
POST /api/tickets/DR-000004/go
content-type: application/json

{
  "go": {
    "ticketId": "DR-000004",
    "action": "import",
    "target": "sheeltron",
    "sha256": "2e23945be9b9b8f6250cb871f77a923074aabe5b75f527ed6b620d0621958b1d",
    "contentDigest": "-",
    "expiresAt": "2026-09-14T09:00:00.000Z",
    "nonce": "2tpQWenMdGY3TZl4GfdTm4x0",
    "signature": "TA4j7/gYBZO5+U07b9zM74oB9QokFO/gVtYVaRMZ9zjp8Z2SHtdON9hp3SW2+8JtyZqvoTVqQhchCwcnPBKpDw=="
  }
}
```

Response

```http
HTTP 422

{
  "error": "The GO signature does not verify against the approver key for \"sheeltron\".",
  "ownerKeyFingerprint": "ce9db912d43960cc",
  "approverScope": "property"
}
```

---

## AC-B6.4 — a business approver covers only the properties it names

**Criterion:** AC-B6.4

A business-level approver is registered and explicitly covers one property. A GO for a DIFFERENT property, signed by that same business key, is refused: coverage is never inferred from a hierarchy.

Request

```http
POST /api/tickets/DR-000003/go
content-type: application/json

{
  "go": {
    "ticketId": "DR-000003",
    "action": "import",
    "target": "acme-two",
    "sha256": "2e23945be9b9b8f6250cb871f77a923074aabe5b75f527ed6b620d0621958b1d",
    "contentDigest": "-",
    "expiresAt": "2026-09-14T09:00:00.000Z",
    "nonce": "QtMXTBnXn7GNuwxHBKmc1wIs",
    "signature": "X9nCdORFcXFU9z4UETNUacdqvYok0CL4IDqoHlHCB1paFpSfO+tKabZtHtjLalZCM+VTyzCbSil4dQ6XuhB1Cg=="
  }
}
```

Response

```http
HTTP 503

{
  "error": "No approver is registered for \"acme-two\", so no GO can be granted for it. Register one, or configure a business-level approver that names it."
}
```

---

## How to reproduce

These come from the relay's own test fixtures, which use the shared vectors in
`docs/relay/go-test-vectors.json` — the same file the Connector replays. To see
them run from `S:\SiteAgentHub\Relay`:

```
bun test tests/approvers.test.ts
```

