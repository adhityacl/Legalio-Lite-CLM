/** Request bodies of the obligation routes. Zod drops undeclared keys, so the schema is also the whitelist (no source/ledger/version fields from clients). */
import { z } from 'zod';
import { MAX_LEAD_DAYS, MAX_RECURRENCE_INTERVAL, OBLIGATION_RECURRENCES, OBLIGATION_STORED_STATUSES, OBLIGATION_TYPES, isIsoDate } from '@legalio/shared/obligations';

const text = (max: number) => z.string().max(max);
const isoDate = z.string().refine(isIsoDate, 'must be a YYYY-MM-DD date');
const versionField = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,9}$/)]).nullish();

const fields = {
  description: text(5000).nullish(),
  type: z.enum(OBLIGATION_TYPES).optional(),
  due_date: isoDate.nullish(),
  recurrence: z.enum(OBLIGATION_RECURRENCES).optional(),
  recurrence_interval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL).nullish(),
  recurrence_until: isoDate.nullish(),
  contract_id: text(100).nullish(),
  io_id: text(100).nullish(),
  partner_id: text(100).nullish(),
  responsible_user_id: text(100).nullish(),
  responsible_department: text(200).nullish(),
  status: z.enum(OBLIGATION_STORED_STATUSES).optional(),
  lead_days: z.number().int().min(0).max(MAX_LEAD_DAYS).nullish(),
};

export const obligationCreateBody = z.object({ title: text(300).refine((v) => v.trim().length > 0, 'is required'), ...fields });
export const obligationUpdateBody = z.object({ title: text(300).refine((v) => v.trim().length > 0, 'is required').optional(), ...fields, version: versionField });
export const obligationSettingsBody = z.object({ leadDays: z.number().int().min(0).max(MAX_LEAD_DAYS) });
export const obligationCompleteBody = z.object({ version: versionField }).partial();
