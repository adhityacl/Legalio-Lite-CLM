import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0005_audit_log_immutable',
  name: 'audit_log append-only trigger',
  async up(sql: Sql) {
    await sql.exec(`
    CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF current_setting('legalio.allow_audit_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
    END
    $fn$;
    DO $do$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_immutable' AND tgrelid = 'audit_log'::regclass) THEN
        CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
      END IF;
    END $do$;
  `);
  },
};
