# Persistence architecture

Business data is persisted by one **repository per entity**; the in-memory projection (`memoryDb.ts`) holds only installation
configuration and derived caches. Several backend instances can therefore run against one database (see "Running several instances").

## What the process keeps in memory

`db` in `memoryDb.ts` holds: `branding`, `googleConfig` (Google/SMTP/AI settings; secrets are sealed at rest), `newsTicker` and `tenants` (a
read-only projection of the organizations' policy, rebuilt from `organization` / `organization_settings` / `organization_integrations`).
`db.partners`, `db.contracts`, `db.ios`, `db.spendings`, `db.evaluations`, `db.notifications` and `db.templates` throw on access. The
credentials store (`googleCredentialStore.ts`) mirrors `integration_credentials` for the same reason (synchronous reads). Everything else
-- partners, contracts, orders, spendings, evaluations, notifications, templates, the legacy allowlist (`allowed_users`), activity,
audit, reminders, AI usage, mail templates, the Drive backup index -- is read from and written to PostgreSQL per request.

The core saver (`coreDataStore.ts`) persists only `branding`, `google_config` and `news_ticker`: three single rows, written with
`IS DISTINCT FROM`, serialized per process (`saveDb`). It never touches a business table and deletes nothing.

## Repository per entity

`src/repositories/` holds one repository per entity. A repository:

* reads and writes **explicit rows** by organization and id, each write in its own transaction (or the caller's ambient one, as a savepoint);
* uses the `version` column for **optimistic concurrency**: `UPDATE ... WHERE version = $expected` affects zero rows when someone else wrote first,
  and the repository throws `VersionConflictError` (HTTP **409** `VERSION_CONFLICT`, unified error body);
* never relies on absence: nothing is deleted because a row is missing somewhere in memory. Every entity is marked `repository: true` in
  `normalizedSchema.ts`;
* keeps the table layout, column mapping, child tables and `search_records` entry of the previous (snapshot) format (`normalizedCoreStore`
  encode/decode are shared), so existing rows are adopted by an additive migration without copying.

| File | Role |
| --- | --- |
| `repositories/entityRepository.ts` | Generic `get/getMany/insert/update/mutate/remove/removeOrganization/removeAll/batches` for any normalized table |
| `repositories/contractRepository.ts` | Contracts: paged/filtered `list`, `findByNumber` (advisory-locked uniqueness), `removeWithChildren`, `removeByPartner`, scope `directory`, ... |
| `repositories/partnerRepository.ts` | Partners: paged/filtered `list`, `findByName`, `findByIdOrName`, scope `directory`, `departmentReferenced` |
| `repositories/ioRepository.ts` | Insertion orders: list (searches the parent contract number), number uniqueness, `detachContract`, `removeMany`, scope `directory` |
| `repositories/spendingRepository.ts` | Spendings: list (USD amount sorts numerically), `findDuplicate`, `detachVendor`, `currencies` |
| `repositories/evaluationRepository.ts` | Evaluations: list, `findDuplicate`, `detachPartner` |
| `repositories/notificationRepository.ts` | Notifications: set-based `markRead` / `markSent` / `removeMany` / `removeByParents` |
| `repositories/templateRepository.ts` | Templates: the template's own `version` (+1 per save) is the concurrency token |
| `repositories/allowedUserRepository.ts` | Legacy allowlist (`allowed_users`, JSON payload): unique e-mail, "at least one Admin" rule under an advisory lock |
| `repositories/scopeDirectory.ts` | Narrow partner / contract / order columns that department scoping needs (department roles only) |
| `repositories/seed.ts` | `insertRepositoryRows` / `clearRepositoryRows`: whole datasets (demo workspace, application reset, fixtures) |
| `repositories/errors.ts` | `VersionConflictError` (409), `DuplicateValueError` (409), `RecordNotFoundError` (404) |
| `migrations/0007`, `0009` .. `0014` | `version` columns (additive; existing rows start at 1, templates keep their own version) and lookup indexes |

### Semantics worth knowing

* **Version**: the API returns `version` on every record. `PUT` accepts `version` in the body or `If-Match`; a stale value is a 409. A client that
  sends none is protected for the duration of its own request (the version read at the start is the expected one). Templates are saved with
  `POST /api/templates` (+ `id`, optional `version`).
* **Server-side derived writes** (AI review results, lifecycle/status refresh, Drive folder links, due-diligence uploads, legacy normalization) use
  `mutate`: the row is locked and edited as it is *now*, so they neither fail on nor overwrite a user's concurrent edit. A pure display refresh
  (status, days_remaining) keeps the version.
* **Cascades are transactions**: deleting a partner (partner row locked first) removes its contracts, orders and notifications and detaches
  invoices and evaluations in one `sql.tx`; deleting a contract removes its notifications and detaches its orders; the organization reset empties every
  repository table of the organization in one transaction; reminders write the ledger entry and the notification together.
* **Department scoping** needs partners, contracts and orders of the organization: the authorization middleware loads the narrow directory
  (`scopeCollectionsFor`) only for department-scoped roles. Organization-scope roles never query it.
* **Upload ownership** is a SQL lookup on the link columns (and the due-diligence child tables), confirmed on the hydrated record.
* **Lists**: every list endpoint returns the bare array unless `limit/offset/q/sort` or a filter is given; then the page is cut in SQL
  (department roles: filtered after the match, then paged) and `X-Total-Count` carries the total.

## Recipe: adding the next entity

1. Add a numbered migration `ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1` (+ indexes for the list filters).
2. `createXRepository(db)` on top of `createEntityRepository(db, table)`: entity-specific `list(org, query)`, uniqueness checks inside `beforeWrite`.
3. Mark the entity `repository: true` in `normalizedSchema.ts`, add `repositoryBacked(...)` in `memoryDb.ts`, and seed through `insertRepositoryRows`.
4. Convert every reader/writer (`grep -rn "db\.<collection>"`): lookups become `repository.get(org, id)`, writes `insert/update(row, version)`;
   anything that must be atomic with other tables goes into one `sql.tx`.
5. Tests on real PostgreSQL: add the entity to `SPECS` in `entityRepositories.test.ts` (race -> one winner and a 409, parallel rows, locked `mutate`,
   cascade, snapshot-no-touch), to `PERSISTED_ENTITIES` in `routeIsolation.test.ts` (HTTP races) and to the fixture in `legacyAdoption.test.ts`.

## Running several instances

Verified by `multiInstance.test.ts` (two real server processes, one database): unique ids under concurrent creates, one winner and a 409 on a
same-row race, contract numbers unique across instances, reminders produced once, an allowlist entry / branding / an organization's name
changed on one instance visible on the other.

What makes it safe:

* no business data in memory; every write is a row-level statement guarded by a version or a lock;
* ids come from PostgreSQL sequences; uniqueness rules (contract / order number, allowlist e-mail) take advisory locks inside the write transaction;
* reminders: one pass at a time (`pg_try_advisory_lock`), ledger `ON CONFLICT DO NOTHING`, notification inserted in the same transaction;
* startup: migrations, then the seeding and one-time data repairs under a startup advisory lock (a second instance waits, then finds nothing to do);
* Drive backup: one pass at a time (advisory lock) and the "already mirrored" index in `drive_backup_index` instead of a local file;
* the in-memory parts above are registered in `sharedState.ts`: a change calls `pg_notify('legalio_shared_state', ...)`, the other instances reload
  that part immediately (a dedicated `LISTEN` connection), and every `SHARED_STATE_POLL_MS` (30 s) they reload anyway. A configuration reload never
  replaces a copy that has an unsaved local change in flight.

What is still per process (exact list):

* the three configuration rows are saved as a whole by the instance that changes them: two administrators saving *different* configuration
  sections at the same moment on two instances can lose one of the two edits (last writer wins; configuration changes are rare, platform-administrator only);
* request rate limiters (`express-rate-limit`, Better Auth's limiter and the per-organization AI calls-per-minute window) count per process, so N
  instances allow up to N times the configured rate (the AI *daily* budget is in the database and exact);
* a few caches are refreshed by TTL only: `lifecyclesFreshUntil` (status refresh at most once a minute per instance, harmless) and the public URL
  (`installation_settings`, changed only during first-run setup, needs a restart elsewhere);
* the debounce queue of the Drive backup (`pendingDriveBackups`) lives in memory: a restart loses the queued keys, the next full pass mirrors them;
* the process-wide `saveDb` lock serializes configuration saves inside one process only (it does not guard the database across processes);
* the pool keeps one connection for the shared-state listener (`DB_POOL_MAX` is shared with requests).

## Tests that guard this

| Command | What it covers |
| --- | --- |
| `npm test` | Unit and PostgreSQL tests (needs `TEST_DATABASE_URL`, a role that may create `legalio_test_*` databases): repositories, concurrency (409), snapshot isolation, legacy-format adoption of every entity, paging/search/scoping, search index, two server processes on one database (`multiInstance.test.ts`), API client, mutation hooks, route gate |
| `npm run test:e2e:postgres`, `npm run test:e2e:data-entry` | Real server + Chromium over the whole application |
| `npm run test:e2e:smoke` | Sign in, list, deep-link open, create and edit a contract through the form, workspace search, axe-core on sign-in, contract list, contract form and dashboard (serious/critical fail, the rest is printed) |

Playwright needs Chromium: set `PLAYWRIGHT_BROWSERS_PATH` to a directory that holds it.
