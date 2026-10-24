# Public API (v1)

Organization-scoped access to **contracts, partners, orders and spendings** (read and write) and **obligations** and the **clause library** (read only) with API keys. The machine-readable description is
served at `GET /api/v1/openapi.json` (OpenAPI 3.1, public, generated from the same operation table as the routes and from the
request schemas the application itself validates with; a test fails when routes, route policies and the document disagree).

## Keys

Organization administrators create keys in **Settings > Data & automation > API keys** (or `POST /api/organizations/:id/api-keys`).

* The key (`lgk_<8 hex>_<43 characters>`) is **shown once**. Only its SHA-256 and a short prefix (`lgk_1a2b3c4d`) are stored; the list never returns the key.
* **Scopes** are `<resource>:read` and `<resource>:write` for `contracts`, `partners`, `orders`, `spendings`, plus `obligations:read` and `clauses:read` (these have no write scope: they are maintained in the application). They are independent: `write` does not include `read`.
* Optional **expiry** (at most five years) and a **rate limit** per key (default `API_RATE_LIMIT_PER_MINUTE`, 600; 1 to 6000). `last_used_at` is recorded (at most one write per minute per key).
* A key belongs to one organization and always acts inside it. It is organization-wide (not tied to a department), so give it only the scopes it needs. At most 50 active keys per organization.
* Creating and revoking keys is written to the organization audit log; changes made through a key appear in the activity history as user `lgk_xxxxxxxx@api-key.invalid`, role "API key".
* Keys work **only** on `/api/v1/*`. The cookie/session API (`/api/...`) answers 401 to a key, and a session token is not accepted on `/api/v1`.
* The keys in the platform System Console (`/api/auth-console/api-keys`, prefix `ba_live_`) are older, platform-wide and **do not authenticate anything**; `/api/v1` answers them with `API_KEY_UNSUPPORTED`.

```
curl -H "Authorization: Bearer $LEGALIO_KEY" "https://your-host/api/v1/contracts?status=Active&limit=50"
```

## Operations

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/whoami` | any valid key | organization id, key name, prefix, scopes |
| `GET /api/v1/{contracts,partners,orders,spendings,obligations,clauses}` | `<resource>:read` | `limit` (default 50, max 200), `offset`, `q`, `sort`, `dir` and the resource's filters (see the document). Answer: `{ data, total, limit, offset }` |
| `GET /api/v1/<resource>/{id}` | `<resource>:read` | `{ data }`; 404 for ids of other organizations |
| `POST /api/v1/<resource>` | `<resource>:write` | body as the interactive application validates it (see the schemas); 201 `{ data }` |
| `PATCH /api/v1/<resource>/{id}` | `<resource>:write` | partial update; the record's current `version` is **required** (body `version` or `If-Match`) |

Obligations (`/api/v1/obligations`, `/api/v1/obligations/{id}`) are read-only; filters: `status` (`open`, `in_progress`, `done`, `waived`, and the derived `overdue`), `type`, `contract_id`, `io_id`, `partner_id`, `responsible`, `department`, `source`, `due_from`, `due_to`; sorts `due_date`, `title`, `type`, `status`, `created_at`, `updated_at`. `status` in an answer is derived (an open obligation past its due date reads `overdue`; `stored_status` is the stored value).

Clauses (`/api/v1/clauses`, `/api/v1/clauses/{id}`) are read-only; filters: `q`, `category`, `risk` (`low`, `medium`, `high`), `language`, `jurisdiction`, `tag`, `status` (`active` by default, `archived`, `all`); sorts `title`, `category`, `risk_level`, `created_at`, `updated_at`. A clause carries its approved wording, fallback texts, guidance and the playbook `rules`.

There is no delete. Lists add display fields (partner name, contract number, USD value); single reads return the stored record.
File payloads (`fileData`, invoice/billing files, termination documents, tokens) are not accepted over the API.

Creating and updating run through the same code as the application: field validation, contract/order number uniqueness, lifecycle
status, references that must exist **in the key's organization**, optimistic concurrency and the activity log.

## Errors

Unified body `{ "error", "code", "message", "status", "requestId" }` (plus `issues` for validation). Codes you will meet:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `INVALID_REQUEST` | invalid body, unknown partner, duplicate number, ... |
| 401 | `API_KEY_REQUIRED`, `API_KEY_INVALID`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_UNSUPPORTED` | authentication |
| 403 | `INSUFFICIENT_SCOPE` | the key lacks the scope |
| 404 | `RESOURCE_NOT_FOUND` | no such record in the key's organization |
| 409 | `VERSION_CONFLICT`, `DUPLICATE_VALUE` | someone changed the record; read it again and re-apply |
| 428 | `VERSION_REQUIRED` | updates must say which version they edit |
| 429 | `RATE_LIMITED` | see `Retry-After`; every answer carries `X-RateLimit-Limit/Remaining/Reset` |

Rate limits are counted per process (like the other limiters here): behind N instances a key can use up to N times its limit.
Repeated invalid keys from one address are slowed down (60 failures a minute).

## Webhooks

Outbound events (contract changes, reminders, approvals, exports, signatures) are configured under Settings > Data & automation > Webhooks;
see [WEBHOOKS.md](WEBHOOKS.md).
