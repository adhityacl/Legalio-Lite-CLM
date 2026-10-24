# Proposal: PostgreSQL row-level security for tenant isolation

Status: **proposal only. RLS is not enabled** and nothing in the code depends on it. Tenant isolation today is enforced in the
application (route policies, `assertRecordAccess`, organization-scoped queries) and verified by `routeIsolation.test.ts`.
RLS would be a second, independent layer: a missed `WHERE organization_id = ?` would return no rows instead of another tenant's rows.

## Why it is not a switch to flip

1. **One connection role, one shared pool.** `sql.*` takes any pooled connection per statement unless inside `sql.tx`. A tenant
   setting must live on the connection for exactly one transaction (`set_config('app.organization_id', $1, true)`), so every request
   would have to run inside a transaction, or the facade would wrap each statement in one.
2. **The in-memory projection.** Business records are loaded into memory for all organizations and `coreSaver.save()` writes the
   whole projection (inserting, updating and deleting rows across organizations) in one pass. Under RLS that writer needs a role that
   bypasses it, which removes the protection for the very path that writes most data. The protection only becomes real once reads
   and writes are per-organization (the split of the old `server.ts` into `routes/*` modules is done; per-request organization-scoped stores, instead of the shared in-memory projection in `memoryDb.ts`, are still the prerequisite).
3. **Jobs without a tenant.** The reminder scheduler, backfills, `/api/cron/trigger-check`, platform (superuser) routes and migrations
   legitimately span organizations. They need a separate role (or `BYPASSRLS`) and an explicit, audited entry point.
4. **Child tables without `organization_id`.** `partner_categories`, `contract_categories`, `partner_identifiers`, `partner_dd_*`,
   `spending_allocations`, `spending_reporting_months`, `contract_drafts`, `document_metadata`, `contract_comments`,
   `approval_steps`, `approval_events` reach their organization only through a parent. Either denormalize `organization_id` onto them
   (additive migration plus backfill) or write policies with `EXISTS` on the parent (slower, harder to index).
5. **better-auth tables** (`member`, `team`, `teamMember`, `invitation`) are read by identity resolution before any tenant is known,
   so they stay outside RLS; they hold `"organizationId"` and are only reachable through the membership checks.
6. `activity_logs.organization_id` and `search_records.organization_id` are nullable or loosely keyed; policies must define what a
   NULL organization means (platform-only).

## Target design

* Two database roles: `legalio_app` (no `BYPASSRLS`, not the table owner) used by request handlers, and `legalio_owner`/`legalio_jobs`
  used by migrations, backups, the reminder scheduler and platform operations. Tables are `FORCE ROW LEVEL SECURITY` so even an owner
  connection without the bypass attribute is subject to the policy.
* Per request: after `createAuthorizationMiddleware` resolves `req.orgContext`, a request-scoped transaction (or a `sql.forOrganization(id, fn)` helper) executes
  `SELECT set_config('app.organization_id', $1, true)` as its first statement.
* Policy template, one per organization-owned table `t`:

```sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
ALTER TABLE t FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON t
  USING      (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
```

  An unset setting yields NULL, which matches no row (fail closed). Platform routes set `app.organization_id` to the target organization
  or use the jobs role.
* Departments stay an application concern (they derive from partner names and membership); RLS covers the organization boundary only.

## Rollout plan

1. Give each route module an organization-scoped store instead of the global `memoryDb` projection (the module split itself is done).
2. Add `organization_id` to the child tables (migration `NNNN_child_organization_id`, backfilled from the parent, `NOT NULL` after backfill).
3. Create the two roles (infrastructure change: `POSTGRES_PASSWORD` for the app role, a separate secret for the owner role) and move
   migrations/scheduler onto the owner role.
4. Introduce `sql.forOrganization` and route every tenant request through it; add a test that a handler without it returns no rows.
5. Enable policies table by table in **permissive logging mode first** (policies created, role still bypassing, a canary query comparing results), then
   switch the app role over; keep `routeIsolation.test.ts` as the regression suite and add an RLS-specific variant that runs it with
   `legalio_app`.
6. Operational notes: `pg_dump` must run as the owner role; `EXPLAIN` the hot paths (organization_id is already the leading index column on every
   `idx_v3_*`/`idx_v5_*` index, so the policy predicate is index-friendly).

## Risks

* A missing `set_config` silently hides all data (fail closed, but looks like an outage): needs an explicit health probe under the app role.
* `SECURITY DEFINER` functions and views bypass policies unless declared with `security_invoker`.
* Prepared-statement or pooler setups (PgBouncer transaction mode) are compatible only because the setting is transaction-local.
