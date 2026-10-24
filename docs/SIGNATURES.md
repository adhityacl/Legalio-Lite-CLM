# E-signature

Legalio tracks a contract through signing without being tied to a signing vendor. A **signature request** belongs to one contract and has ordered
**signers**, a **status**, a persisted **event timeline** and the **signed copy / evidence**. A *provider* is only the channel that carries the request to
the signers and reports back. The built-in provider is **manual / signed webhook**: you send the PDF with whatever tool you use, and progress is recorded
either by hand (contract record > **Signatures**) or by your tool calling Legalio's signed inbound webhook. Built-in e-mail-link signing is out of scope.

## Status lifecycle

```
draft --send--> sent --first signer--> partially_signed --last signer--> completed
  |               |  \-- all signers sign ---------------------------------> completed
  |               +-- a signer declines (from sent / partially_signed) ----> declined
  +-- cancel -----+-- cancel ----------------------------------------------> cancelled
                  +-- expiry date passes (sent / partially_signed only) ---> expired
```

`completed`, `declined`, `expired` and `cancelled` are final. Illegal moves answer `409 INVALID_TRANSITION`. A contract has at most one open request
(`draft`, `sent`, `partially_signed`); a new one can follow a final one. Requests default to 30 days (`expiresInDays`, 1-365).

**Sequential** requests give signers an `order`; in the application a signer can be marked signed only when everybody with a lower order already is
(`409 NOT_THEIR_TURN`). **Parallel** requests have no order. Over the inbound webhook the provider is the authority on sequence, so out-of-order
`signer.signed` events are accepted.

## What completion does

In one transaction, on `completed`:

* the contract's approval status moves: `Draft`/`Review` become `Signed` (or `Active` if the contract's start date has been reached), `Signed` becomes `Active` once the term has begun,
  `Active` stays; a **terminated** contract is not touched. The change goes through the contract repository under its row lock (version bumped once, `contract.updated` raised);
* the contract record gets `signed_file_link` (an `/uploads/...` link, served only to people who can see the contract), `signed_file_name`, `signed_at` and `signature_request_id`;
* the `signature.completed` webhook is queued (`signature.sent`, `signature.declined`, `signature.expired` likewise; see `docs/WEBHOOKS.md`);
* the requester gets an e-mail (`signature-update` template, organization language) through a ledger (`signature_notices`: one row per request/kind/recipient, retries with backoff);
* an activity-log entry and the request's own event are written.

A completion without a signed PDF is allowed over the webhook (some tools send the document later); a `request.document` event, or **Add evidence** with a signed copy in the application,
attaches it afterwards and updates the contract link. Obligation hook-up was not added: nothing in a signature maps to an obligation without a judgement call.

## In the application

Contract record > **Signatures**: request a signature (signers, order, expiry), **Send** (marks the request as sent; the manual provider sends nothing itself), **Send reminder** (spaced one minute apart),
**Cancel request**, record a signer as signed or declined, **Mark as signed / upload signed copy** (needs a PDF; everybody still waiting is recorded as signed), **Add evidence**, and the timeline.
Administrators manage inbound endpoints in **Settings > Data & automation > Signing webhook**.

