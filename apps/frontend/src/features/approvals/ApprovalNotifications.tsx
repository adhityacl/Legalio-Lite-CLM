import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { approvalsApi } from './approvalsApi';

/** Localizes one personal approval notification (the server stores the kind and the facts, not the sentence). */
function describe(t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string, kind: string, p: Record<string, any>) {
  const vars = { code: String(p.code ?? ''), title: String(p.title ?? '') };
  switch (kind) {
    case 'approval.requested': return t('approval.notif.requested', '{code} "{title}" is waiting for your decision.', vars);
    case 'approval.decided': return p.decision === 'approved'
      ? (p.finished ? t('approval.notif.approved', '{code} "{title}" was approved.', vars) : t('approval.notif.step_approved', 'A step of {code} "{title}" was approved; it moves on.', vars))
      : t('approval.notif.rejected', '{code} "{title}" was rejected.', vars);
    case 'approval.sla_reminder': return t('approval.notif.sla_reminder', '{code} "{title}" is close to its SLA deadline.', vars);
    case 'approval.sla_breach': return p.audience === 'approver'
      ? t('approval.notif.sla_breach_own', '{code} "{title}" is past its SLA deadline and waits for you.', vars)
      : t('approval.notif.sla_breach', '{code} "{title}" is overdue; it was escalated to you.', vars);
    default: return `${vars.code} ${vars.title}`;
  }
}

/** The caller's own unread approval notifications (e-mail copies exist when the mail relay is on). Hidden when there is nothing to show. */
export const ApprovalNotifications: React.FC<{ onOpen?: (id: string) => void }> = ({ onOpen }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ['approval-notifications', activeTenantId];
  const { data } = useQuery({
    queryKey, queryFn: () => approvalsApi.notifications(activeTenantId!), enabled: Boolean(activeTenantId), refetchInterval: 60_000,
  });
  const unread = (data?.notifications ?? []).filter((entry) => !entry.isRead).slice(0, 5);
  if (!unread.length) return null;
  const markAll = async () => { await approvalsApi.markNotificationsRead(activeTenantId!); await queryClient.invalidateQueries({ queryKey }); };
  return (
    <Card className="flex flex-col gap-g8 p-g13" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-g8">
        <Heading as="h3" size="xs" weight="semibold" className="flex items-center gap-g8"><Bell className="size-g16" aria-hidden />{t('approval.notif.title', 'Notifications')} ({data!.unread})</Heading>
        <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()}><CheckCheck aria-hidden />{t('approval.notif.mark_all', 'Mark all as read')}</Button>
      </div>
      <ul className="flex flex-col gap-g5">
        {unread.map((entry) => (
          <li key={entry.id}>
            <Button type="button" variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left font-normal" onClick={() => entry.params.requestId && onOpen?.(String(entry.params.requestId))}>
              <Text as="span" size="sm">{describe(t, entry.kind, entry.params)}</Text>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
