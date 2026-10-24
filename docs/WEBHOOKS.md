# Outbound webhooks

Organization administrators add endpoints in **Settings > Data & automation > Webhooks** (`/api/organizations/:id/webhooks`). Each endpoint has
a URL (https), an optional event filter (empty = every event) and a signing secret that is **shown once** (sealed at rest with the
same key as the other stored credentials; rotate it to get a new one).

## Events

| Type | Raised when |
| --- | --- |
| `contract.created` | a contract is created (UI, API key, import) |
| `contract.updated` | tracked fields change (`data.changedFields`) |
| `contract.status_changed` | the lifecycle status changes, by an edit or by the calendar (`data.source` is `api` or `lifecycle`) |
| `contract.terminated` | a contract becomes Terminated |
| `reminder.sent` | a renewal/notice reminder e-mail was delivered |
| `approval.requested` | a document is submitted for approval |
| `approval.decided` | an approver approves or rejects a step (`data.finished`, `data.requestStatus`) |
| `document.exported` | a Google Docs export or a tenant data export finished (`data.kind`) |
| `obligation.created` | an obligation is created (UI, review-queue acceptance) |
| `obligation.due_soon` | an open obligation came within its reminder lead time (once per due date) |
| `obligation.overdue` | an open obligation passed its due date (once per due date) |
| `obligation.completed` | an obligation was marked done (`data.nextDueDate` is the new date of a recurring one, `data.completedDueDate` the occurrence that was completed) |
| `signature.sent` | a signature request was sent out (`data.signers`, `data.providerRef`) |
| `signature.completed` | every signer signed (`data.signedFile` has the name, size and SHA-256 of the signed copy, or `null` while it is still to come; `data.signers[].signedAt`) |
| `signature.declined` | a signer declined (`data.declinedBy`, `data.reason`) |
| `signature.expired` | an open request passed its expiry (`data.expiresAt`) |

Contract events are queued in the same database transaction as the change. `webhook.test` is sent only by the Send test button.

## Request

```
POST <your url>
Content-Type: application/json
User-Agent: Legalio-Webhooks/1
Legalio-Event-Id: evt_...        (same for every retry; use it to de-duplicate)
Legalio-Event-Type: contract.created
Legalio-Delivery-Id: whd_...
Legalio-Signature: t=1700000000,v1=<hex>

{ "id": "evt_...", "type": "contract.created", "apiVersion": "2026-10-01", "created": "...", "organizationId": "...", "data": { ... } }
```

**Verify the signature**: `v1` is the hex HMAC-SHA256, keyed with the endpoint secret, of the string `<t>.<raw request body>`. Compare in
constant time and reject timestamps older than a few minutes. Node:

```js
const crypto = require('node:crypto');
function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
```

Answer with any 2xx within 10 seconds. Anything else (including a redirect, which is **never followed**) is a failed attempt.

## Delivery and retries

Events go to an outbox (`webhook_deliveries`, also the delivery log in the UI). A worker claims due rows under a PostgreSQL advisory lock;
a failed attempt is retried after 30 s, 1 min, 2 min, 4 min ... (cap 6 h), at most `WEBHOOK_MAX_ATTEMPTS` (8) attempts, then the delivery is
**dead** and can be retried by an administrator. An endpoint with 20 consecutive dead deliveries is disabled automatically. Sent and
skipped rows are pruned after 30 days, dead ones after 90.

## Network safety

* https only (`WEBHOOK_ALLOW_HTTP=true` allows http for development).
* The URL must not contain credentials or a fragment, nor name an obviously internal host (`localhost`, `*.internal`, metadata names) or a private literal address.
* At every delivery the host name is resolved and **every** address must be public: loopback, private (10/8, 172.16/12, 192.168/16), link-local
  (169.254/16, including the cloud metadata address), CGNAT, multicast, reserved and the IPv6 equivalents (including IPv4-mapped forms) are refused.
  The connection is pinned to the checked addresses, so DNS rebinding between check and connect cannot redirect it.
* Redirects are not followed, the request times out (`WEBHOOK_TIMEOUT_MS`, 10 s), only the first 16 KiB of the response are read and a short
  snippet is logged. Payloads over 256 KiB are not queued.
* `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` lifts the address rule for local development and tests only; the server logs a warning when it is set in production.
