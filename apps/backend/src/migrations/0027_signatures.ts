import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * E-signature, provider-agnostic.
 *  - `signature_requests` / `signature_signers`: a request to have a contract signed, its ordered signers and the state machine
 *    (draft, sent, partially_signed, completed, declined, expired, cancelled).
 *  - `signature_events`: the persisted audit trail of a request (who did what, when, through which channel).
 *  - `signature_files`: signed copies and evidence, stored in the object store (ownership is registered in upload_owners).
 *  - `signature_endpoints`: per-organization inbound webhook endpoints (HMAC secret sealed, never returned after creation).
 *  - `signature_receipts`: idempotency keys of inbound deliveries (replay protection together with the signed timestamp).
 *  - `signature_notices`: e-mail ledger to the requester (same claim/retry pattern as the approval and obligation notices).
 * Deleting a contract removes its signature requests with it.
 */
export const migration: Migration = {
  id: '0027_signatures',
  name: 'E-signature requests, signers, events, files, inbound endpoints and notices',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS signature_requests (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        contract_id text NOT NULL,
        document_id text,
        title text NOT NULL, message text NOT NULL DEFAULT '',
        mode text NOT NULL DEFAULT 'sequential' CHECK (mode IN ('sequential', 'parallel')),
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'expired', 'cancelled')),
        provider text NOT NULL DEFAULT 'manual', provider_ref text,
        source_file_link text, source_file_name text,
        signed_file_id text, expires_at text,
        requested_by text NOT NULL,
        sent_at text, completed_at text, closed_reason text,
        version integer NOT NULL DEFAULT 1,
        created_at text NOT NULL, updated_at text NOT NULL,
        FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, contract_id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_signature_requests_contract ON signature_requests (organization_id, contract_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_signature_requests_open ON signature_requests (status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_signature_requests_provider_ref ON signature_requests (organization_id, provider_ref);
      CREATE TABLE IF NOT EXISTS signature_signers (
        id text PRIMARY KEY,
        request_id text NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        organization_id text NOT NULL,
        name text NOT NULL, email text NOT NULL, signing_order integer NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'declined')),
        external_id text, signed_at text, decline_reason text,
        created_at text NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_signature_signers_request ON signature_signers (request_id, signing_order);
      CREATE TABLE IF NOT EXISTS signature_events (
        id text PRIMARY KEY,
        request_id text NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        organization_id text NOT NULL,
        type text NOT NULL, actor text NOT NULL, signer_id text, detail text NOT NULL DEFAULT '{}',
        created_at text NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_signature_events_request ON signature_events (request_id, created_at, id);
      CREATE TABLE IF NOT EXISTS signature_files (
        id text PRIMARY KEY,
        request_id text NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        organization_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('signed', 'evidence')),
        file_name text NOT NULL, storage_key text NOT NULL, link text NOT NULL,
        content_type text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL,
        uploaded_by text NOT NULL, created_at text NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_signature_files_request ON signature_files (request_id, created_at);
      CREATE TABLE IF NOT EXISTS signature_endpoints (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL, secret_sealed text NOT NULL, enabled boolean NOT NULL DEFAULT true,
        created_by text, created_at text NOT NULL, rotated_at text, last_received_at text);
      CREATE INDEX IF NOT EXISTS idx_signature_endpoints_org ON signature_endpoints (organization_id, created_at);
      CREATE TABLE IF NOT EXISTS signature_receipts (
        endpoint_id text NOT NULL REFERENCES signature_endpoints(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        outcome text NOT NULL, request_id text, received_at text NOT NULL,
        PRIMARY KEY (endpoint_id, idempotency_key));
      CREATE INDEX IF NOT EXISTS idx_signature_receipts_time ON signature_receipts (received_at);
      CREATE TABLE IF NOT EXISTS signature_notices (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        request_id text NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        kind text NOT NULL, recipient_id text NOT NULL, payload text NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
        attempts integer NOT NULL DEFAULT 0, next_attempt_at text, last_error text,
        created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
        UNIQUE (request_id, kind, recipient_id));
      CREATE INDEX IF NOT EXISTS idx_signature_notices_due ON signature_notices (status, next_attempt_at);
    `);
  },
};
