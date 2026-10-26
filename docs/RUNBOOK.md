# Operations runbook

For the Docker Compose install (`compose.yaml`): nginx (`frontend`), the API (`backend`) and PostgreSQL (`postgres`).

## First-run setup is open on purpose

A fresh install has no administrator, and the first visitor creates it on the setup page (`POST /api/system/setup`, accepted only while no superuser exists). This is intentional. **Complete the setup before the URL is reachable from the internet** (or keep the port bound to localhost / a private network until you have), because whoever reaches it first becomes the administrator. Setup refuses (409) once an administrator exists.

## Configuration that matters

| Setting | Where | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | root `.env` or shell | Required; Compose fails with a clear message without it. Only applied when the volume is first created. |
| `BETTER_AUTH_SECRET` | `apps/backend/.env` | Created by `npm run setup`. **Also encrypts the stored storage credentials.** |
| `FRONTEND_BIND`, `FRONTEND_PORT` | root `.env` | Default `0.0.0.0:8080`. Use `127.0.0.1` behind a host reverse proxy. |
| `TRUST_PROXY` | root `.env` | Which hops may set `X-Forwarded-*` for the backend. Default: loopback and private ranges (the Docker network). A number means that many hops. |
| `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_DISABLED` | backend env | Limits on sign-in, setup and cron endpoints (default 30 writes per client per 60 s). nginx adds its own 30 requests/min limit on the same paths. |

### Phase 1 settings (backend env)

| Setting | Default | Notes |
| --- | --- | --- |
| `LOG_LEVEL` | `info` (`error` under `APP_TEST_MODE`) | pino JSON logs on stdout with a request id (`X-Request-Id` is echoed and sent in error bodies). |
| `REMINDER_SCHEDULER_ENABLED` | `true` (always off under `APP_TEST_MODE`) | In-process reminder scheduler. Only one instance runs a pass (PostgreSQL advisory lock). |
| `REMINDER_INTERVAL_MINUTES`, `REMINDER_STARTUP_DELAY_SECONDS`, `REMINDER_RETRY_INTERVAL_MINUTES` | `1440`, `60`, `15` | Full pass, first pass after boot, retry of failed deliveries (backoff 5 min doubling to 6 h, 5 attempts). `POST /api/cron/trigger-check` runs the same pass on demand. |
| `REMINDER_NOTICE_LEAD_DAYS` | `7` | The notice-deadline reminder (end date minus notice period) is sent from this many days before the deadline. Delivery state is in the `reminder_ledger` table. |
| `SMTP_ALLOW_SELF_SIGNED` | unset | Set `true` (or the platform setting `smtpAllowSelfSigned`) only for a relay with a self-signed certificate; certificates are verified otherwise. |
| `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS` | `10`, `30000`, `10000`, `60000`, `75000` | `0` disables a timeout. |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | SIGTERM stops accepting requests, waits for in-flight requests and queued saves, then closes the pool. |
| `AI_ORG_CALLS_PER_MINUTE`, `AI_ORG_DAILY_CALLS`, `AI_ORG_DAILY_TOKENS` | `30`, `1000`, `3000000` | Per organization; `0` disables a limit. Exceeding answers HTTP 429. Usage is stored in `ai_usage` per UTC day. |
| `AI_ORG_MONTHLY_TOKENS` | `0` | Default monthly token limit per organization (UTC month); `0` is unlimited. A platform administrator can choose 100K, 500K, 1M, 5M, 10M or unlimited for each organization in `/sys` → AI Model; that choice (table `ai_org_limits`, migration `0029`) overrides this default. Exceeding answers HTTP 429 `AI_MONTHLY_BUDGET`. |
| `AI_ATTEMPT_TIMEOUT_MS`, `AI_MAX_MODEL_ATTEMPTS`, `AI_CHAT_HISTORY_MESSAGES`, `AI_CHAT_CONTEXT_CHARS` | `35000`, `3`, `12`, `60000` | Per-attempt abort, model chain length (max 3), chat history and the size of the retrieved records sent to the model. |

