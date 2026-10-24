import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Heading } from '@legalio/ui-components/heading';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { apiRequest } from '../../api/client';
import { useAlertToast } from '../../context/AlertToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';

type Preference = 'inherit' | 'off' | 'daily' | 'weekly';
interface PreferenceDto { frequency: Preference; effective: 'off' | 'daily' | 'weekly'; defaults: { frequency: string; weekday: number; hour: number } }
interface DigestItem { kind: string; id: string; reference: string; title: string; date: string | null; days: number | null }
interface DigestDto { today: string; windowDays: number; sections: Record<'noticeDeadlines' | 'expiring' | 'pendingApprovals' | 'overdue', DigestItem[]>; counts: Record<string, number>; empty: boolean }

const SECTIONS = ['overdue', 'noticeDeadlines', 'expiring', 'pendingApprovals'] as const;

/** The member's own digest e-mail choice, with a preview of what it would contain right now. */
export const DigestPreferences: React.FC = () => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [previewing, setPreviewing] = useState(false);
  const selectId = useId();
  const base = `/api/organizations/${encodeURIComponent(activeTenantId ?? '')}/digest`;
  const key = ['digest-preference', activeTenantId];
  const preference = useQuery<PreferenceDto>({ queryKey: key, queryFn: () => apiRequest<PreferenceDto>(`${base}/preferences`), enabled: Boolean(activeTenantId) });
  const preview = useQuery<DigestDto>({ queryKey: ['digest-preview', activeTenantId], queryFn: () => apiRequest<DigestDto>(`${base}/preview`), enabled: Boolean(activeTenantId) && previewing, staleTime: 0, retry: false });

  const change = async (frequency: Preference) => {
    try {
      await apiRequest(`${base}/preferences`, { method: 'PUT', body: { frequency } });
      await queryClient.invalidateQueries({ queryKey: key });
      showAlert({ title: t('digest.saved', 'Digest preference saved.'), variant: 'success' });
    } catch (err) {
      showAlert({ title: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };
  if (!activeTenantId || preference.isError) return null;
  const data = preference.data;
  const label = (frequency: string) => t(`digest.freq.${frequency}`, frequency);
  const sectionTitle: Record<(typeof SECTIONS)[number], string> = {
    overdue: t('digest.section.overdue', 'Overdue'), noticeDeadlines: t('digest.section.notice', 'Notice deadlines coming up'),
    expiring: t('digest.section.expiring', 'Expiring contracts and orders'), pendingApprovals: t('digest.section.approvals', 'Pending approvals'),
  };
  return (
    <Card className="flex flex-col gap-g13 p-g13">
      <div className="flex flex-wrap items-end justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="xs" weight="semibold" className="flex items-center gap-g8"><MailCheck className="size-g16" aria-hidden="true" />{t('digest.title', 'E-mail digest')}</Heading>
          <Text size="sm" className="mt-g3 max-w-prose text-muted-foreground">{t('digest.desc', 'A summary of notice deadlines, expiring contracts, pending approvals and overdue items, limited to what you can see. Every e-mail has an unsubscribe link.')}</Text>
        </div>
        {data ? (
          <div className="flex flex-wrap items-end gap-g8">
            <Field className="min-w-g233">
              <FieldLabel htmlFor={selectId}>{t('digest.frequency', 'Send me the digest')}</FieldLabel>
              <NativeSelect id={selectId} value={data.frequency} onChange={(e) => void change(e.target.value as Preference)}>
                <option value="inherit">{t('digest.freq.inherit', 'Follow the organization default')} ({label(data.defaults.frequency)})</option>
                <option value="off">{label('off')}</option>
                <option value="daily">{label('daily')}</option>
                <option value="weekly">{label('weekly')}</option>
              </NativeSelect>
              <FieldHelperText>{t('digest.effective', 'Currently: {frequency}', { frequency: label(data.effective) })}</FieldHelperText>
            </Field>
            <Button type="button" variant="outline" onClick={() => setPreviewing((v) => !v)} aria-expanded={previewing}>{previewing ? t('digest.hide_preview', 'Hide preview') : t('digest.preview', 'Preview my digest')}</Button>
          </div>
        ) : <Skeleton height={40} />}
      </div>
      {previewing && (preview.isLoading ? <Skeleton height={64} /> : preview.isError ? (
        <Alert status="warning" role="status"><AlertIndicator /><AlertContent><AlertDescription>{t('digest.preview_unavailable', 'There is no digest for this account in this organization.')}</AlertDescription></AlertContent></Alert>
      ) : preview.data!.empty ? (
        <Text size="sm" className="text-muted-foreground">{t('digest.empty', 'Nothing to report right now. A digest with nothing in it is not sent.')}</Text>
      ) : (
        <div className="flex flex-col gap-g13" aria-live="polite">
          {SECTIONS.filter((section) => preview.data!.sections[section].length).map((section) => (
            <div key={section}>
              <Heading as="h4" size="xs" weight="semibold">{sectionTitle[section]} ({preview.data!.sections[section].length})</Heading>
              <ul className="mt-g5 flex flex-col gap-g3 text-sm">
                {preview.data!.sections[section].slice(0, 10).map((item) => (
                  <li key={`${section}-${item.kind}-${item.id}`} className="flex flex-wrap justify-between gap-g8">
                    <span>{item.reference} — {item.title}</span>
                    <span className="text-muted-foreground">{item.date}{item.days !== null ? ` (${item.days})` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
};
