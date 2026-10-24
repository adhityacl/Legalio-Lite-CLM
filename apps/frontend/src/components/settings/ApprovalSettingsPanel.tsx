import React, { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Timer } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { orgApi, orgPath } from './orgApi';
import { errorText } from './dialogParts';

interface ApprovalSettingsDto { slaHours: number; escalation: 'admins' | 'next_approver' }

/** Approval SLA and escalation target of this organization. New requests use the SLA; the reminder goes out at 80% of it. */
export const ApprovalSettingsPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().hasPermission('tenant.settings.update');
  const queryKey = ['org-approval-settings', identity?.id, organizationId];
  const query = useQuery<ApprovalSettingsDto>({ queryKey, queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/approval-settings'), { signal }), staleTime: 0 });
  const [hours, setHours] = useState('48');
  const [escalation, setEscalation] = useState<ApprovalSettingsDto['escalation']>('admins');
  const [busy, setBusy] = useState(false);
  const ids = { hours: useId(), escalation: useId() };
  useEffect(() => { if (query.data) { setHours(String(query.data.slaHours)); setEscalation(query.data.escalation); } }, [query.data]);
  const valid = /^\d+$/.test(hours) && Number(hours) >= 1 && Number(hours) <= 720;
  const dirty = query.data ? Number(hours) !== query.data.slaHours || escalation !== query.data.escalation : false;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await orgApi(orgPath(organizationId, '/approval-settings'), { method: 'PUT', body: { slaHours: Number(hours), escalation } });
      showAlert({ title: t('tb.saved', 'Saved.'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby={`${ids.hours}-heading`} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="min-w-0">
        <Heading as="h3" size="sm" weight="semibold" id={`${ids.hours}-heading`} className="flex items-center gap-g8"><Timer className="size-g16" aria-hidden="true" />{t('data.approval.title', 'Approval SLA')}</Heading>
        <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('data.approval.desc', 'Approvers are e-mailed when it is their turn, a reminder goes out when 80% of the SLA has passed, and a breach is escalated. Requests already submitted keep their deadline.')}</Text>
      </div>
      {query.isLoading ? <Skeleton height={64} /> : query.isError ? <Text size="sm" tone="destructive">{t('data.approval.load_failed', 'The approval settings could not be loaded.')}</Text> : (
        <form onSubmit={(event) => void save(event)} noValidate className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.hours}>{t('data.approval.sla_hours', 'SLA (hours)')}</FieldLabel>
            <Input id={ids.hours} type="number" inputMode="numeric" min={1} max={720} value={hours} disabled={!canEdit} aria-invalid={!valid} onChange={(e) => setHours(e.target.value)} />
            <FieldHelperText>{t('data.approval.sla_hint', 'Whole hours from 1 to 720. The default is 48.')}</FieldHelperText>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.escalation}>{t('data.approval.escalation', 'Escalate a breach to')}</FieldLabel>
            <NativeSelect id={ids.escalation} value={escalation} disabled={!canEdit} onChange={(e) => setEscalation(e.target.value as ApprovalSettingsDto['escalation'])}>
              <option value="admins">{t('data.approval.to_admins', 'Organization admins')}</option>
              <option value="next_approver">{t('data.approval.to_next', 'The next approver (admins on the last step)')}</option>
            </NativeSelect>
            <FieldHelperText>{t('data.approval.escalation_hint', 'The delayed approver is always told as well.')}</FieldHelperText>
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!canEdit || !valid || !dirty || busy}>{busy ? t('common.saving', 'Saving…') : t('data.approval.save', 'Save approval settings')}</Button>
          </div>
        </form>
      )}
    </section>
  );
};
