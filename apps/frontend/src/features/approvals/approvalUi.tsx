import React from 'react';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import type { ApprovalStatus } from '@legalio/types/approvals';

type T = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

export const LOCALE: Record<string, string> = { ID: 'id-ID', EN: 'en-US', ZH: 'zh-CN' };

export { typeLabel as categoryLabel, typeBadgeTone as categoryTone } from '../../components/documents/documentLabels';

const STATUS: Record<ApprovalStatus, [StatusTone, string]> = {
  pending: ['warning', 'Waiting'],
  approved: ['success', 'Approved'],
  rejected: ['danger', 'Rejected'],
};
export const StatusBadge: React.FC<{ t: T; status: ApprovalStatus; mine?: boolean }> = ({ t, status, mine }) => (
  <Badge tone={STATUS[status][0]}>
    {mine && status === 'pending' ? t('approval.status.waiting_you', 'Waiting for you') : t(`approval.status.${status}`, STATUS[status][1])}
  </Badge>
);

const initials = (name: string | null) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export const PersonAvatar: React.FC<{ name: string | null; size?: 'sm' | 'md' }> = ({ name, size = 'sm' }) => (
  <Avatar size={size} className="shrink-0 bg-primary/10 text-accent-foreground">
    <AvatarFallback className="bg-transparent text-xs font-semibold text-inherit">{initials(name)}</AvatarFallback>
  </Avatar>
);

/** "1j 42m" style remaining time; negative means overdue. */
export function slaLeft(t: T, dueAt: string, now = Date.now()) {
  const ms = new Date(dueAt).getTime() - now;
  const minutes = Math.floor(Math.abs(ms) / 60000);
  const text = `${Math.floor(minutes / 60)}${t('approval.sla.hour_short', 'h')} ${String(minutes % 60).padStart(2, '0')}${t('approval.sla.minute_short', 'm')}`;
  return { overdue: ms < 0, near: ms < 6 * 3600 * 1000, text: ms < 0 ? `-${text}` : text };
}

export const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
