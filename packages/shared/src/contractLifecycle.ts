import { deriveContractStatus, normalizeContractStatus, type ContractStatus } from '@legalio/types/domainStatus';
import { daysUntil, type TenantSettings } from './policy/index';

import type { ContractLifecycleFields } from '@legalio/types/lifecycle';
export type { ContractLifecycleFields } from '@legalio/types/lifecycle';

type LifecycleRecord = ContractLifecycleFields & {
  status?: ContractStatus; end_date?: string; auto_renewal?: boolean;
};

export function contractLifecycleMode(record: LifecycleRecord): 'normal' | 'terminated' {
  return record.lifecycle_mode || (normalizeContractStatus(record.status) === 'Terminated' ? 'terminated' : 'normal');
}

export function contractLifecycle(record: LifecycleRecord, settings: Pick<TenantSettings, 'timezone' | 'expiryWarningDays'>, now = new Date()) {
  const terminated = contractLifecycleMode(record) === 'terminated';
  const terminationDays = daysUntil(record.termination_date, settings.timezone, now);
  // Preserve legacy terminated records that predate explicit termination dates.
  const effective = terminated && (terminationDays === null || terminationDays <= 0);
  const daysRemaining = daysUntil(effective && record.termination_date ? record.termination_date : record.end_date, settings.timezone, now);
  const status = effective ? 'Terminated' : deriveContractStatus({ current: 'Active', daysRemaining,
    expiryWarningDays: settings.expiryWarningDays, autoRenewal: !terminated && record.auto_renewal });
  return { status: status as ContractStatus, daysRemaining, scheduled: terminated && !effective };
}

export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Shared by form and API. End date remains independent from a termination date. */
export function validateContractTermination(record: LifecycleRecord & { start_date?: string }): string | null {
  if (record.lifecycle_mode !== undefined && !['normal', 'terminated'].includes(record.lifecycle_mode)) return 'termination.invalid_mode';
  if (contractLifecycleMode(record) !== 'terminated') return null;
  if (!isBusinessDate(record.termination_date)) return 'termination.date_required';
  if (record.start_date && record.termination_date < record.start_date) return 'termination.before_start';
  if (record.end_date && record.termination_date > record.end_date) return 'termination.after_end';
  return null;
}
