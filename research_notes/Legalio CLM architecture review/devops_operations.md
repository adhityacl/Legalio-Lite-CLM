# DevOps, Build, Deployment, Operations and Maintainability (Legalio CLM, branch PostgreSQL)

Method: direct file reading plus actually running `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit`, `npm outdated` on the checked-out state (Node v22.22.0, npm 10.9.4, local PostgreSQL 16 started with `trust` auth). Sources are local repo paths (no URLs); `file:line` given where known.

## 1. Build / monorepo and dependency health

### Takeaway
A clean, small npm-workspaces + Turborepo monorepo that installs, typechecks and builds green (lint 6/6 tasks, ~64s cold; build ~25s). Weak spots: no CI gate, `tsconfig` is non-strict, the test script is a hand-maintained file list, and `npm audit` reports 3 high-severity direct deps (dompurify, nodemailer, vite).

### Cited Findings
- Root `package.json`: npm workspaces `apps/*`, `packages/*`; `packageManager: npm@10.9.8`; `engines.node >=20.19.0`; `.nvmrc` contains only 3 bytes (a major version; value printed as "22"). Dockerfiles use `node:22-bookworm-slim`. Consistent. — `/package.json`, `/.nvmrc`
- Workspaces: apps `backend`, `frontend`; packages `shared`, `types`, `ui-components`, `platform-console`, `ts-config`. 679 packages installed via `npm ci` in 22s. — `/package.json`, `npm ci` run
- `turbo.json` defines only `build`, `lint`, `dev` tasks; there is NO `test` task, so tests are not cached/orchestrated by Turbo. `globalDependencies` points to `packages/ts-config/*.json` (exists). `build` env passthrough `VITE_*`. — `/turbo.json`
- `npm run lint` = `turbo run lint --concurrency=1 && tsc --noEmit`: it is only `tsc --noEmit` per package. There is NO ESLint/Prettier/Biome anywhere (no config files tracked). Result: all 6 tasks passed. — `/package.json`, run output
- Root `tsconfig.json` `include`s `tests/**`, `tools/**`, `playwright*.config.ts`, but those paths are gitignored and absent from the repo (`ls tests tools docs` -> not found). Harmless but misleading. — `/tsconfig.json`, `/.gitignore` section 10
- `packages/ts-config/base.json`: no `"strict"`, no `noImplicitAny`; `experimentalDecorators` on; `allowJs:false`. The handover itself admits "Tsconfig repo ini tidak strict, sehingga tsc tidak menangkap promise yang dipakai sebagai boolean... bypass otorisasi" and prescribes a manual out-of-repo `no-floating-promises` ESLint check (§7). — `/packages/ts-config/base.json`, `/HANDOVER_POSTGRESQL_COS.md` §2, §7
- `npm test` is a single `node --import tsx --test <23 explicitly listed files>`; new test files must be added by hand. 23 test files listed. Needs a live PostgreSQL (`TEST_DATABASE_URL`, default `postgres://legalio:legalio@127.0.0.1:5432/legalio`). — `/package.json`, `/POSTGRES_STORAGE.md`
- Test run result (with local PG16, `trust` auth): 78 tests, 76 pass, 2 fail in ~14s. Failures: #15 "test mode refuses databases outside legalio_test_*; testConnection checks credentials" ("Missing expected rejection") and #35 "a fresh install asks for PostgreSQL first and only saves a working connection" (expected 400, got 201). Both are consistent with my PG using passwordless `trust` auth (wrong-credential connection attempts succeeded), i.e. most likely an environment artifact, not a code bug; not independently verified against a password-auth server. — `npm test` run (`apps/backend/src/db.pg.test.ts`, `onboarding.test.ts` areas)
- E2E scripts (`test:e2e:postgres`, `test:e2e:data-entry`) need Playwright Chromium; not run. `scripts/check-invitation-ui.mjs` is a standalone Playwright script with mocked APIs and is not wired into any npm script or CI. — `/package.json`, `/scripts/check-invitation-ui.mjs`
- Scripts: `setup-env.mjs` (41 lines) copies `.env.example` to `apps/backend/.env` and generates a 32-byte hex `BETTER_AUTH_SECRET` on `postinstall`; sound design. Note it checks for a `replace-with-a-long-random-secret` placeholder that no longer appears in `.env.example` (the example now has an empty `BETTER_AUTH_SECRET=`); empty is also handled. `clean-build.mjs` removes dist dirs (does not clean `apps/backend/dist/console`'s sibling `packages/*/dist`, none exist). — `/scripts/setup-env.mjs`, `/scripts/clean-build.mjs`
- `postinstall` runs `setup-env.mjs` on every `npm install`, including inside Docker builds (`npm ci` in Dockerfiles), creating a throwaway `.env` in the build stage only (`.dockerignore` excludes `**/.env`). Side effect on install is surprising for CI but benign. — `/package.json`, `/.dockerignore`
- `npm audit` (online): 3 high, 0 critical: `dompurify <=3.4.16` (installed 3.2.6; XSS-related advisories GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f), `nodemailer <=10.0.9` (installed range ^9.0.5; 6 advisories incl. cross-tenant SMTP credential disclosure via DNS cache GHSA-6vj9-mwq6-2f5v, DoS ones), `vite <=6.4.3` (dev-server issues, plus launch-editor). Fix available via `npm audit fix`. Note `npm audit --offline` printed "found 0 vulnerabilities" with no node_modules/cache, which is a false negative; do not trust offline audit. — `npm audit --json` run
- `npm outdated`: many patch/minor lags (better-auth 1.7.5 vs 1.7.12, @better-auth/infra 0.4.9 vs 0.4.22, @google/genai 2.23.0 vs 2.31.0, tiptap 3.31.3 vs 3.32.0, docx 9.7.1 vs 9.14.0, dompurify 3.2.6 vs 3.4.17). Majors available: express 4.22.3 -> 5.3.0, dotenv 17 -> 18, vite plugin-react 5 -> 6, esbuild 0.25 -> 0.28, @types/node 22 -> 26. `typescript` pinned `~5.8.2`. — `npm outdated` run
- Frontend bundle: main chunk `index-*.js` 1.92 MB raw (574 KB gz / 429 KB brotli) plus a 1.09 MB `ContractDocumentEditor` chunk; compression plugin emits .gz/.br but the nginx template does not enable `gzip_static`/`brotli_static`, so pre-compressed files are not necessarily served. — `apps/frontend/dist/assets` listing, `/apps/frontend/nginx.conf.template`, `/apps/frontend/package.json` (vite-plugin-compression)
- Codebase size: `apps/backend/src` 15,591 lines in .ts; `server.ts` alone is 7,524 lines (monolith). 60 commits in total on the branch; git history is 9.9 MB. — `wc -l`, `git log`
- Backend bundling: `esbuild --bundle --packages=external` produces `dist/server.cjs` with sourcemap; node_modules are shipped to the runtime image. Workspace aliases for `@legalio/shared` and `@legalio/types` are inlined. — `/apps/backend/package.json`

### Inferences
- With no linter and a non-strict compiler, correctness gates rely on tests and manual review; the handover's authorization-bypass warning (promise-as-boolean) shows this is a real, acknowledged security risk, not hypothetical.
- `server.ts` at 7.5k lines and a hand-listed test script are the main maintainability drags.
- The 2 failing tests are very probably caused by trust-auth in my sandbox PG; verify on a password-auth server before reporting as defects.

### Gaps
- E2E tests (Playwright/Chromium) were not run (browser download not attempted).
- `typecheck` has no separate target beyond `lint`; there is no coverage tooling, so test coverage cannot be quantified.

## 2. Containers and deployment (Dockerfiles, compose, nginx, CI/CD)

### Takeaway
Container setup is simple and mostly sensible (multi-stage, non-root backend, loopback-bound backend port, pg healthcheck), but CI/CD is effectively "SSH into the server and run whatever script is there": no build, lint, test, image registry, health verification or rollback in the repository, and the workflow file is itself in a gitignored path.

### Cited Findings
- `.github/workflows/deploy.yml` has a single job on push to `main` (and manual dispatch): writes SSH key and known_hosts from secrets, then runs `ssh -o StrictHostKeyChecking=yes user@host` with NO command. Deploy logic lives in an authorized_keys forced command or a login script on the Tencent Lighthouse server, not visible in the repo. Concurrency group `production-deploy` with `cancel-in-progress: false` (serialized). No typecheck, test, build, Docker build, smoke test, notification or rollback steps. Also no `permissions:` block (defaults apply). — `/.github/workflows/deploy.yml`
- Handover confirms: "deploy.yml hanya menjalankan `ssh user@host` tanpa perintah, jadi skrip deploy yang sebenarnya ada di server... tidak terlihat dari repo" and warns that merging to `main` auto-deploys to production (and the production DB will start empty). — `/HANDOVER_POSTGRESQL_COS.md` §9 and header
- `.gitignore` section 10 ignores `.github/`, `.dockerignore`, `scripts/*` (except two), `tests/`, `tools/`, `docs/`, `CLAUDE.md`, `AGENTS.md`; yet `.github/workflows/deploy.yml`, `.dockerignore` and `scripts/check-invitation-ui.mjs` ARE tracked (they were force-added earlier). Risk: any new workflow or script added under those paths will silently not be committed. `.gitignore` header says "Open Source Ready" and the public repo is meant to ship only install/build/run files. — `/.gitignore`, `git ls-files`
- `apps/backend/Dockerfile`: two stages on `node:22-bookworm-slim`; `COPY . .` then `npm ci --workspace @legalio/backend --include-workspace-root`, build, `npm prune --omit=dev`; runtime copies `node_modules` and `apps/backend/dist`; `USER node`; `VOLUME /data`; `APP_DATA_DIR=/data`; `CMD node apps/backend/dist/server.cjs`. No `HEALTHCHECK`, no `tini`/init, no layer-caching strategy (whole repo copied before `npm ci`, so every source change reinstalls dependencies), image tag not pinned to digest. — `/apps/backend/Dockerfile`
- Note: runtime image contains `apps/backend/dist` only, which includes the built `/sys` console (`dist/console`) because `npm run build:backend` runs `build:server` and... actually `build:backend` = `npm run build --workspace @legalio/backend` = server + console. OK. `REPOSITORY_DIR` is resolved relative to `__dirname` (`../../..`) so in the image `/app` becomes the repo dir. — `/apps/backend/package.json`, `/apps/backend/src/runtimePaths.ts`
- `apps/frontend/Dockerfile`: builds Vite app in node:22, serves from `nginx:stable-alpine` (unpinned floating tag) with `API_UPSTREAM` env templated; runs as default nginx (root master). No HEALTHCHECK. — `/apps/frontend/Dockerfile`
- `apps/frontend/nginx.conf.template`: `client_max_body_size 32m`; proxies `/sys`, `/sys/`, `/api/`, `/uploads/` to the backend preserving `Host $http_host`; SPA fallback `try_files $uri /index.html`. Missing: TLS (port 80 only; TLS must be terminated elsewhere), security headers (HSTS, X-Frame-Options, CSP, X-Content-Type-Options), gzip/brotli config, cache headers for hashed assets, `proxy_read_timeout` tuning for slow AI (Gemini) calls (default 60s), access log customization. `/uploads/` proxy has no `X-Forwarded-For` difference issue; `/sys` blocks omit XFF. — `/apps/frontend/nginx.conf.template`
- `compose.yaml`: services `backend` (port bound to `127.0.0.1:3000`), `postgres:17` (healthcheck with `pg_isready`, volume `legalio-pg`), `frontend` (port `8080:80`, `depends_on: backend` with no health condition). Volumes `legalio-data` (/data) and `legalio-pg`. `restart: unless-stopped` everywhere. `POSTGRES_PASSWORD` defaults to the literal `legalio` when unset (`${POSTGRES_PASSWORD:-legalio}`), and postgres is not published on host ports (good). Backend has no healthcheck even though `/api/health` exists. `env_file: apps/backend/.env` is required (compose fails if missing; `npm run setup` creates it). — `/compose.yaml`
- Postgres 17 image in compose vs. docs say "PostgreSQL 14 or newer"; handover test container uses `postgres:17-alpine`. Compose pins only the major version. — `/compose.yaml`, `/POSTGRES_STORAGE.md`, `/HANDOVER_POSTGRESQL_COS.md` §2
- `.dockerignore` excludes node_modules, dist, `.git`, `.env*` (except example), `*.db*`, `*.sqlite*`, `data_store.json`, `uploads`, `backups`, credentials/service-account JSON, pem/key. Handover notes it does not exclude `database.json`/`drive-backup.json` but they don't reach the final image. It does not exclude `assets/` (videos, ~5 MB) or `reports/`, `research_notes/`, so the build context contains them (minor). — `/.dockerignore`, `/HANDOVER_POSTGRESQL_COS.md` §9
- Rollback: none in repo. Handover says the new production starts with an EMPTY PostgreSQL and instructs not to delete `/data/kaelyn.db` (old SQLite archive, not imported). Rolling back to a pre-PostgreSQL build would need the old image and old data file; there is no documented rollback procedure. — `/HANDOVER_POSTGRESQL_COS.md` header, §6, §9
- Not-yet-run tests per handover (§9): `docker compose up --build` on clean volumes, real COS bucket setup/upload/download/reset, and the no-`DATABASE_URL` onboarding form. Handover also says "Rollback tx setup yang memulihkan cache COS belum dites". I did not run docker compose either (docker CLI present, but daemon/network not attempted). — `/HANDOVER_POSTGRESQL_COS.md` §9
- No image registry, no versioned tags, no SBOM/vulnerability scanning, no Dependabot/Renovate config (no `.github/dependabot.yml`). — `git ls-files`

### Inferences
- Deployment is a single-server, mutable, build-on-host model (likely `git pull && docker compose up -d --build` on Lighthouse). That means downtime during rebuild/recreate, no artifact promotion, and the real deploy script is an undocumented, un-versioned single point of knowledge.
- The prod gate is "whatever is pushed to `main`": a type error or failing test can reach production because CI performs none of the checks that the handover lists as mandatory gates (§2: lint, build, test, build:sys, two e2e).
- Because `.github/` is in `.gitignore`, adding a CI workflow requires `git add -f` or editing `.gitignore`; this should be fixed first.

### Gaps
- The server-side deploy script/forced command and server OS config (firewall, TLS terminator, backups cron) are not visible; cannot assess.
- Did not run `docker compose build` (time, network, daemon availability not verified).

## 3. Config and env management; secrets

### Takeaway
Config design is thoughtful (zero required env vars beyond an auto-generated secret; DB and COS configured through onboarding and stored encrypted), and nothing sensitive is committed. The main risks are one root-secret dependency (`BETTER_AUTH_SECRET`), unencrypted app-level secrets in the DB, and an unauthenticated first-run setup window.

### Cited Findings
- `.env.example` (backend): only `BETTER_AUTH_SECRET=` is active; everything else is commented optional override (`DATABASE_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `DEMO_ADMIN_*`, `SEED_DEMO_ADMIN`, `GEMINI_API_KEY`, Google OAuth/service-account vars, `SYSTEM_CONSOLE_DIR`). Frontend `.env.example` has only a comment (no variables). — `/apps/backend/.env.example`, `/apps/frontend/.env.example`
- `runtimePaths.ts`: `APP_DATA_DIR` must be absolute; defaults to the repo directory in dev; `APP_TEST_MODE=1` forces it into the OS temp dir and disables startup side effects (demo reseed, Google, SMTP/AI calls, periodic jobs). Single source for `DATABASE_CONFIG_FILE` = `APP_DATA_DIR/database.json`. In Docker `/data` is a named volume. — `/apps/backend/src/runtimePaths.ts`, `/apps/backend/Dockerfile`
- DB config precedence: `DATABASE_URL` env > `APP_DATA_DIR/database.json` (mode 0600, written only after a successful connect and schema creation) > first-visit "Connect PostgreSQL" form (only while no config exists). If configured DB is down at startup, process exits 1 and never falls back to the form. — `/POSTGRES_STORAGE.md`, `/apps/backend/src/main.ts` (lines ~66-76)
- Installation settings (public URL, COS config, etc.) are stored in the DB; README says setup URL is stored in the installation DB and applied without restart; `BETTER_AUTH_URL` env overrides it. — `/README.md`, `/apps/backend/src/installationSettings.ts` (referenced by test file `installationSettings.test.ts`)
- Credential encryption: rows in `integration_credentials` (Google + COS) are AES-256-GCM encrypted with a key derived from `BETTER_AUTH_SECRET`. If the secret changes, stored credentials become unreadable and must be re-entered. — `/POSTGRES_STORAGE.md`, `/apps/backend/src/secretBox.ts`
- Explicitly out of scope per handover: encryption of `smtpPassword`, `geminiApiKey`, `refreshToken` in `app_settings` (stored in plain text in the DB); a `SETUP_TOKEN` for first-run protection; a COS `DELETE` endpoint; a `schema_migrations` table. — `/HANDOVER_POSTGRESQL_COS.md` §1 ("Di luar scope")
- Unauthenticated first-run: `POST /api/system/database` needs no login; whoever first reaches a fresh install can connect the DB and create the superuser. Handover recommends completing setup immediately after deploy or pre-seeding via `DEMO_ADMIN_*`. — `/HANDOVER_POSTGRESQL_COS.md` §6.4, §9
- Default credentials: compose falls back to DB password `legalio` and README example uses `legalio:legalio`. Code also contains `LEGACY_DEFAULT_ADMIN_PASSWORD` and `isBootstrapPasswordActive()` to flag installs still using the old shipped admin password (legacy upgrade path). — `/compose.yaml`, `/apps/backend/src/server.ts` (~line 7284)
- Repo secrets hygiene: `git ls-files` shows no `.env`, key, pem, db or dump files. Matches for "credential/secret" are only source files (`googleCredentials.ts`, `secretBox.ts`, tests, UI dialogs). `.gitignore` and `.dockerignore` cover env files, keys, service-account/client_secret JSON, DB files and dumps. I did not scan git history for secrets (no gitleaks run; a GitHub `run_secret_scanning` tool exists but was not used). — `git ls-files | grep`, `/.gitignore`, `/.dockerignore`
- GitHub Actions secrets used: `LIGHTHOUSE_SSH_PRIVATE_KEY`, `LIGHTHOUSE_KNOWN_HOSTS`, `LIGHTHOUSE_HOST`, `LIGHTHOUSE_USER`. SSH key written to disk on the runner with 600 perms; host key pinned (`StrictHostKeyChecking=yes`) — good practice. — `/.github/workflows/deploy.yml`
- Large binaries: `assets/video/legalio-intro.mp4` (2.2 MB), `legalio-preview.gif` (2.2 MB), poster png (616 KB), TTF fonts, screenshots; tracked tree totals ~15 MB, `.git` 9.9 MB. Not a real problem, but marketing assets are in the app repo. — `du`, `git ls-files`

### Inferences
- Losing or rotating `BETTER_AUTH_SECRET` is a data-loss-adjacent event (stored COS/Google credentials become unreadable, plus session invalidation). It must be backed up outside the server, and the docs say "Keep that secret" but give no backup/rotation procedure.
- The plaintext SMTP/Gemini/refresh tokens in `app_settings` mean a DB dump (pg_dump file, backup volume) is itself a secret-bearing artifact.

### Gaps
- Git history was not scanned for historically committed secrets.
- No rotation procedure for `BETTER_AUTH_SECRET` or DB password documented.

## 4. Observability, health, backups

### Takeaway
Observability is minimal: `console.log/error` only, a trivial `/api/health` that does not check the DB, no healthcheck in compose or Dockerfiles, no metrics or error tracking. Backup guidance is a single `pg_dump` example plus COS versioning, with no automation, restore procedure or testing.

### Cited Findings
- Logging: plain `console.*` (server.ts has 74 occurrences, googleDriveSync.ts 25, main.ts 9); no structured logging library, request logging middleware, or correlation IDs (grep for pino/winston/morgan/sentry/prometheus found nothing). Startup banner text is Indonesian ("Pengelola Kontrak & IO Server running..."). — grep of `/apps/backend/src`, `/apps/backend/src/main.ts`
- Health: `GET /api/health` returns `{status:"ok", time}` and is public; it does NOT query PostgreSQL or COS, so it reports ok even when the DB is unreachable (the process would have exited at boot, but mid-run pool failures are not reflected). Used by e2e tests only; compose/Dockerfile do not use it. Handover confirms "Tidak ada healthcheck backend di compose". — `/apps/backend/src/server.ts` line 7279, `/compose.yaml`, `/HANDOVER_POSTGRESQL_COS.md` §9
- Graceful shutdown: `main.ts` handles SIGTERM/SIGINT, closes the HTTP server and force-exits after 3s; it does not drain the in-memory write queue, close the pg pool, or wait for in-flight saves explicitly (3s hard cap). Docker default stop timeout is 10s, so the cap is shorter than Docker's. — `/apps/backend/src/main.ts` lines ~109-122
- Error tracking/alerts: none found in code or workflow (no Sentry, no uptime monitor config). Audit log table exists in DB (`audit_log`) for business events. — grep, `/apps/backend/src/schema.ts` line 37
- Backups (Postgres): doc suggests `docker compose exec postgres pg_dump -U legalio legalio > legalio.sql`; no cron/automation, no off-site copy, no restore instructions, no PITR/WAL archiving. COS: "enable versioning on the bucket" (manual, outside repo). Optional Google Drive backup copies uploaded files only, not the DB; its index lives in `APP_DATA_DIR/drive-backup.json` (a file on the `/data` volume). The old in-app `.db` backup/restore and SQLite browser were deleted. — `/POSTGRES_STORAGE.md`, `/HANDOVER_POSTGRESQL_COS.md` §1
- `.gitignore` ignores `*.dump`, `*.sql.gz`, `dumps/`, `backups/` (so backups are expected on disk next to the repo). — `/.gitignore` section 3
- Reset danger: "An application reset deletes every object under the prefix, one request per object. Use a dedicated bucket or prefix." — `/POSTGRES_STORAGE.md`

### Inferences
- A failed DB connection mid-run would surface as 500s with no alert; operators would only learn from users. A deep health endpoint (SELECT 1 + COS probe optional) plus compose `healthcheck` is a cheap fix.
- Restore has never been documented or (as far as visible) tested; RPO/RTO are undefined.

### Gaps
- Server-side cron jobs, snapshotting (Tencent Lighthouse snapshots) and monitoring are unknown/outside the repo.
- No data on log volume/retention (Docker json-file default, no rotation settings in compose).

## 5. Scaling, HA, migrations, zero-downtime

### Takeaway
Architecturally a single-instance system by design: the whole workspace is held in an in-memory collection and written back with a single-writer snapshot, so horizontal scaling and zero-downtime deploys are explicitly unsupported. Schema is created by idempotent `CREATE TABLE IF NOT EXISTS` on every boot with no versioned migrations.

### Cited Findings
- "Run one instance only. The backend keeps an in-memory copy of the workspace and caches credentials per process. Do not run two backends against the same database." — `/POSTGRES_STORAGE.md`; handover decision: "Koleksi in-memory (`db`) tetap dipakai. Penyimpanan diserialkan (satu writer)" and risk 3. — `/HANDOVER_POSTGRESQL_COS.md` §1, §6
- Write model: first save after boot rewrites all rows (empty fingerprint cache); a failed save reloads memory with `Object.assign(db, await loadCoreData())`, which can silently drop concurrent in-memory edits of other requests (documented known limitation). Also, Google duplicate `account` rows possible (no unique key). — `/HANDOVER_POSTGRESQL_COS.md` §6.5, §8
- Schema management: `ensureSchema()` runs on every boot (better-auth migrations, then app tables with `CREATE TABLE IF NOT EXISTS`; 106-line `schema.ts`, plus `normalizedSchema.ts`). A `schema_migrations` table exists in the schema (`schema.ts` line 44) but the handover lists a `schema_migrations` mechanism as out of scope; no versioned/rollbackable migration tool (no knex/drizzle/flyway/node-pg-migrate in dependencies). Column changes (ALTER) must be hand-coded idempotently. — `/apps/backend/src/schema.ts`, `/apps/backend/package.json`, `/HANDOVER_POSTGRESQL_COS.md` §1
- State outside DB: `APP_DATA_DIR/database.json` and `drive-backup.json` live on the `legalio-data` volume; uploads are in COS (no local disk fallback). The `/sys` console static bundle is served from `dist/console`. So the container is nearly stateless apart from those two small files. — `/POSTGRES_STORAGE.md`, `/apps/backend/src/runtimePaths.ts`
- Express details: `trust proxy` true; JSON/urlencoded body limit 25 MB while nginx limit is 32 MB; no rate limiting or helmet found by grep (`rateLimit`, `helmet` return nothing in non-test source); per-process caches. Server listens on 0.0.0.0 inside container, host-bound to loopback. — `/apps/backend/src/server.ts` lines 137-146, grep
- Deploys: container recreate implies downtime (backend restart reloads whole dataset into memory at boot; startup time scales with data volume; handover notes "skala demo"). No blue/green, no readiness probe. Compose `restart: unless-stopped` provides crash recovery only. — `/compose.yaml`, `/HANDOVER_POSTGRESQL_COS.md` §6.5
- Search is `ILIKE` over `search_records`, no index; upgrade path `pg_trgm`/`tsvector` noted. — `/POSTGRES_STORAGE.md`

### Inferences
- Suitable for an SMB/single-tenant-box deployment; any need for HA or >1 replica requires re-architecture of the in-memory `db` write path (large effort).
- Memory growth is proportional to total data; no documented sizing or limits (no `mem_limit` in compose, though lint scripts pass `--max-old-space-size=2048`).

### Gaps
- No load/perf data; actual dataset size and boot-time not measured.
- Did not review `db.ts`/`coreDataStore.ts` write path in depth (covered by other researchers' scopes presumably).

## 6. Documentation quality and handover accuracy

### Takeaway
README is polished and mostly accurate for install and first run; the 56 KB handover (Indonesian) is a thorough phase log whose key claims match the code I checked, but it is a stale-prone work journal rather than an operations runbook, and it contains instructions tied to a Codespaces path and to merge-to-main caveats.

### Cited Findings
- Handover claims (status 22 Oct 2026, branch PostgreSQL): all phases A-G done; SQLite fully removed; COS mandatory with no local fallback; credentials encrypted (AES-256-GCM); onboarding for DB + COS; single in-memory store; gates list (lint, build, test, build:sys, 2 e2e); known risks (§6); pre-merge checklist (§9). — `/HANDOVER_POSTGRESQL_COS.md`
- Verified against code/repo: no `better-sqlite3` in any `package.json` (checked backend/root deps); `database.json` precedence and exit-1 behavior match `main.ts`; `/api/health` exists; Compose lacks backend healthcheck (as stated); single-writer/in-memory model exists (POSTGRES_STORAGE.md agrees); `schema_migrations` table exists in `schema.ts` line 44 though handover lists it "out of scope" (minor inconsistency). Gate commands match root `package.json` scripts. Local run: lint and build green, unit tests 76/78 (2 env-related failures; see §1), consistent with "semua tes hijau" on a password-auth Postgres. — files cited above, runs
- Staleness/inconsistency: handover §9 says do not merge to `main` before G is done; G is done, yet the doc still says "Yang tersisa adalah tes di lingkungan nyata". Git log shows the last commits are phase G and a UI copy fix; `main` branch not present locally (only `PostgreSQL`, `origin/PostgreSQL`). The `§4` section duplicates `§3` completed-phase content ("Yang belum dikerjakan" lists phases as ✅ SELESAI), which is confusing. Commands hard-code `/workspaces/Legalio-Lite-CLM` (Codespaces path) and reference `/tmp` notes already lost. It warns against committing `packages/ui-components/src/moduix/ui/alert/Alert.tsx` (a stray local change). Document language is Indonesian, README is English. — `/HANDOVER_POSTGRESQL_COS.md` §2, §4, §7, `git branch -a`
- README: clear Usage/Installation, Docker flow, `BETTER_AUTH_URL` guidance and nginx `Host $http_host` note; badges link to files; it names repo `adhityacl/NEW-CLM` (git clone URL) while the checkout directory is `Legalio-Lite-CLM`; claims MIT license but no `LICENSE` file is tracked (README links `#-feedback-and-contributing` anchor only). No CONTRIBUTING, CHANGELOG, architecture diagram, API docs, runbook, or `.env` reference beyond `.env.example`. — `/README.md`, `git ls-files`
- README says "Node.js 20.19 or newer (22 LTS recommended)" while Dockerfiles/.nvmrc use 22; consistent. README does not document `npm test` prerequisites (needs PG), the test list, or the e2e commands; those are in POSTGRES_STORAGE.md and the handover only. — `/README.md`, `/POSTGRES_STORAGE.md`
- New-developer onboarding: `git clone && npm install && npm run dev` works by design (postinstall creates `.env`), but backend needs a reachable PostgreSQL (or the form) and a COS bucket for setup completion, with no local MinIO/object-store dev mode documented (tests use an in-memory object store; `objectStore.test.ts`). No docker-compose dev profile for just Postgres. — `/README.md`, `/package.json`, `/apps/backend/src/objectStore.test.ts`
- Repo hygiene: `reports/` and `research_notes/` untracked dirs exist from this review; AI-tool files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`) are gitignored, so conventions for contributors/agents are not shared. Git: 60 commits, conventional-commit style prefixes (feat/fix/chore/perf/refactor). TODO/FIXME count in ts/tsx: 0 (grep count printed 0). — `/.gitignore`, `git log`, grep
- `console.log` startup message and several user-facing server messages are in Indonesian, with i18n tables (`serverMessages.ts`), indicating a bilingual (id/en/zh) product; operational messages are not localized consistently. — `/apps/backend/src/main.ts`, `/apps/backend/src/serverMessages.ts`

### Inferences
- A new developer can get to a running dev environment quickly, but needs undocumented knowledge (PG container command is only in the handover; COS bucket required to finish setup).
- Most handover content (phase logs, review notes) should be converted into an ADR/changelog and a concise ops runbook; operationally critical items (prod prerequisites §9, secret handling, backups) are buried.

### Gaps
- I did not diff every handover claim line-by-line against code (56 KB); verified the operational and structural claims listed above. Phase C/D/F implementation details (e.g., all `sql.tx` conversions, 10 review fixes) not audited here.

## 7. Prioritized recommendations (effort: S <1 day, M 1-3 days, L 1+ week)

### High
1. Add real CI to the repo and gate deploys on it (M). Workflow with `npm ci`, `npm run lint`, `npm run build`, a Postgres service container and `npm test`, then Playwright e2e; make deploy `needs:` CI. Un-ignore `.github/` in `.gitignore` (S) so the workflow is not silently dropped. Evidence: deploy.yml has no checks; `.gitignore` ignores `.github/`; unit tests run in ~14s against PG.
2. Put the deploy script in the repo and give it a health check and rollback (M). Replace the bare `ssh` with an explicit command (`git pull`, `docker compose up -d --build`, curl `/api/health`, revert to previous commit/image on failure); tag images by SHA. Evidence: handover §9 admits the script is invisible.
3. Fix npm audit highs (S): upgrade dompurify (3.2.6 -> >=3.4.17; used by frontend and relevant to rendering contract HTML), nodemailer (-> >10.0.9; cross-tenant SMTP credential disclosure advisory is relevant to a multi-tenant app), vite (>6.4.3). `npm audit fix` is available; re-run tests/build after. Add Dependabot/Renovate (S).
4. Backups and restore runbook (M): scheduled `pg_dump` (or Tencent managed snapshots) with off-site retention, COS versioning enabled and verified, a tested restore procedure, and back up `BETTER_AUTH_SECRET` separately. Evidence: only a one-line `pg_dump` example exists; secret loss makes stored COS/Google credentials unreadable.
5. Close the first-run exposure on production (S): add the `SETUP_TOKEN` hardening the handover mentions, or require pre-seeded admin via `DEMO_ADMIN_*` before exposing the port. Evidence: `POST /api/system/database` and superuser creation are unauthenticated on a fresh DB; prod starts with an empty DB.
6. Enable strictness incrementally and add the promise lint to the repo (M): add ESLint with `@typescript-eslint/no-floating-promises`/`no-misused-promises` to `npm run lint` instead of the out-of-repo recipe, since handover says promise misuse can produce authorization bypass.

### Medium
7. Deep health check + container healthchecks (S): `/api/health` should `SELECT 1`; add `healthcheck` for backend (and `depends_on: condition: service_healthy` for frontend) in compose.
8. Versioned migrations (M-L): introduce a `schema_migrations`-backed runner (the table already exists) or node-pg-migrate; `CREATE IF NOT EXISTS` cannot express column changes or rollbacks.
9. Harden nginx (S-M): TLS guidance/terminator config, security headers, enable `gzip_static`/`brotli_static` for the .gz/.br assets the build already emits, `proxy_read_timeout` for AI calls, pin `nginx` and `postgres` image tags/digests.
10. Dockerfile efficiency (S): copy only package manifests first for dependency layer caching; add HEALTHCHECK; run frontend nginx unprivileged; remove `assets/`, `reports/`, `research_notes/` from build context via `.dockerignore`.
11. Observability baseline (M): structured logging (pino) with request IDs, Sentry or equivalent error tracking, uptime monitoring, compose log rotation; make graceful shutdown wait for in-flight writes and `pool.end()` (3s forced exit vs Docker's 10s).
12. Rate limiting and security middleware (S-M): add `helmet`/rate limits on login and public setup endpoints (none found).
13. Make `npm test` discover files by glob and add a Turbo `test` task (S); add `check-invitation-ui` to a script or delete it.
14. Encrypt remaining secrets in `app_settings` (smtpPassword, geminiApiKey, refreshToken) per handover's out-of-scope list (M).

### Low
15. Docs consolidation (M): split HANDOVER into concise runbook + ADRs + changelog; fix Codespaces paths; add LICENSE file, CONTRIBUTING, dev quickstart with PG docker one-liner and a MinIO/COS dev option; reconcile README repo name (NEW-CLM) with this repo; note `schema_migrations` inconsistency.
16. Clean `tsconfig.json` includes of non-existent `tests/`, `tools/` and gitignored paths (S).
17. Move marketing video/GIF/fonts out of the app repo (S) or to Releases/LFS; split the 7.5k-line `server.ts` into route modules (L, ongoing).
18. Plan upgrades: Express 4 -> 5, dotenv 18, esbuild 0.28, @types/node alignment (M each, low urgency).
19. Long-term (L): if HA is ever required, replace the in-memory single-writer store with per-request DB access and cache invalidation.

### Gaps
- Effort estimates are my judgement, not derived from team velocity.
- Server-side runtime (TLS, firewall, cron, snapshots) could not be assessed from the repo.