Upgrade notes: schema changes are versioned migrations. The server applies pending ones at boot under an advisory lock; to run them ahead of a deploy use `npm run migrate` (or `node apps/backend/dist/migrate.cjs` in the image) and check with `npm run migrate:status`. Existing databases adopt `0001_baseline`..`0005` without changes. Tables `reminder_ledger`, `upload_owners` and `ai_usage` are created automatically (additive). On first start the existing upload links are backfilled into `upload_owners` and earlier "Reminder Nd" notifications are copied into the ledger as sent; provider secrets in `app_settings` are re-encrypted by the first save. `audit_log` rejects UPDATE/DELETE; a deliberate maintenance transaction can lift that with `SELECT set_config('legalio.allow_audit_mutation', 'on', true)`. Activity log rows now live only in `activity_logs` (no 500-row cap).

### Schema migrations and ids (Phase 2)

- Migrations run at boot under an advisory lock, or ahead of a deploy with `npm run migrate` (`node apps/backend/dist/migrate.cjs` in the image); `npm run migrate:status` lists them and exits 1 while any is pending.
- Record ids (`P0001`, `C0001`, `IO0001`, `SP0001`, `EVAL-2026-001`) now come from PostgreSQL sequences created by migration `0006_id_sequences`. At every start each sequence is moved past the highest number stored, so existing data continues without gaps; numbers of deleted records are no longer reused.
- API request bodies for partners, contracts, IOs, spendings and evaluations are validated and whitelisted (HTTP 400 `VALIDATION_FAILED` with `issues`); errors use `{ error, code, message, status, requestId }` and no longer carry internal error text. Quote the `requestId` to find the cause in the logs.

### Repository-backed data and several instances (Phase 2)

- Migrations `0007` and `0009` .. `0014` add a `version` column (default 1) and lookup indexes to contracts, partners, insertion orders, spendings,
  evaluations, notifications and templates (templates keep their own `version`; empty ones become 1). Existing rows are adopted in place: nothing is
  copied or re-imported. The migrations are additive, so rolling the *code* back is safe (the old release ignores the columns and keeps working on the
  same tables), but never run an old and a current release against one database at the same time.
- The legacy `spd-...` spending ids of the earliest releases are renumbered from the id sequence at start (once; the old release renumbered them from 1).
- Writes are committed row by row; a second editor saving a stale copy gets HTTP 409 `VERSION_CONFLICT` (reload and re-apply). Deleting a partner is
  one transaction (its contracts, orders and notifications go; invoices and evaluations keep their record without the partner link).
- No business record is loaded into memory at boot; startup time and memory no longer grow with the amount of data.
- **Several backend instances can share one database** (behind a load balancer; keep `REMINDER_SCHEDULER_ENABLED` as is, the advisory lock picks one).
  Start them in any order, also together. Configuration changes (branding, SMTP/AI settings, organization policy, credentials) reach the other
  instances within a moment through `NOTIFY` and at the latest after `SHARED_STATE_POLL_MS` (default 30000, `0` turns the periodic reload off;
  `SHARED_STATE_SYNC=false` turns the whole mechanism off, e.g. for a single instance behind a restricted connection pooler). `NOTIFY` / `LISTEN` needs a
  session connection to PostgreSQL (not transaction-mode pgbouncer). Per-instance limits: rate limiters count per process (N instances = up to N times
  the configured rate).

### Paged lists and search (Phase 2B)

- `GET /api/contracts`, `/api/partners`, `/api/ios`, `/api/partner-spendings` still return the complete array when called without parameters (and
  `/api/init-data` is unchanged). With `limit` (1-500, default 50 when only `offset` is given), `offset`, `q` (words that must all match),
  `sort` + `dir=asc|desc` and per-endpoint filters they return one page and the number of matching, *visible* records in `X-Total-Count`.
  Tenant and department scoping apply before counting. Lists page in SQL for organization-scope roles and filter-then-page for department roles.
  `GET /api/partner-evaluations` accepts the same parameters (filters `partner_id`, `final_evaluation`).
  Filters: contracts `status`, `status_approval`, `document_type`, `partner_id`, `internal_pic`, `end_from`, `end_to`; partners `internal_pic`,
  `partner_type`, `status_dd`, `country`; orders `status`, `partner_id`, `contract_id`; spendings `payment_status`, `vendor_id`, `currency`.
