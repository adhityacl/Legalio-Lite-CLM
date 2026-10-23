# PostgreSQL and Tencent COS storage

Legalio stores all records in PostgreSQL 14 or newer and all uploaded files in a Tencent COS bucket. There is no local-disk or SQLite fallback.

## Database connection

The backend picks its connection in this order:

1. `DATABASE_URL` in the environment (Docker Compose sets it for the bundled `postgres` service).
2. `APP_DATA_DIR/database.json`, written by the onboarding form with mode `0600`. It is written only after the connection works and the schema has been created.
3. Neither: the first visit shows the "Connect PostgreSQL" form. It is available only while no connection is configured.

If a connection is configured but the database is unreachable at startup, the process exits with code 1 (Docker restarts it). It never falls back to the form, so nobody can point a running installation at another database while it is down.

The schema is created on every boot by `ensureSchema()`: the better-auth migrations first, then the application tables. Every statement is idempotent. An empty database is treated as a fresh installation: setup, then the demo workspace.

Workspace search uses `ILIKE` over the `search_records` table. It does not fold accents and does not use an index, which is enough for vendor names; the upgrade path is `pg_trgm` or `tsvector`.

## File storage (Tencent COS)

The bucket, region, optional prefix and keys are entered during setup or later in `/sys`. Before saving, the app writes, reads back and deletes a probe object `<prefix>.legalio-probe-<uuid>`.

Upload links keep the `/uploads/...` form. Each link maps to the object key `<prefix><Org>/<Partner>/<Folder…>/<file>`. Files are served only through the backend, after the same permission checks as before.

An application reset deletes every object under the prefix, one request per object. Use a dedicated bucket or prefix for each installation.

The Google Drive backup index is kept in `APP_DATA_DIR/drive-backup.json`. The old `uploads.drive-backup.json` is no longer used.

## Credential encryption

Rows in `integration_credentials` (Google and COS) are encrypted with AES-256-GCM. The key is derived from `BETTER_AUTH_SECRET`. If that secret changes, the stored Google and COS credentials can no longer be read: startup logs the failure, and a superuser must enter them again in `/sys`. The COS `secretKey` is never returned by the API.

## Operations

- **Run one instance only.** The backend keeps an in-memory copy of the workspace and caches credentials per process. Do not run two backends against the same database.
- **Backups:** use `pg_dump` for the database, for example `docker compose exec postgres pg_dump -U legalio legalio > legalio.sql`, and enable versioning on the COS bucket for files. The optional Google Drive backup copies uploaded files only, not the database.
- **Old SQLite data is not imported.** Do not delete `/data/kaelyn.db` on existing servers; it is the archive of the old SQLite installation.

## Verification

- `npm test`: unit tests against a running PostgreSQL (`TEST_DATABASE_URL`, default `postgres://legalio:legalio@127.0.0.1:5432/legalio`). Each run creates and drops its own `legalio_test_*` database.
- `npm run build:sys`, then `npm run test:e2e:postgres` and `npm run test:e2e:data-entry`: real HTTP and Chromium checks against an isolated test database and an in-memory object store. They need Playwright Chromium.
