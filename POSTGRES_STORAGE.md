# PostgreSQL and Tencent COS storage

Legalio stores all records in PostgreSQL 14 or newer and all uploaded files in a Tencent COS bucket. There is no local-disk or SQLite fallback.

## Database connection

The backend picks its connection in this order:

1. `DATABASE_URL` in the environment (Docker Compose sets it for the bundled `postgres` service).
2. `APP_DATA_DIR/database.json`, written by the onboarding form with mode `0600`. It is written only after the connection works and the schema has been created.
3. Neither: the first visit shows the "Connect PostgreSQL" form. It is available only while no connection is configured.

If a connection is configured but the database is unreachable at startup, the process exits with code 1 (Docker restarts it). It never falls back to the form, so nobody can point a running installation at another database while it is down.

The schema is managed by versioned migrations (`apps/backend/src/migrate.ts`, `apps/backend/src/migrations/`). On every boot `ensureSchema()` applies the pending migrations in order, each in one transaction together with its row in `schema_migrations`, under a PostgreSQL advisory lock so concurrent boots apply each exactly once. `0001_baseline` is the whole pre-migration schema written idempotently (better-auth migrations first, then the application tables), so an existing database adopts it without change; later numbered migrations hold the Phase 1 additions. To change the schema, add the next numbered file to `migrations/` and list it in `migrations/index.ts`; never edit an applied one. `npm run migrate` applies them standalone (production image: `node apps/backend/dist/migrate.cjs`) and `npm run migrate:status` lists them (exit code 1 while any is pending). `schema_migrations` also holds one-time data backfill markers (`uploads-ownership-backfill-v1`, `reminder-ledger-seed-v1`) written by the application; they are not migrations and are ignored by the runner. An empty database is treated as a fresh installation: setup, then the demo workspace.

Workspace search uses `ILIKE` over the `search_records` table. It does not fold accents and does not use an index, which is enough for vendor names; the upgrade path is `pg_trgm` or `tsvector`.

## File storage (Tencent COS)

The bucket, region, optional prefix and keys are entered during setup or later in `/sys`. Before saving, the app writes, reads back and deletes a probe object `<prefix>.legalio-probe-<uuid>`.

Upload links keep the `/uploads/...` form. Each link maps to the object key `<prefix><Org>/<Partner>/<Folder…>/<file>`. Files are served only through the backend, after the same permission checks as before.

An application reset deletes every object under the prefix, one request per object. Use a dedicated bucket or prefix for each installation.

The Google Drive backup index (which stored objects were already mirrored, by ETag) is the table `drive_backup_index`. An existing `APP_DATA_DIR/drive-backup.json` is imported into it by the first backup pass and renamed to `drive-backup.json.imported`. The old `uploads.drive-backup.json` is no longer used.

## Credential encryption

Rows in `integration_credentials` (Google and COS) are encrypted with AES-256-GCM. The key is derived from `BETTER_AUTH_SECRET`. If that secret changes, the stored Google and COS credentials can no longer be read: startup logs the failure, and a superuser must enter them again in `/sys`. The COS `secretKey` is never returned by the API.

## Operations

- **Several instances may share one database.** Business data is read from and written to PostgreSQL per request (row-level, with optimistic concurrency); only configuration is cached per process and kept in step by `NOTIFY` plus a 30-second reload. Details, the tested guarantees and the exact list of what is still per process (rate limiters, concurrent edits of different configuration sections, the Drive backup debounce queue) are in [docs/ARCHITECTURE-persistence.md](docs/ARCHITECTURE-persistence.md). Do not run an old (snapshot) release and a current one at the same time against one database.
- **Backups:** run `scripts/backup.sh` (pg_dump custom format, timestamped, with retention) and `scripts/restore.sh`, and enable versioning on the COS bucket for files. Back up `BETTER_AUTH_SECRET` separately. See [docs/RUNBOOK.md](docs/RUNBOOK.md). The optional Google Drive backup copies uploaded files only, not the database.
- **Old SQLite data is not imported.** Do not delete `/data/kaelyn.db` on existing servers; it is the archive of the old SQLite installation.

## Verification

- `npm test`: unit tests against a running PostgreSQL (`TEST_DATABASE_URL`, default `postgres://legalio:legalio@127.0.0.1:5432/legalio`). Each run creates and drops its own `legalio_test_*` database.
- `npm run build:sys`, then `npm run test:e2e:postgres` and `npm run test:e2e:data-entry`: real HTTP and Chromium checks against an isolated test database and an in-memory object store. They need Playwright Chromium.


## Repository-backed persistence (Phase 2)

Partners, contracts, insertion orders, spendings, evaluations, notifications, templates and the legacy allowlist are read and written row by
row by `apps/backend/src/repositories/*`, each with an optimistic-concurrency `version` column (additive migrations `0007`, `0009` .. `0014`;
existing rows are adopted in place at version 1, templates keep their own version). The in-memory snapshot holds installation configuration
only, and its save no longer touches or deletes any business row. See `docs/ARCHITECTURE-persistence.md`.