Permissions: reading needs `document.view`, everything else `document.edit` on a contract the person can see (department roles only see their departments' contracts), endpoints need `tenant.signature.manage` (organization administrators).

## Files

Signed copies must be **PDF**; evidence may be PDF, PNG or JPEG (up to 5 per upload). The type is decided by the **magic bytes**, never the name or a declared content type. The size limit is 15 MB
(`SIGNATURE_MAX_FILE_BYTES`, 1 KiB - 25 MB); the encoded size is checked before decoding (`413 FILE_TOO_LARGE`, `422 INVALID_FILE`). Files go to the object store (Tencent COS; memory in test mode) under a key that carries the
organization id and a random segment, and the **ownership is registered in `upload_owners`**. Downloads of evidence go through `GET /api/signatures/:id/files/:fileId` (attachment, `nosniff`, sandboxed, contract visibility checked).

## Inbound webhook

`POST https://<host>/api/signatures/webhook/<endpointId>` (organization administrators create the endpoint; the URL is shown in the panel).

* **Secret**: shown once on creation and on rotation (`sigsec_...`), sealed at rest with the same key as the other integration credentials, never returned again. Rotation takes effect at once.
* **Authentication**: header `Legalio-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw request body>")` - the same scheme as Legalio's outgoing webhooks (see `docs/WEBHOOKS.md` for a verifier).
  The timestamp must be within 5 minutes. Unknown, disabled and badly signed endpoints all get the same `401 INVALID_SIGNATURE`.
* **Replay protection**: send `Idempotency-Key` (1-128 of `A-Za-z0-9._:-`; or `eventId` in the body). A key is processed once per endpoint: the same key again answers `200 {"status":"duplicate"}` and changes nothing
  (keys are kept 7 days, longer than the timestamp window). A delivery that is *rejected* (4xx) does not use up its key, so a corrected retry with the same key works.
* **Body** (JSON, at most 25 MB including base64 files):

```json
{
  "type": "signer.signed",
  "requestId": "sig_...",            // Legalio's id; or "providerRef": "ENV-42" (the reference stored by request.sent)
  "signer": { "email": "ada@counterparty.com", "id": "provider-signer-id" },
  "occurredAt": "2026-10-24T09:30:00Z",
  "reason": "only for declines/cancellations",
  "document": { "fileName": "signed.pdf", "contentBase64": "<PDF as base64>" },
  "evidence": [ { "fileName": "audit-trail.pdf", "contentBase64": "..." } ]
}
```

| `type` | Effect |
| --- | --- |
| `request.sent` | draft -> sent (`providerRef` is stored) |
| `signer.signed` | the signer (by `signer.email` or `signer.id`) is recorded; the last one completes the request; `document` becomes the signed copy |
| `signer.declined` / `request.declined` | the request is declined |
| `request.completed` | pending signers are recorded as signed, the request completes (with `document` if sent) |
| `request.expired` / `request.cancelled` | closed as reported by the provider |
| `request.document` | attaches a signed copy / evidence to a completed (or, for evidence, open) request |

Answers: `200 {"status":"applied"|"duplicate","requestId","requestStatus"}`, `400 INVALID_INPUT`/`IDEMPOTENCY_KEY_REQUIRED`, `401 INVALID_SIGNATURE`, `404 RESOURCE_NOT_FOUND` (unknown request in *this endpoint's organization*;
another organization's requests are invisible), `409 INVALID_TRANSITION`, `413 FILE_TOO_LARGE`, `422 INVALID_FILE`. The whole delivery is one transaction: a rejected one changes nothing.

Node example:

```js
const crypto = require('node:crypto');
const body = JSON.stringify({ type: 'signer.signed', requestId, signer: { email } });
const t = Math.floor(Date.now() / 1000);
const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': eventId, 'legalio-signature': `t=${t},v1=${v1}` }, body });
```

For Zapier/Make: sign in a code step with the endpoint secret, or put a small signing function between the tool and Legalio.

## Public API

`GET /api/v1/signatures` and `GET /api/v1/signatures/{id}` with an API key that has the `signatures:read` scope (status, signers, signed-copy metadata, timeline on the single record; no file bytes). Described in the OpenAPI document.

## Adding a provider

`apps/backend/src/signatureProviders.ts` defines `SignatureProvider` (`send`, `resend`, `cancel`) and a registry. A vendor integration implements the interface, registers itself at start-up and either
translates the vendor's webhook into the canonical events above (in a bridge) or adds a route that verifies the vendor's signature and calls `applyInboundEvent()` from `signatures.ts`. The state machine, timeline,
contract update, notices and `signature.*` webhooks are shared; nothing else changes. No vendor is integrated in this release.

## Operations

* Scheduler: `Signature expiry and notices` runs every 5 minutes under a PostgreSQL advisory lock (key `0x4c475347`): it expires open requests whose date passed (each claimed once by a guarded `UPDATE`), prunes idempotency keys older than 7 days and delivers/retries the requester e-mails. `POST /api/cron/trigger-check` runs the same pass on demand.
* Tables (migration `0027_signatures`): `signature_requests`, `signature_signers`, `signature_events`, `signature_files`, `signature_endpoints`, `signature_receipts`, `signature_notices`. Deleting a contract deletes its signature data; deleting an organization cascades.
* Notices are skipped (and recorded as such) while the SMTP relay is disabled.
