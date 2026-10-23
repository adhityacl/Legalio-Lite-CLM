# Operations runbook

For the Docker Compose install (`compose.yaml`): nginx (`frontend`), the API (`backend`) and PostgreSQL (`postgres`).

## First-run setup is open on purpose

A fresh install has no administrator, and the first visitor creates it on the setup page (`POST /api/system/setup`, accepted only while no superuser exists). This is intentional. **Complete the setup before the URL is reachable from the internet** (or keep the port bound to localhost / a private network until you have), because whoever reaches it first becomes the administrator. Setup refuses (409) once an administrator exists.

## Configuration that matters

| Setting | Where | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | root `.env` or shell | Required; Compose fails with a clear message without it. Only applied when the volume is first created. |
| `BETTER_AUTH_SECRET` | `apps/backend/.env` | Created by `npm run setup`. **Also encrypts the stored COS and Google credentials.** |
| `FRONTEND_BIND`, `FRONTEND_PORT` | root `.env` | Default `0.0.0.0:8080`. Use `127.0.0.1` behind a host reverse proxy. |
| `TRUST_PROXY` | root `.env` | Which hops may set `X-Forwarded-*` for the backend. Default: loopback and private ranges (the Docker network). A number means that many hops. |
| `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_DISABLED` | backend env | Limits on sign-in, Google sign-in, setup and cron endpoints (default 30 writes per client per 60 s). nginx adds its own 30 requests/min limit on the same paths. |

### Health endpoints

- `GET /api/health` is cheap liveness (process answers).
- `GET /api/health/ready` also runs `SELECT 1` on PostgreSQL: 200 when it answers, 503 when the database is unavailable (and 503 `DATABASE_REQUIRED` while the database onboarding step has not been completed). A fresh install that only lacks its first administrator is ready: the setup page must be reachable. Docker healthchecks and `scripts/deploy.sh` use it.

### Plain HTTP, TLS and HSTS

Plain HTTP self-hosting works unchanged. nginx sends `Strict-Transport-Security` only on requests that arrived over TLS (directly, or via a TLS-terminating proxy that sets `X-Forwarded-Proto: https`). To terminate TLS in the bundled nginx, uncomment the sample `443` server block at the bottom of `apps/frontend/nginx.conf.template`, mount the certificate, and publish port 443. A `Content-Security-Policy-Report-Only` header is sent: check the browser console for violations, then rename it to `Content-Security-Policy` in `apps/frontend/nginx/security-headers.conf` to enforce.

### Behind a CDN or load balancer

nginx forwards its direct peer address as `X-Forwarded-For`/`X-Real-IP` (client-supplied values are ignored, so they cannot be spoofed). If another proxy sits in front of the container, every client appears as that proxy for rate limiting. Either accept that, or configure nginx's `real_ip` module with that proxy's addresses.

## Deploying

`scripts/deploy.sh` (run on the server inside the checkout) records the current revision, takes a pre-deploy backup, fast-forwards the branch, runs `docker compose up -d --build`, polls `/api/health/ready` (up to `DEPLOY_TIMEOUT`, default 180 s), and on failure checks out the previous revision and rebuilds it. It exits non-zero when it had to roll back.

The GitHub `deploy.yml` workflow runs lint, build and test, and only then opens the SSH connection. The command the server runs for that connection is defined on the server (the key's `command=` restriction in `authorized_keys`, or the login shell); point it at `scripts/deploy.sh`. CI does not know that command, so verify it on the server.

Code rollback does not undo database migrations. If a release changed the schema in a way the old code cannot read, restore the pre-deploy backup (below) after rolling back.

Manual rollback: `git checkout <previous-rev> && docker compose up -d --build`.

## Backups

What has to be backed up, and where:

1. **PostgreSQL** (all application data): `scripts/backup.sh`.
2. **Uploaded files** (Tencent COS): enable **bucket versioning** (and ideally cross-region replication or a lifecycle rule for old versions) in the COS console. The app does not back these up. The optional Google Drive backup copies uploaded files only, not the database.
3. **`BETTER_AUTH_SECRET`** (`apps/backend/.env`): store it **separately from the database dump**, in a password manager or secrets vault. It encrypts the COS and Google credentials stored in the database. A restored database with a different secret works, but the COS and Google credentials can no longer be decrypted and a superuser must enter them again in `/sys`. Do not store the secret next to the dumps.

### Taking a backup

```bash
scripts/backup.sh                 # writes backups/legalio-<UTC timestamp>.dump, keeps the newest 14
BACKUP_DIR=/srv/backups BACKUP_RETENTION=30 scripts/backup.sh
```

The dump is a `pg_dump` custom-format file, verified with `pg_restore --list` when `pg_restore` is installed on the host. `backups/` is git-ignored and files are created `0600`. Copy them off the server (object storage, another host) because a backup on the same disk does not survive losing the server. Schedule it, for example with cron:

```cron
15 2 * * * cd /opt/legalio && scripts/backup.sh >> /var/log/legalio-backup.log 2>&1
```

### Restoring

```bash
docker compose stop backend frontend         # nothing may write during the restore
scripts/restore.sh backups/legalio-20260101T021500Z.dump      # asks you to type "restore"
docker compose up -d
curl -fsS http://127.0.0.1:8080/api/health/ready
```

`restore.sh` replaces the database contents (`pg_restore --clean --if-exists`). To restore onto a new server: install the same repository revision, set `POSTGRES_PASSWORD`, copy the saved `BETTER_AUTH_SECRET` into `apps/backend/.env` **before** the first start, `docker compose up -d postgres`, run the restore, then start the rest.

### Restore test (do this regularly, e.g. monthly)

A backup you have not restored is a hope, not a backup. Without touching production:

```bash
docker compose exec -T postgres createdb -U legalio legalio_restore_test
docker compose exec -T postgres pg_restore --no-owner --exit-on-error -U legalio -d legalio_restore_test < backups/<latest>.dump
docker compose exec -T postgres psql -U legalio -d legalio_restore_test -c 'SELECT count(*) FROM "user"'
docker compose exec -T postgres dropdb -U legalio legalio_restore_test
```

(`scripts/restore.sh` with `RESTORE_DATABASE_URL=...` does the same from the host when `pg_restore` is installed and the database is reachable.) Confirm the row counts look right and that the application starts against the restored database with the saved `BETTER_AUTH_SECRET`.
