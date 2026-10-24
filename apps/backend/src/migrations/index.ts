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
import { migration as spendingVersions } from './0011_spending_versions';
import { migration as evaluationVersions } from './0012_evaluation_versions';
import { migration as notificationVersions } from './0013_notification_versions';
import { migration as templateVersions } from './0014_template_versions';
import { migration as driveBackupIndex } from './0015_drive_backup_index';
import { migration as uploadOwnerTrigram } from './0016_upload_owner_trigram';
import { migration as exportJobs } from './0017_export_jobs';
import { migration as apiKeys } from './0018_api_keys';
import { migration as webhooks } from './0019_webhooks';
import { migration as approvalSlaNotices } from './0020_approval_sla_notices';
import { migration as digest } from './0021_digest';
import type { Migration } from './types';

/** Append new migrations at the end with the next number. */
export const MIGRATIONS: Migration[] = [baseline, reminderLedger, uploadOwners, aiUsage, auditImmutable, idSequences, contractVersions, searchTrigram, partnerVersions, orderVersions, spendingVersions, evaluationVersions, notificationVersions, templateVersions, driveBackupIndex, uploadOwnerTrigram, exportJobs, apiKeys, webhooks, approvalSlaNotices, digest];
export type { Migration };