- `GET /api/search?q=&type=&limit=` runs in SQL, reads the matching records of each type in one query, and returns only records the caller may see.
- Migration `0008_search_trigram` creates the `pg_trgm` extension (if the database user is allowed to) and a GIN index on the search text. If the
  extension cannot be created the migration still succeeds and search uses a sequential scan; ask a database administrator to run
  `CREATE EXTENSION pg_trgm;` and `npm run migrate` again to get the index.

### Aggregates, list parameters added for the screens, and the PDF worker (Phase 2C)

- `GET /api/aggregates/dashboard|badges|facets|partners` are read-only SQL roll-ups for the caller's organization and, for department roles, the
  records their departments own (`final_only=1` additionally applies the viewer rule: final contracts only). `/aggregates/partners` takes the
  `/api/partners` list parameters and adds contract/order/spending/evaluation figures per partner of the page.
- The list endpoints gained filters and sorts (additive): contracts `category`, `parent_contract_id`, `window_from`/`window_to` (records that start, end or fall due inside the window)
  and the sort keys `partner_name`, `contract_value_usd`, `document_type`, `file`; partners `partner_status=Active|Inactive`, `exclude_country`,
  `deep=1` (also matches the numbers and titles of the partner's contracts and orders) and the sorts `codename`, `pic_name`, `partner_status`;
  orders `pricing_model`, `charging_type`, `window_from`/`window_to` and more sorts; spendings `year`, `month`, `vendor_name` and more sorts. Contract
  and order rows carry `partner_name`, partner rows `active_contract_count`. A caller that sends none of the new parameters gets the earlier answers.
  `sort=default` (contracts, partners, orders, spendings, evaluations) means the record order of the unpaged lists, newest first; the screens request it
  until the user picks a column. Paged requests without any `sort` keep their earlier defaults (orders by end date, partners by name, ...).
- Migration `0016_upload_owner_trigram` adds pg_trgm GIN indexes on `contracts(contract_file_link)`, `(termination_document)` and `(extra_json)` for
  the upload-owner lookup of files that have no ownership row yet. Like `0008` it succeeds without the extension (the lookup then scans).
- PDF inspection and slimming (`pdf-parse`, `pdf-lib`) run in worker threads when `dist/pdfWorker.cjs` is deployed next to `server.cjs` (it is built by
  `npm run build`): `PDF_WORKER_THREADS` (default 2, at most 8), `PDF_WORKER=off` to run inline, `PDF_WORKER_FILE` to point at another file. A worker
  that crashes or exceeds two minutes is replaced and that file is processed inline, so an upload never fails because of the worker. Without the file
  (development with `tsx`, tests) everything runs inline as before.

### Phase 3 background jobs and integrations

All Phase 3 passes follow `REMINDER_SCHEDULER_ENABLED` (off under `APP_TEST_MODE`), run under their own PostgreSQL advisory lock (one instance at a time) and are idempotent through ledgers/claims.

| Setting | Default | Meaning |
| --- | --- | --- |
| `EXPORT_TTL_HOURS` | `24` | How long a finished tenant export can be downloaded; afterwards the job is `expired` and its chunks are deleted. |
| `EXPORT_MAX_MB` | `1024` | A tenant export larger than this fails (`EXPORT_TOO_LARGE`); retry without files. The ZIP is stored in `export_job_chunks` (PostgreSQL), so size it against your database. |
| `WEBHOOK_ALLOW_HTTP`, `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | unset | **Development only.** Allow plain-http webhook URLs / private and loopback destinations (the SSRF guard is otherwise always on). A warning is logged when set in production. |
| `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS` | `10000`, `8` | Per-request timeout and attempts before a delivery is dead-lettered (backoff 30 s doubling to 6 h). |
| `SIGNATURE_MAX_FILE_BYTES` | `15728640` (15 MB) | Largest signed copy or evidence file accepted by the e-signature screens and the inbound signing webhook (1 KiB to 25 MB; the request body limit stays 25 MB). |
| `OBLIGATION_LEAD_DAYS` | `7` | Default reminder lead time (0 to 365) for organizations that did not set one. |
| `API_RATE_LIMIT_PER_MINUTE` | `600` | Default per-key limit of the public API when a key does not set its own (in memory per process). |

Public API: see [API.md](API.md). Keys are organization-scoped and stored hashed; revoking a key takes effect on the next request. The in-memory limiters are per process.

Webhooks: see [WEBHOOKS.md](WEBHOOKS.md). The delivery pass runs every 15 s (and right after an event is queued) under its own advisory lock; the delivery log is `webhook_deliveries`.

Approval e-mails and SLA: each organization sets its SLA (hours, default 48 as before) and the escalation target in Settings > Data & automation (`approval_settings`). A five-minute advisory-locked pass computes the reminder at 80% of the SLA and the breach escalation (to the organization admins, or the next approver, plus the delayed approver) and delivers the e-mails through the platform SMTP relay and the editable mail templates (`approval-requested`, `approval-decided`, `approval-reminder`, `approval-escalation`; text in the organization language). The ledger is `approval_notices` (unique per request, step, kind and recipient: nothing is sent twice; retries back off like the reminder ledger, then dead-letter). Notices are skipped, not retried, while the SMTP relay is off; the in-app entries (`user_notifications`, shown at the top of My Approval) are written regardless. After upgrading, approvals that are already pending and past 80% or past their deadline get their reminder/escalation at the first pass.

Digest e-mails: members opt in on the Notifications page (daily or weekly, with a preview), and an organization admin can set a default in Settings > Data & automation (off unless enabled; weekday and hour in the organization time zone). A 15-minute advisory-locked pass writes one `digest_ledger` row per member, frequency and period (unique key: a digest goes out at most once per period, whichever instance or pass gets there; a choice made after a period's send time starts with the next period) and delivers them through the SMTP relay and the `digest` mail template. A digest with nothing in it is not sent. The content is built with the member's own role and department scope. Every e-mail carries a signed one-click unsubscribe link (`GET`/`POST /api/digest/unsubscribe?token=...`, HMAC keyed from `BETTER_AUTH_SECRET`, no expiry) and `List-Unsubscribe` headers; changing `BETTER_AUTH_SECRET` invalidates links already sent.

Obligations and key dates: migration `0022_obligations` adds `obligations` (tenant-scoped, `version` column, foreign keys with `ON DELETE CASCADE` to the contract, order or partner it hangs on and to the organization), `obligation_settings` (the organization's reminder lead time) and `obligation_notices` (the reminder ledger). A 15-minute advisory-locked pass (`OBLIGATION_LOCK_KEY`) raises one `due_soon` event when an open obligation comes within its lead time (its own `lead_days`, else the organization setting in the Obligations page > Reminders, else `OBLIGATION_LEAD_DAYS`, default 7) and one `overdue` event once the date has passed; each claims the due date in `last_due_soon_cycle` / `last_overdue_cycle` (so a second pass or instance raises nothing), queues the `obligation.due_soon` / `obligation.overdue` webhook and, per recipient, one ledger row with an in-app entry in one transaction. Recipients are the responsible person or, when nobody is assigned, the organization admins and managers. E-mail uses the editable `obligation-reminder` template (skipped while the SMTP relay is off; retried with backoff, then dead-lettered). Completing a recurring obligation (monthly, quarterly, yearly, every N days) records the completion and moves `due_date` to the next occurrence. `POST /api/cron/trigger-check` runs this pass on demand next to the reminder pass. Department roles see the obligations of records their departments own, plus those assigned to them. Integrations: the webhook events `obligation.created`, `obligation.due_soon`, `obligation.overdue`, `obligation.completed` and the read-only public API resource `/api/v1/obligations` (API-key scope `obligations:read`; see API.md and WEBHOOKS.md, which are kept locally).

AI extraction and the review queue: migration `0023_ai_suggestions` adds `ai_suggestions` (the review queue) and `contract_key_terms` (key clauses a person accepted). `POST /api/contracts/:id/extract` (permission `document.edit`; a PDF with a text layer, a text file, pasted text, or the file stored with the contract) makes ONE bounded call through the shared AI wrapper (so the per-organization `AI_ORG_*` limits and token accounting apply, and a disabled `aiAssistant` module refuses it) and queues pending suggestions: obligations / key dates and key clauses, each with its source quote, page, confidence and a flag saying whether the quote was found in the document text. Nothing becomes an obligation or key term until a person accepts it (`POST /api/suggestions/:id/accept`, with optional edits; a suggestion is decided once, under a row lock; the obligation gets `source = ai_extracted`, the quote, page, confidence, `confirmed_by` and `confirmed_at`). The document text is wrapped in per-request random boundary lines and treated as data (the prompt says so, boundary-like sequences are removed from it, the size is bounded), and the answer is parsed as JSON and validated item by item (unknown keys, types and shapes are dropped; strings are clipped). `POST /api/contracts/parse` additionally returns `data.provenance` (field -> quote, page, confidence, verified) for the fields the model could support with a quote. Scanned PDFs without a text layer are refused unless the contract parser has read them before (its transcript is reused).
AI provider (bring your own key): `/sys` → AI Model picks Gemini, OpenAI, Anthropic or a custom OpenAI-compatible endpoint, with the key (sealed like the other provider secrets), the base URL for custom endpoints and the model (fetched from the provider, or typed by hand). `aiProviders.ts` translates the Gemini-shaped requests every feature builds into OpenAI/Anthropic calls, so features do not change with the provider. PDFs and images go to Gemini, OpenAI and Anthropic as files; a custom endpoint accepts images only and refuses PDFs with a clear message. The news ticker's web search is Gemini only. There is no cross-provider fallback: other providers retry the same model once.

Tests and end-to-end suites never call Gemini: tests install a fake model with `setAiGenerator` (aiClient.ts) and the e2e suites start the server with `AI_FAKE_PROVIDER=true`; both are honored only under `APP_TEST_MODE=1`.

Clause library and playbook: migration `0024_clause_library` adds `clauses` (tenant-scoped, `version` column for optimistic concurrency, `starter_key` unique per organization where set; fallback texts, tags and playbook rules are JSON text). The library is reference data of the organization: everyone with `document.view` reads it, `document.edit` writes, `document.delete` deletes, and importing the starter set (Clause library > Import starter clauses, `POST /api/clauses/starter/import`) needs `tenant.settings.update`. Nothing is seeded automatically: the import is an explicit per-organization action, adds the baseline clauses plus the clauses of the organization's industry pack (`criticalClauses`, as required clauses detected by the words of their title) and never changes or replaces a clause that already exists (a clause keeps its `starter_key` when edited; a deleted starter clause can be imported again). `POST /api/playbook/check` compares editor text (or the file stored with a contract the caller may see) with the active clauses: the deterministic engine (`packages/shared/src/playbook.ts`: required/forbidden phrases, payment terms, liability cap, notice period, late-payment interest, contract term and custom `re:` patterns; regular expressions are restricted to a safe subset) always runs; `ai: true` adds the semantic check through the shared AI wrapper (per-organization budget, `AI_ORG_*` limits) and is advisory: the model only names library clauses and quotes the contract, the suggested wording always comes from the library, and quotes not found in the document are not shown. The check writes nothing; each run is logged (`PLAYBOOK_CHECK`). Read-only public API resource `/api/v1/clauses` (scope `clauses:read`). Tenant export (`clauses.json`) and organization reset cover the library.

AI chat retrieval: `POST /api/chat` no longer sends a ranked, truncated copy of the workspace. The question (plus the words of the last user messages, so follow-ups keep their subject) becomes a prefix full-text query (`to_tsquery('simple', ...)`, any word; Chinese text is matched by character pairs with `ILIKE`), and each kind of record is searched in SQL inside the caller's organization: workspace search records (contracts, partners, orders, invoices, evaluations), obligations, active clauses, accepted key terms and the text of editor documents. Migration `0025_retrieval_indexes` adds one GIN expression index per source (`idx_retrieval_fts_*`, on `to_tsvector('simple', <text>)`; no column is added and no table is rewritten, creation takes a lock proportional to the table size, `contract_documents` being the largest). The best records (default 10, at most 4 per kind, ranked by `ts_rank_cd`) are sent with a `ref` (S1, S2, ...), together with up to 5 contracts ending within 60 days and 5 open obligations due within 30 days, all trimmed to `AI_CHAT_CONTEXT_CHARS`. Department roles: every candidate is checked against the caller's departments before it is returned or counted, and further pages of candidates are read (3 pages of 25 per kind) so other departments' records neither leak nor crowd out the caller's own; obligations follow their contract/order/partner (or the responsible person), key terms their contract, clauses are organization reference data and editor documents are organization-wide like the document explorer. `record_counts` are totals for organization-wide roles and cover only contracts, partners and orders (what the caller may see) for department roles. Identifiers are masked as before (no contacts, tax or identity numbers; bank accounts show the last four digits; e-mail addresses and long digit sequences in document and note excerpts are replaced). The answer is `{ success, reply, sources }`, where `sources` lists every record the model was given (`ref`, `type`, `id`, `title`, `subtitle`, `tab`, `param`, `origin` = `match` or `upcoming`, `score`) and `cited` is true for those the reply names as `[S2]`; the widget shows the cited ones (else the best matches) as chips linking to `?tab=<tab>&<param>=<id>`. Per-organization AI budgets, the history cap (`AI_CHAT_HISTORY_MESSAGES`) and the test fake provider work as before. Limits: ranking scores every match of the organization before taking the top page, so extremely broad queries on very large organizations cost more; totals and sums over records that were not retrieved cannot be computed by the assistant (it is told so).

Tenant export (Settings > Data & automation, organization admins): `POST /api/organizations/:id/exports` queues a job, a pass in the same process starts it immediately, a one-minute pass picks up leftovers, fails jobs whose heartbeat stopped (instance died) and expires finished ones. At most one queued/running export per organization. Requesting, and downloading, are written to the audit log (`export.request`, `export.request.with_files`, `export.download`).

Single sign-on (OIDC): migration `0026_sso` adds `sso_providers` (one per organization, client secret sealed with the integration-credential key, so changing `BETTER_AUTH_SECRET` makes it unreadable and it must be re-entered), `sso_identities` (linked issuer/subject pairs) and `sso_login_states` (single-use, 10-minute login states; expired ones are deleted when a new login starts). Administrators configure it in Settings > Data & automation; members use `/sso/<organization-slug>` or "Continue with SSO" on the sign-in page. The redirect URI to register at the provider is `<public URL>/api/sso/callback` (the public URL configured at first run, or `BETTER_AUTH_URL`). Discovery, JWKS and token requests use the webhook SSRF guard (`WEBHOOK_ALLOW_HTTP` / `WEBHOOK_ALLOW_PRIVATE_NETWORKS` relax it for development only). "SSO required" blocks password and Google sign-in for the organization's members except platform superusers and the break-glass administrators chosen in the settings; if a provider is down and no break-glass administrator is available, a superuser can still sign in and remove the setting (`DELETE /api/organizations/:id/sso`). See [SSO.md](SSO.md).

E-signature: migration `0027_signatures` adds the request, signer, event, file, endpoint, idempotency-key and notice tables. A five-minute advisory-locked pass (`Signature expiry and notices`, lock key `0x4c475347`) expires open requests past their date, prunes idempotency keys older than 7 days and delivers the requester e-mails (template `signature-update`; skipped while the SMTP relay is off); `POST /api/cron/trigger-check` runs it on demand. Signed copies and evidence are stored through the object store with their ownership registered in `upload_owners`. Inbound deliveries are verified with an HMAC over the raw body (`POST /api/signatures/webhook/:endpointId`); the secret is sealed like the other credentials. Completion updates the contract (approval status, `signed_file_link`) and raises `signature.completed`; `signature.sent`, `signature.declined` and `signature.expired` exist too. See [SIGNATURES.md](SIGNATURES.md).

### Health endpoints

- `GET /api/health` is cheap liveness (process answers).
- `GET /api/health/ready` also runs `SELECT 1` on PostgreSQL: 200 when it answers, 503 when the database is unavailable (and 503 `DATABASE_REQUIRED` while the database onboarding step has not been completed). A fresh install that only lacks its first administrator is ready: the setup page must be reachable. Docker healthchecks and deploy checks use it.

### Plain HTTP, TLS and HSTS

Plain HTTP self-hosting works unchanged. nginx sends `Strict-Transport-Security` only on requests that arrived over TLS (directly, or via a TLS-terminating proxy that sets `X-Forwarded-Proto: https`). To terminate TLS in the bundled nginx, uncomment the sample `443` server block at the bottom of `apps/frontend/nginx.conf.template`, mount the certificate, and publish port 443. A `Content-Security-Policy-Report-Only` header is sent: check the browser console for violations, then rename it to `Content-Security-Policy` in `apps/frontend/nginx/security-headers.conf` to enforce.

### Behind a CDN or load balancer

nginx forwards its direct peer address as `X-Forwarded-For`/`X-Real-IP` (client-supplied values are ignored, so they cannot be spoofed). If another proxy sits in front of the container, every client appears as that proxy for rate limiting. Either accept that, or configure nginx's `real_ip` module with that proxy's addresses.

## Deploying

A safe deploy on the server, inside the checkout: note the current revision (`git rev-parse HEAD`), take a pre-deploy backup (below), fast-forward the branch, run `docker compose up -d --build`, and poll `/api/health/ready` until it answers 200 (allow a few minutes). If it does not, check out the noted revision and rebuild. Run lint, build and test before deploying.

Code rollback does not undo database migrations. If a release changed the schema in a way the old code cannot read, restore the pre-deploy backup (below) after rolling back.

Manual rollback: `git checkout <previous-rev> && docker compose up -d --build`.

## Backups

What has to be backed up, and where:

1. **PostgreSQL** (all application data): a `pg_dump` custom-format dump (below).
2. **Uploaded files** (your storage provider): enable **bucket versioning** (and ideally cross-region replication or a lifecycle rule for old versions) in the provider's console. Every provider you have configured holds files, so protect each of them. The app does not back these up. The optional Google Drive backup copies uploaded files only, not the database.
3. **`BETTER_AUTH_SECRET`** (`apps/backend/.env`): store it **separately from the database dump**, in a password manager or secrets vault. It encrypts the storage credentials stored in the database. A restored database with a different secret works, but the COS and Google credentials can no longer be decrypted and a superuser must enter them again in `/sys`. Do not store the secret next to the dumps.

### Taking a backup

```bash
mkdir -p backups && umask 077
docker compose exec -T postgres pg_dump -U legalio -Fc legalio > "backups/legalio-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_restore --list < backups/<that file>.dump > /dev/null   # verifies the dump
```

The dump is a `pg_dump` custom-format file. `backups/` is git-ignored; keep the files readable only by the owner and prune old ones (for example keep the newest 14). Copy them off the server (object storage, another host) because a backup on the same disk does not survive losing the server. Schedule it, for example with cron:

```cron
15 2 * * * cd /opt/legalio && docker compose exec -T postgres pg_dump -U legalio -Fc legalio > "backups/legalio-$(date -u +%Y%m%dT%H%M%SZ).dump" 2>> /var/log/legalio-backup.log
```

### Restoring

```bash
docker compose stop backend frontend         # nothing may write during the restore
docker compose exec -T postgres pg_restore --clean --if-exists --no-owner -U legalio -d legalio < backups/legalio-20260101T021500Z.dump
docker compose up -d
curl -fsS http://127.0.0.1:8080/api/health/ready
```

This replaces the database contents (`--clean --if-exists`). To restore onto a new server: install the same repository revision, set `POSTGRES_PASSWORD`, copy the saved `BETTER_AUTH_SECRET` into `apps/backend/.env` **before** the first start, `docker compose up -d postgres`, run the restore, then start the rest.

### Restore test (do this regularly, e.g. monthly)

A backup you have not restored is a hope, not a backup. Without touching production:

```bash
docker compose exec -T postgres createdb -U legalio legalio_restore_test
docker compose exec -T postgres pg_restore --no-owner --exit-on-error -U legalio -d legalio_restore_test < backups/<latest>.dump
docker compose exec -T postgres psql -U legalio -d legalio_restore_test -c 'SELECT count(*) FROM "user"'
docker compose exec -T postgres dropdb -U legalio legalio_restore_test
```

Confirm the row counts look right and that the application starts against the restored database with the saved `BETTER_AUTH_SECRET`.
