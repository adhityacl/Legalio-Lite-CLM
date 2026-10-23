# Persistence architecture

Two persistence styles coexist while the move from "everything in one in-memory snapshot" to one repository per entity is finished.

## 1. Snapshot (legacy, still used by most entities)

`memoryDb.ts` keeps `db.partners`, `db.ios`, `db.spendings`, `db.evaluations`, `db.notifications`, `db.templates` and platform configuration in
one object. Every `saveDb()` snapshots it, fingerprints every row, upserts the changed ones and **deletes stored rows that are missing from
memory**, under one process-wide lock (`coreDataStore.createCoreSaver`, `normalizedCoreStore.synchronizeBusinessRows`). Consequences: all
tenants' rows are loaded at boot, a save costs O(all rows), another instance's writes are invisible until restart, and a bug that drops a row from
memory deletes it from the database.

## 2. Repository per entity (contracts are converted)

`src/repositories/` holds one repository per converted entity. A repository:

* reads and writes **explicit rows** by organization and id, each write in its own transaction (or the caller's ambient one, as a savepoint);
* uses the `version` column for **optimistic concurrency**: `UPDATE ... WHERE version = $expected` affects zero rows when someone else wrote first,
  and the repository throws `VersionConflictError` (HTTP **409** `VERSION_CONFLICT`, unified error body);
* never relies on absence: **delete-by-absence does not apply**. The entity is marked `repository: true` in `normalizedSchema.ts`, which makes the
  snapshot sync skip it entirely (not loaded into `db`, not fingerprinted, not written, not deleted) and removes it from `PERSISTED`;
* keeps the table layout, column mapping, child tables and `search_records` entry of the snapshot format (`normalizedCoreStore` encode/decode are
  shared), so existing rows are adopted without copying.

Files:

| File | Role |
| --- | --- |
| `repositories/entityRepository.ts` | Generic `get/getMany/insert/update/remove/removeOrganization/removeAll/batches` for any normalized table |
| `repositories/contractRepository.ts` | Contracts: paged/filtered `list`, `findByNumber` (case-insensitive, serialized by an advisory lock), `mutate` (row-locked server-side edit), `removeWithChildren`, `removeByPartner`, `directory`, `labels`, ... |
| `repositories/errors.ts` | `VersionConflictError` (409), `DuplicateValueError` (409), `RecordNotFoundError` (404); `logger.errorResponder` answers them with their own code/message |
| `migrations/0007_contract_versions.ts` | `contracts.version integer NOT NULL DEFAULT 1` plus lookup indexes (additive) |

### Semantics worth knowing

* **Version**: the API returns `version` on every contract. `PUT /api/contracts/:id` accepts `version` in the body or `If-Match`; a stale value is
  a 409. A client that sends none is protected for the duration of its own request (the version read at the start is the expected one).
* **Server-side derived writes** (AI redline result, lifecycle/status refresh, legacy normalization) use `mutate`: the row is locked and edited
  as it is *now*, so they neither fail on nor overwrite a user's concurrent edit. A pure display refresh (status, days_remaining) keeps the version.
* **Cross-store atomicity**: operations that touch both a repository table and snapshot entities run through `saveDb(alongside)`, which executes the
  repository call in the same transaction as the snapshot sync (contract delete + orders/notifications cleanup, partner delete + its contracts,
  organization reset, application reset, demo seeding). Foreign keys are deferred, so statements may come in any order inside that transaction.
* **Department scoping** needs the contract of an order or notification: the authorization middleware loads a narrow *contract directory*
  (`contract_id, partner_id, internal_pic`) into `req.contractDirectory`, only for department-scoped roles.
* **Upload ownership** of contract files is found with a `LIKE` on the file name, then confirmed exactly (`uploadStorage.contractOwners`).
* `db.contracts` throws on access; code that still touches it fails loudly instead of reading an empty list.

## Recipe: converting the next entity (partners, IOs, spendings, evaluations)

1. Add a numbered migration `ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1` (+ indexes for the list filters).
2. `createXRepository(db)` on top of `createEntityRepository(db, table)`: entity-specific `list(org, query)`, uniqueness checks inside `beforeWrite`.
3. Mark the entity `repository: true` in `normalizedSchema.ts`; remove its collection from `loadCoreData`, add a throwing accessor in `memoryDb.ts`
   (`repositoryBacked('partners', ...)`), and from the seed in `server.ts` (insert the seed through the repository in the first `saveDb(alongside)`).
4. Convert every reader/writer (`grep -rn "db\.<collection>"`): lookups become `repository.get(org, id)`, writes `insert/update(row, version)`;
   anything that must stay atomic with snapshot entities goes through `saveDb(() => repository...)`.
5. Anything that resolved relations from memory (`recordScope`, `ids.idTaken`, reminders, bulk import, uploads, exchange rates, org reset/delete checks)
   needs a repository query; `scopeCollectionsOf(req)` is where department scoping gets its collections.
6. Tests on real PostgreSQL: same-row race -> exactly one winner and a 409; different rows proceed; the snapshot sync leaves the table untouched;
   a database in the old format is adopted by the migration (see `contractRepository.test.ts`).

### Remaining on the snapshot

`partners`, `ios` (insertion orders), `spendings`, `evaluations`, `notifications`, `templates`, `allowed_users`, branding/google config/news ticker.
Partners are the natural next step because contracts, orders, spendings and evaluations reference them and department scoping reads them
(`db.partners` in `recordScope`/`recordAccess`).

## Tests that guard this

| Command | What it covers |
| --- | --- |
| `npm test` | Unit and PostgreSQL tests (needs `TEST_DATABASE_URL`, a role that may create `legalio_test_*` databases): repository, concurrency (409), snapshot isolation, legacy-format adoption, paging/search/scoping, search index, API client, mutation hooks, route gate |
| `npm run test:e2e:postgres`, `npm run test:e2e:data-entry` | Real server + Chromium over the whole application |
| `npm run test:e2e:smoke` | Sign in, list, deep-link open, create and edit a contract through the form, workspace search, axe-core on sign-in, contract list, contract form and dashboard (serious/critical fail, the rest is printed) |

Playwright needs Chromium: set `PLAYWRIGHT_BROWSERS_PATH` to a directory that holds it.
