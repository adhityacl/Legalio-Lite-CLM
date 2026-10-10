# Tenant boundaries and unified Settings — handoff

Implementation of `docs/rbac/TENANT-BOUNDARIES-SETTINGS-PRD.md` on branch `tenant-boundaries-wip`.
Companion documents: `tenant-boundaries-endpoint-inventory.md` (generated route/policy inventory) and the PRD itself.

## 1. How to verify

| Command | What it runs | Environment |
| --- | --- | --- |
| `npm test` | Unit suites `tests/*.test.ts` (RBAC policy, i18n parity, demo dataset, business helpers) | in-process, no server, no database |
| `npm run test:tenant-boundaries` | `tests/tenant-boundaries/{api,migration,store}.test.ts` + `tests/rbac.test.ts` | each live server is the bundled `server.ts` started from its own `mkdtemp` directory with `APP_TEST_MODE=1`, `AUTH_DB_PATH`/`APP_DATA_DIR` inside it, no Google/SMTP/AI transport; the runner checksums the workspace `auth.db*`, `uploads/` and `data_store.json` before/after and fails if they change (AC-040) |
| `npm run test:e2e:fixtures` | `playwright.fixtures.config.ts`: mocked-API browser specs against `vite preview` | every `/api/**` request is intercepted (`tests/e2e/fixtures/tenantApi.ts`); no server, no database |
| `npm run test:e2e:tenant-boundaries` | `playwright.tenant-boundaries.config.ts`: live browser specs | `tests/e2e/isolated/globalSetup.ts` starts the bundled server (`APP_TEST_MODE=1`) in a temporary directory, seeds the synthetic §16.1 `example.test` matrix, serves the built frontend with `vite preview` proxied to it, and deletes everything at teardown; same workspace checksum guard as above |
| `npm run test:e2e` | same isolated live suite (the default config re-exports the tenant-boundaries config) | never opens the workspace `auth.db`; `tests/e2e/seed.ts` refuses to run without the isolated environment |
| `npx tsx tools/gen-endpoint-inventory.ts [--check]` | regenerates / checks the endpoint inventory | reads source and `node_modules` only |

Live browser ports: preview `127.0.0.1:4290`, API `4291` (override with `TB_E2E_WEB_PORT` / `TB_E2E_API_PORT`; `TB_E2E_SKIP_BUILD=1` reuses an existing `dist/`).

## 2. Validation results for this handoff

Run on 2026-10-05 in a Linux dev container (Node ≥ 20, Chromium from Playwright), sequentially, on the commit before this document:

| Command | Result | Excerpt |
| --- | --- | --- |
| `npm test` | passed | `# tests 97 # pass 97 # fail 0` |
| `npm run test:tenant-boundaries` | passed | `# tests 68 # pass 68 # fail 0` — `[tenant-boundaries] Workspace runtime files unchanged (auth.db, uploads/, data_store.json).` |
| `npm run lint` (type-check, full `tsc --noEmit`) | passed | exit 0, no diagnostics |
| `npm run test:e2e:fixtures` | **failed (5 pre-existing)** | `5 failed, 75 passed (6.1m)` — the five failures are the baseline failures listed in section 3; every new and updated tenant-boundaries test passed |
| `npm run test:e2e:tenant-boundaries` | passed | `31 passed (1.6m)` — `[tenant-boundaries] Workspace runtime files unchanged …` |
| `npm run build` | passed | `✓ built in 19.41s`, backend bundle written, exit 0 |

## 3. Acceptance evidence (PRD §16.2)

