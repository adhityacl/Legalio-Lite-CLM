import { baseline } from './0001_baseline';
import { migration as reminderLedger } from './0002_reminder_ledger';
import { migration as uploadOwners } from './0003_upload_owners';
import { migration as aiUsage } from './0004_ai_usage';
import { migration as auditImmutable } from './0005_audit_log_immutable';
import type { Migration } from './types';

/** Append new migrations at the end with the next number. */
export const MIGRATIONS: Migration[] = [baseline, reminderLedger, uploadOwners, aiUsage, auditImmutable];
export type { Migration };
