import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Per-organization OpenID Connect single sign-on.
 *  - `sso_providers`: one provider per organization (client secret sealed with secretBox, never returned).
 *  - `sso_identities`: the (issuer, subject) pairs linked to local users, per organization. Linking is the only thing that lets a later
 *    login skip the e-mail match, so it is created only by the rules in sso.ts.
 *  - `sso_login_states`: one row per started login (state, nonce, PKCE verifier sealed, hash of the browser-binding cookie); single use.
 */
export const migration: Migration = {
  id: '0026_sso',
  name: 'OIDC single sign-on: providers, linked identities and login states',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS sso_providers (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        enabled boolean NOT NULL DEFAULT false,
        issuer text NOT NULL, client_id text NOT NULL, client_secret_sealed text NOT NULL,
        scopes text NOT NULL DEFAULT 'openid email profile',
        allowed_domains text NOT NULL DEFAULT '[]',
        jit_enabled boolean NOT NULL DEFAULT false,
        default_role text NOT NULL DEFAULT 'viewer', default_department_ids text NOT NULL DEFAULT '[]',
        role_claim text NOT NULL DEFAULT '', role_mapping text NOT NULL DEFAULT '[]', sync_roles boolean NOT NULL DEFAULT false,
        require_sso boolean NOT NULL DEFAULT false, break_glass_user_ids text NOT NULL DEFAULT '[]',
        version integer NOT NULL DEFAULT 1,
        created_at text NOT NULL, updated_at text NOT NULL, updated_by text);
      CREATE TABLE IF NOT EXISTS sso_identities (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        issuer text NOT NULL, subject text NOT NULL,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        email text NOT NULL, created_at text NOT NULL, last_login_at text,
        UNIQUE (organization_id, issuer, subject));
      CREATE INDEX IF NOT EXISTS idx_sso_identities_user ON sso_identities (user_id);
      CREATE TABLE IF NOT EXISTS sso_login_states (
        state_hash text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        nonce text NOT NULL, code_verifier_sealed text NOT NULL, binding_hash text NOT NULL,
        return_to text NOT NULL DEFAULT '', created_at text NOT NULL, expires_at text NOT NULL, consumed_at text);
      CREATE INDEX IF NOT EXISTS idx_sso_login_states_expiry ON sso_login_states (expires_at);
    `);
  },
};