Test names are quoted from the files: `api` = `tests/tenant-boundaries/api.test.ts`, `migration`/`store` = same folder, `rbac` = `tests/rbac.test.ts`,
`live` = `tests/e2e/tenant-boundaries.live.spec.ts`, `nav`/`routing` = `tests/e2e/admin-nav-rbac.spec.ts` / `spa-query-routing.spec.ts` (live),
`settings` = `tests/e2e/settings-tenant-boundaries.spec.ts`, `refinements`/`a11y` = `ui-refinements` / `ui-accessibility` specs (mocked).
Environments: **I-API** isolated live server (`test:tenant-boundaries`), **I-BR** isolated live browser (`test:e2e:tenant-boundaries`), **M-BR** mocked browser (`test:e2e:fixtures`), **U** unit (`npm test` / rbac).
"Result" is the outcome of the runs in section 2.

| AC | Evidence (test) | Env | Result | Gaps |
| --- | --- | --- | --- | --- |
| AC-001 | settings › "AC-001 admin sees one Settings entry and exactly three tabs, with no platform controls" (1440 + 390 px); nav › "admin sees one Settings entry and no System Admin"; live › "AC-004 …" (three tabs live); refinements › "all settings pages and UI text modal keep mobile controls contained" | M-BR, I-BR | pass | live mobile viewport only exercised in mocked run |
| AC-002 | settings › "AC-002 manager sees only Members & Access and never fetches organization, integration or audit data"; live › "managerA: menus, pre-mount guards and API agree"; api › "manager lists self plus intersecting departments; editors get no list" | M-BR, I-BR, I-API | pass | — |
| AC-003 | settings › "AC-003 editor/viewer has no Settings entry; deep links show access denied without privileged requests"; live › "editorA/viewerA: menus, pre-mount guards and API agree"; api › "uses the standard error envelope with a request id" | M-BR, I-BR, I-API | pass | — |
| AC-004 | live › "AC-004 switching from admin in A to viewer in B replaces capabilities and data; identity unchanged" (chooser, three tabs in A, B viewer menus/data, DB: user/member/team rows unchanged, only that session's default moved) | I-BR | pass | — |
| AC-005 | api › "foreign selectors in header, query, body or path reveal nothing" | I-API | pass | — |
| AC-006 | api › "an explicit permitted selector beats the session default and its role governs" | I-API | pass | no simultaneous two-tab browser test |
| AC-007 | api › "switching changes only the calling session default; no global active tenant" | I-API | pass | no concurrent two-user browser test |
| AC-008 | api › "repeated GETs create no membership, allowlist row, team, selection or mapping" (DB snapshot diff; no transports exist in test mode) | I-API | pass | — |
| AC-009 | api › "init-data returns the scoped DTO without tenants or provider configuration", "settings and integration DTOs carry no platform secrets" | I-API | pass | — |
| AC-010 | api › "raw Better Auth admin and organization plugin routes are denied", "every installed Better Auth route outside the allowlist is denied" | I-API | pass | — |
| AC-011 | same two tests (organization plugin create/invite/update-member-role/set-active/accept and every other plugin path → 404; role unchanged) | I-API | pass | — |
| AC-012 | api › "removing a multi-organization member touches only that organization (AC-012)" | I-API | pass | — |
| AC-013 | api › "tenant admin cannot appoint a peer admin or change its own role (AC-013)", "tenant admins are denied every platform configuration, credential, database and reset route"; rbac › "§4.3 rule 1: tenant admin cannot appoint or demote a peer admin" | I-API, U | pass | bulk path covered only through the platform-only `/api/auth-console/users/bulk-action` policy (403 for tenant admin by route policy; not called in a test) |
| AC-014 | api › "manager cannot change a partially overlapping target (AC-014)"; rbac › "AC-014 manager with partial overlap: sees target, cannot change it" | I-API, U | pass | — |
| AC-015 | api › "rejects invalid targets before any invitation exists" | I-API | pass | — |
| AC-016 | api › "accepts exactly once for the verified invited identity" | I-API | pass | — |
| AC-017 | api › "refuses unverified, canceled, expired and revoked-inviter invitations"; concurrent acceptance in "accepts exactly once …" | I-API | pass | — |
| AC-018 | api › "email/password signup creates a pending platform user unless invited (AC-018)" | I-API | pass | delivery of the verification email itself is not exercised (no SMTP in test mode) |
| AC-019 | api › "suspension ends access to that organization only (AC-019)"; live › "AC-019 a membership suspended after capabilities load is dropped on the next request; other access and the session remain" | I-API, I-BR | pass | — |
| AC-020 | api › "rejects missing, expired, revoked and banned sessions on every path family" (new, legacy, plugin, `/uploads`) | I-API | pass | — |
| AC-021 | api › "section saves change only their fields and append audit" | I-API | pass | — |
| AC-022 | api › "concurrent saves with the same version: one commits, one conflicts"; settings › "AC-042 loading and save errors are announced accessibly" (conflict UI) | I-API, M-BR | pass | — |
| AC-023 | api › "integration mappings are validated, unique across organizations, and survive restart" | I-API | pass | — |
| AC-024 | api › "placeholder Google sync is honest and scoped"; settings › "AC-025 missing provider shows an honest unavailable state …" (no Sync action) | I-API, M-BR | pass | — |
| AC-025 | settings › "AC-025 capability failure shows Retry with no inferred privileges; empty capabilities stay empty", "AC-025 missing provider shows an honest unavailable state with no hard-coded resources or sync action" | M-BR | pass | — |
| AC-026 | settings › "AC-026 a slow response for the previous organization never overwrites the newly selected one" | M-BR | pass | mocked ordering only; no live slow-response test |
| AC-027 | settings › "AC-027 unsaved Organization changes ask Stay or Discard before leaving a tab or organization" | M-BR | pass | browser Back/Forward while dirty is not guarded (only tab/organization switches and page unload) |
| AC-028 | api › "serves files only through owning records in scope; unowned root files are denied" | I-API | pass | duplicate display-name folders are covered by ownership lookup, not by a dedicated same-name fixture |
| AC-029 | **partial**: list/search/record scope — live AC-045 tests, api › "department roles see only exact-department records; no-department members see none", "records outside department scope cannot be read or written by ID" | I-API, I-BR | pass (partial) | **not covered**: AI prompts, OCR cache keys, export and reminder recipients. Test mode disables the AI/SMTP/Google providers and the code has no injectable transport to observe them; OCR cache keys include the organization ID in code (`contracts:<organizationId>` scope) but no test asserts it |
| AC-030 | api › "superuser manages A in platform context without a membership; audit names the platform actor"; live › "AC-030 superuser manages A without a membership; changes are audited as the platform actor" | I-API, I-BR | pass | — |
| AC-031 | api › "the last usable admin cannot be removed, suspended, demoted or banned (AC-031)" (includes two concurrent demotions: exactly one succeeds) | I-API | pass | last-superuser path covered by the self-change denial only |
| AC-032 | api › "creates, rejects duplicates case-insensitively, and refuses to delete a department in use" | I-API | pass | — |
| AC-033 | api › "tenant admins are denied every platform configuration, credential, database and reset route", "superuser platform configuration hides secrets and validates sections"; live › "ordinary tenant admin never sees or reaches platform surfaces"; refinements (Configuration tabs under System Admin) | I-API, I-BR, M-BR | pass | — |
| AC-034 | settings › "AC-034 language and theme preferences belong to the identity, not the browser" | M-BR | pass | personal language/theme remain local; shared platform text edits are covered by `tests/uiTranslations.test.ts` and `tests/e2e/ui-text-sharing.live.spec.ts` |
| AC-035 | store › "settings write rolls back when the audit insert fails", "membership change rolls back when the audit insert fails" | U (store) | pass | — |
| AC-036 | migration › "dry-run is read-only and redacted; apply preserves multi-organization data; reapply changes nothing" | I-API (migration) | pass | — |
| AC-037 | migration › "a bare global owner and conflicting duplicate memberships refuse apply without a partial marker", "rejects stale digests, unknown conflicts and invalid resolutions" | I-API (migration) | pass | — |
| AC-038 | api › "integration mappings are validated, unique across organizations, and survive restart" (+ every suite restarts after seeding) | I-API | pass | — |
| AC-039 | settings › "AC-039 legacy aliases map to canonical tabs with replaceState; Back/Forward never show a duplicate screen", "AC-039 manager aliases resolve to Members & Access or a denial, never a transient admin tab"; routing › "legacy alias is replaced, not pushed", "back/forward walk through visited tabs" | M-BR, I-BR | pass | — |
| AC-040 | `tools/run-tenant-boundaries-tests.mjs` checksum guard (both modes) | runner | pass | — |
| AC-041 | api › "concurrent public setup creates at most one superuser, and only while none exists" | I-API | pass | — |
| AC-042 | settings › "AC-042 keyboard users move between Settings tabs with arrows and dialogs restore focus at 1440px / 390px", "AC-042 loading and save errors are announced accessibly"; a11y › "invite dialog names its fields, traps focus and restores the trigger on desktop and mobile" | M-BR | pass | — |
| AC-043 | live › "superuser without a selection lands on System Admin and loads no tenant business data", "platform user without membership sees only the access state and personal actions", "ordinary tenant admin never sees or reaches platform surfaces"; nav › "Superuser sees System Admin and lands on the platform dashboard"; api › "no-membership identity sees no organizations and no business data", "superuser switcher is the platform directory without fabricated memberships" | I-BR, I-API | pass | — |
| AC-044 | live › "adminA/managerA/editorA/viewerA: menus, pre-mount guards and API agree", "disabled modules hide their menus, dashboard widgets and deep links for every role" | I-BR | pass | — |
| AC-045 | live › "adminA/managerA/financeViewerA/adminB: cards, drill-down and lists show only permitted records", "a member without departments sees the no-department state and no records"; api › "department roles see only exact-department records; no-department members see none" | I-BR, I-API | pass | charts are asserted through the scoped record set and cards, not per chart bucket |

### Pre-existing fixture failures (not caused by this change)

Five mocked browser tests fail identically on the parent commit `5d17ce2` (before any tenant-boundaries work) when run with that commit's own specs and mocks (61 passed / 5 failed). They assert content that changed in earlier, unrelated commits — the demo dataset no longer contains "PT Mitra Nusantara" (`92b219e`), the header language control is a button + dialog rather than a `<select>` / `.app-header-languages` group, and the spending edit form's legacy month hydration. They were left unchanged (PRD §16.3: record unchanged baseline failures, do not expand into unrelated repair):

- `ui-refinements` › "requiring action table combines contracts and order forms"
- `ui-refinements` › "header controls align, desktop checkboxes stay 14px and dropdowns share Contracts styling"
- `ui-refinements` › "Contracts mobile layout is justified without a visible breadcrumb, scroll hint or frozen identity"
- `ui-refinements` › "Parties panel selects a registered partner and edits both agreement parties"
- `spending-form` › "Edit hydrates legacy months and preserves both attachments"

## 4. Migration operator instructions (PRD §14)

Run this **before** starting the new version against an existing database. The new server refuses to serve (`503 MIGRATION_REQUIRED` on every API route except `/api/health` and `/api/system/public-status`) while legacy data exists without the `002_tenant_boundaries` ledger entry. A fresh, empty database initializes the new schema directly.

1. **Stop the application** (or take it out of service) so the source is not written during the migration.
2. **Dry-run** (default; opens the database read-only, imports no auth/startup code):
   ```bash
   npm run tenant-boundaries:migrate -- --db /srv/clm/auth.db --report /srv/clm/migration/report.json
   ```
   All paths must be absolute. Accepted flags: `--db`, `--report`, `--mapping`, `--dry-run`, `--apply`, `--backup`; anything else is rejected.
   The JSON report (`formatVersion: 1`, `migrationId`, `sourceDigest`, `conflicts`, `plannedChanges`, `applied: false`) contains counts, canonical organization mappings and redacted record references — no emails, secrets or tokens (secret presence is reported as booleans).
3. **Review conflicts.** Each conflict has a stable `conflictId`, a `kind` (for example `ambiguous-platform-role`, `missing-membership`, `orphan-membership`, `orphan-team-assignment`, `unknown-department-reference`, `settings-source-disagreement`, `shared-resource-mapping`, `global-notification-recipients`, `unowned-resource`) and the resolution kinds it permits. Nothing is guessed: a bare global `owner`, unknown roles, conflicting duplicate memberships, orphans and records without a verifiable organization block apply until resolved.
4. **Write a mapping file** for the blocking conflicts (only the decisions the report allows for each conflict):
   ```json
   {
     "formatVersion": 1,
     "migrationId": "002_tenant_boundaries",
     "sourceDigest": "<sourceDigest from the dry-run report>",
     "resolutions": [
       { "conflictId": "c-…", "decision": "set-platform-role", "userId": "<id>", "platformRole": "user" },
       { "conflictId": "c-…", "decision": "set-membership", "userId": "<id>", "organizationId": "<org>", "tenantRole": "manager", "status": "active", "departmentIds": ["<team>"], "survivingMembershipId": "<member id or null>" },
       { "conflictId": "c-…", "decision": "map-organization", "organizationId": "<existing org>" },
       { "conflictId": "c-…", "decision": "set-settings-field", "organizationId": "<org>", "fieldPath": "notifications.legalNotificationEmail", "value": "legal@example.com" },
       { "conflictId": "c-…", "decision": "quarantine-resource" }
     ]
   }
   ```
   Unknown fields, unknown/duplicate conflict IDs, mismatched identities/organizations, foreign departments and unsupported decisions are rejected. Re-run the dry-run with `--mapping` until the report shows no blocking conflicts.
5. **Apply with a backup** (the backup path must not exist; it is written with SQLite's online backup API, so WAL content is included, before the single write transaction starts):
   ```bash
   npm run tenant-boundaries:migrate -- --db /srv/clm/auth.db --report /srv/clm/migration/apply-report.json \
     --mapping /srv/clm/migration/mapping.json --apply --backup /srv/clm/migration/before-002.db
   ```
   Apply re-checks `sourceDigest` inside the transaction; if the database changed since the dry-run, nothing is written — dry-run again. On success the ledger entry is recorded and **all sessions are invalidated once** (users sign in again; credentials are untouched). Re-running apply makes no further semantic change.
6. **Start the new version.**

**Restore / rollback.** A failed apply rolls back and leaves no ledger entry. To undo a successful apply, stop the application, keep the migrated file aside, and restore the backup as the database together with the *previous* application build (offline, operator-controlled):
```bash
cp /srv/clm/auth.db /srv/clm/migration/after-002.db      # keep for analysis
cp /srv/clm/migration/before-002.db /srv/clm/auth.db
rm -f /srv/clm/auth.db-wal /srv/clm/auth.db-shm
```
Never start the old authorization code against a partially or fully migrated database, and never start the new code against the restored legacy file without migrating again.

## 5. Changed compatibility payloads

| Endpoint | Before | Now |
| --- | --- | --- |
| `GET /api/user/my-role` | one global `role` string, department label; could create an allowlist row | identity DTO of `/api/me` plus `email`, `name`, `platformRole`, `loginTime`; side-effect free; `?probe=1` returns 204 when signed out |
| `GET /api/rbac/me` | `{ actor: { role, tenantId }, permissions }` incl. `['*']` bootstrap | `{ ok, identity: { id, platformRole }, platformPermissions, context: <capability DTO> \| null, permissions }`; explicit lists, never a wildcard; empty when no organization context |
| `GET /api/tenants` | all tenants for admins, could update the global active tenant / provision on GET | `{ success, tenants (accessible projections only), organizations: [{ organizationId, organizationName, slug, logoUrl, tenantRole, accessMode }], activeTenantId: <this session's validated default or null> }`; no side effects |
| `POST /api/tenants/switch` | wrote a global active tenant | adapter to `POST /api/me/active-organization`: session default only, membership validated |
| `GET /api/init-data` | all operational arrays + `tenants` + redacted `googleConfig` | `WorkspaceInitResponse`: `organizationId`, the six scoped arrays, `services: { aiAvailable, googleUploadsAvailable }`, `timestamp`; no tenants, no provider configuration |
| `GET /api/departments` | name strings, could fall back to the first organization | `{ success, departments: <names>, items: [{ id, name }] }` for the selected organization only (managers/editors/viewers: assigned departments) |
| `GET /api/tenant-settings` | mixed policy + legacy fields | runtime policy view of the explicitly selected organization (same shape as `GET /api/organizations/:id/policy`) |
| `PUT /api/tenant-settings` | spread arbitrary body into settings | strict adapter to the settings service: only `settings`, `legalEntity`, `expectedVersion` (optional; defaults to the current version), `organizationId`; any other field (provider, SMTP, …) is `400 INVALID_INPUT`; response adds `success: true` to the policy view |
| `GET /api/branding` | full branding object | presentation fields only (`appName`, `logoUrl`, `primaryColor`, `footerText`, `loginHeadline`); `POST` is platform-only |
| `GET /api/activity-logs` | could include unowned events | scoped operational log of the selected organization, `tenant.audit.read` only |
| `POST /api/google-integration/sync`, `sync-flush`, `/api/tenants/:id/sync-google` | fake success / timestamps | `409 SYNC_UNAVAILABLE` after the authorization check; `GET …/sync-status` returns `{ organizationId, active: false, queueLength: 0, status: 'unavailable', syncSupported: false }` |
| `/api/auth-console/*` account, session, API-key, SQLite, overview, bulk families | reachable by tenant admins with organization filters | platform-only (`platform.*` permissions); tenant callers use `/api/organizations/:id/*` |
| Errors | free-form `{ error }` | `{ error: <CODE>, message, requestId }` with the §5.6 status codes |

## 6. Removed tenant global-account actions

Tenant administrators (and the Members & Access tab) no longer have: create account (replaced by **Invite member**), ban/unban account, delete account, set or reset another user's password, change another user's email, change platform role, list or revoke other users' sessions, or any Better Auth Admin/Organization plugin endpoint. Tenant actions are **Suspend membership**, **Reactivate membership**, **Remove membership**, role and department changes within the §4.3 hierarchy, invitations, and departments. Global account lifecycle stays in System Admin (superuser only). The Organization Admin sidebar parent, the six-section Settings page and the standalone Activity Logs page are gone (Activity is the History drawer in Members & Access; platform cards are System Admin › Configuration).

## 7. Known limitations

- The document drafting workspace (`contract_documents`, My Documents) is **organization-scoped, not department-scoped**: any member with `document.view` in the organization sees its drafts.
- **Department rename is blocked** (`409 DEPARTMENT_IN_USE`) while records reference the department by name, because legacy partner/contract ownership is resolved by exact normalized department name. Delete is blocked the same way.
- **Better Auth `change-password` needs the signed session cookie**, so Google-only sessions have no password flow; Account Security shows the sign-in method and the user's own sessions instead.
- No password-reset-by-email flow is exposed (`/api/auth/request-password-reset` is outside the allowlist); platform administrators reset passwords in System Admin.
- Google synchronization remains a placeholder (`syncSupported: false`); SQLite is authoritative.
- AC-029 (AI/OCR/export/reminder scoping) and parts of AC-006/007/026/027/034 have only partial evidence — see section 3.
- Five pre-existing mocked UI tests fail independently of this change — see section 3.
- PRD §17.1 UI screenshots (admin, manager, viewer, superuser contexts) are not delivered with this handoff; Playwright traces/screenshots are only kept in `test-results/` for failing or explicitly captured steps.
- The live browser suite uses fixed ports 4290/4291 and builds the frontend in global setup (about a minute).
