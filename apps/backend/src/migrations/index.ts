import { baseline } from './0001_baseline';
import { migration as reminderLedger } from './0002_reminder_ledger';
import { migration as uploadOwners } from './0003_upload_owners';
import { migration as aiUsage } from './0004_ai_usage';
import { migration as auditImmutable } from './0005_audit_log_immutable';
import { migration as idSequences } from './0006_id_sequences';
import { migration as contractVersions } from './0007_contract_versions';
import { migration as searchTrigram } from './0008_search_trigram';
import { migration as partnerVersions } from './0009_partner_versions';
import { migration as orderVersions } from './0010_order_versions';
import type { Migration } from './types';

/** Append new migrations at the end with the next number. */
export const MIGRATIONS: Migration[] = [baseline, reminderLedger, uploadOwners, aiUsage, auditImmutable, idSequences, contractVersions, searchTrigram, partnerVersions, orderVersions];
export type { Migration };
