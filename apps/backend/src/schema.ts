/**
 * PostgreSQL schema, created at boot and safe to run again: better-auth's own migrations first (the module tables
 * reference organization and "user"), then the module tables. server.ts init() runs it before anything reads them.
 */
import { getMigrations } from 'better-auth/db/migration';
import { sql, pool } from './db';
import { authOptions } from './lib/auth';
import { createNormalizedCoreSchema } from './normalizedCoreStore';

export async function ensureSchema() {
  await (await getMigrations(authOptions(pool()))).runMigrations();
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS allowed_users (
      id text PRIMARY KEY, email text NOT NULL UNIQUE, name text, role text, status text,
      "organizationId" text, payload text, "createdAt" text, "updatedAt" text);
    CREATE INDEX IF NOT EXISTS idx_allowed_users_org ON allowed_users ("organizationId");
    CREATE TABLE IF NOT EXISTS branding (id text PRIMARY KEY CHECK (id = 'branding'), "organizationId" text, payload text NOT NULL, "updatedAt" text);
    CREATE TABLE IF NOT EXISTS app_settings (
      id text PRIMARY KEY CHECK (id IN ('app_settings', 'google_config')), "organizationId" text, payload text NOT NULL, "updatedAt" text);
    CREATE TABLE IF NOT EXISTS news_ticker (id text PRIMARY KEY, payload text NOT NULL, "updatedAt" text);
    CREATE TABLE IF NOT EXISTS ai_ocr_cache (cache_key text PRIMARY KEY, payload text NOT NULL, "createdAt" text NOT NULL);
    CREATE TABLE IF NOT EXISTS apikey (
      id text PRIMARY KEY, name text NOT NULL, "keyPreview" text NOT NULL, "keyHash" text NOT NULL, scopes text NOT NULL,
      "createdAt" timestamptz, "expiresAt" timestamptz, status text DEFAULT 'active');

    CREATE TABLE IF NOT EXISTS organization_settings (
      "organizationId" text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, payload text NOT NULL,
      version integer NOT NULL DEFAULT 1, "updatedAt" text NOT NULL, "updatedBy" text REFERENCES "user"(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS organization_integrations (
      "organizationId" text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, "driveFolderId" text, "spreadsheetId" text,
      "legacyAutoSync" integer NOT NULL DEFAULT 0 CHECK ("legacyAutoSync" IN (0,1)), version integer NOT NULL DEFAULT 1,
      "updatedAt" text NOT NULL, "updatedBy" text REFERENCES "user"(id) ON DELETE SET NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_org_integrations_drive
      ON organization_integrations ("driveFolderId") WHERE "driveFolderId" IS NOT NULL AND "driveFolderId" <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_org_integrations_sheet
      ON organization_integrations ("spreadsheetId") WHERE "spreadsheetId" IS NOT NULL AND "spreadsheetId" <> '';
    CREATE TABLE IF NOT EXISTS audit_log (
      id text PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL,
      tenant_id text, department_id text, impersonated_by text, metadata text, created_at text NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log (tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, "appliedAt" text NOT NULL, summary text);
  `);
  await createNormalizedCoreSchema(sql);
  await sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_v5_contracts_status ON contracts (organization_id, status, end_date);
    CREATE INDEX IF NOT EXISTS idx_v5_ios_status ON insertion_orders (organization_id, status, end_date);
    CREATE INDEX IF NOT EXISTS idx_v5_spendings_payment ON spendings (organization_id, payment_status, invoice_date);

    CREATE TABLE IF NOT EXISTS contract_documents (
      id text PRIMARY KEY, organization_id text NOT NULL, name text NOT NULL, type text NOT NULL DEFAULT 'contract',
      status text NOT NULL DEFAULT 'draft', content text NOT NULL DEFAULT '', current_version integer NOT NULL DEFAULT 1,
      file_size integer NOT NULL DEFAULT 0, created_by text NOT NULL, created_at text NOT NULL, modified_by text,
      modified_at text NOT NULL, page_layout text);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_status ON contract_documents (organization_id, status);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_modified ON contract_documents (organization_id, modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_created ON contract_documents (organization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_creator ON contract_documents (organization_id, created_by);
    CREATE TABLE IF NOT EXISTS contract_drafts (
      id text PRIMARY KEY, contract_id text NOT NULL, version_number integer NOT NULL, content text NOT NULL,
      content_hash text NOT NULL, file_size integer NOT NULL, save_kind text NOT NULL DEFAULT 'manual', restored_from integer,
      draft_name text, labels text NOT NULL DEFAULT '[]', saved_by text NOT NULL, created_at text NOT NULL, saved_at text NOT NULL,
      UNIQUE (contract_id, version_number));
    CREATE TABLE IF NOT EXISTS metadata_fields (
      id text PRIMARY KEY, organization_id text NOT NULL, name text NOT NULL, field_type text NOT NULL,
      options text NOT NULL DEFAULT '[]', created_at text NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_metadata_fields_org ON metadata_fields (organization_id);
    CREATE TABLE IF NOT EXISTS document_metadata (
      contract_id text NOT NULL, field_id text NOT NULL, field_value text NOT NULL, updated_at text NOT NULL,
      PRIMARY KEY (contract_id, field_id));
    CREATE INDEX IF NOT EXISTS idx_document_metadata_field ON document_metadata (field_id);
    CREATE TABLE IF NOT EXISTS contract_comments (
      id text PRIMARY KEY, contract_id text NOT NULL, parent_id text, comment_type text NOT NULL, body text NOT NULL DEFAULT '',
      quote text NOT NULL DEFAULT '', new_text text, status text NOT NULL DEFAULT 'open', author_id text NOT NULL,
      created_at text NOT NULL, resolved_by text, resolved_at text);
    CREATE INDEX IF NOT EXISTS idx_contract_comments_contract ON contract_comments (contract_id, status);

    CREATE TABLE IF NOT EXISTS approval_requests (
      id text PRIMARY KEY, organization_id text NOT NULL, code text NOT NULL, title text NOT NULL, category text NOT NULL,
      note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending', current_step integer NOT NULL DEFAULT 1,
      source text NOT NULL, document_id text, file_name text NOT NULL, file_mime text NOT NULL DEFAULT '',
      file_size integer NOT NULL DEFAULT 0, file_data bytea, created_by text NOT NULL, created_at text NOT NULL,
      due_at text NOT NULL, decided_at text);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON approval_requests (organization_id, status);
    CREATE TABLE IF NOT EXISTS approval_steps (
      id text PRIMARY KEY, request_id text NOT NULL, step_no integer NOT NULL, approver_id text NOT NULL,
      status text NOT NULL DEFAULT 'waiting', comment text NOT NULL DEFAULT '', decided_at text, UNIQUE (request_id, step_no));
    CREATE INDEX IF NOT EXISTS idx_approval_steps_approver ON approval_steps (approver_id, status);
    -- seq orders events that share a created_at.
    CREATE TABLE IF NOT EXISTS approval_events (
      id text PRIMARY KEY, seq bigint GENERATED ALWAYS AS IDENTITY, request_id text NOT NULL, actor_id text NOT NULL,
      kind text NOT NULL, message text NOT NULL DEFAULT '', created_at text NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_approval_events_request ON approval_events (request_id, created_at);

    CREATE TABLE IF NOT EXISTS mail_templates (
      id text PRIMARY KEY, subject text NOT NULL, html text NOT NULL, version integer NOT NULL DEFAULT 1, updated_at text NOT NULL);
    CREATE TABLE IF NOT EXISTS integration_credentials (id text PRIMARY KEY, payload text NOT NULL, updated_by text, updated_at text NOT NULL);
    CREATE TABLE IF NOT EXISTS installation_settings (id text PRIMARY KEY CHECK (id = 'installation'), "publicUrl" text NOT NULL);

    -- better-auth does not create these; membership lookups rely on one row per (organization, user).
    CREATE UNIQUE INDEX IF NOT EXISTS uq_member_org_user ON member ("organizationId", "userId");
    CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member ON "teamMember" ("teamId", "userId");
  `);
}
