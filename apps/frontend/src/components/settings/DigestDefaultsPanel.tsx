import React, { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Heading } from '@legalio/ui-components/heading';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { orgApi, orgPath } from './orgApi';
import { errorText } from './dialogParts';

interface DefaultsDto { frequency: 'off' | 'daily' | 'weekly'; weekday: number; hour: number }
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** The organization's default for the digest e-mail. Members can still choose differently for themselves (Notifications page). */
export const DigestDefaultsPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().hasPermission('tenant.settings.update');
  const queryKey = ['org-digest-defaults', identity?.id, organizationId];
  const query = useQuery<DefaultsDto>({ queryKey, queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/digest/defaults'), { signal }), staleTime: 0 });
  const [draft, setDraft] = useState<DefaultsDto>({ frequency: 'off', weekday: 1, hour: 8 });
  const [busy, setBusy] = useState(false);
  const ids = { frequency: useId(), weekday: useId(), hour: useId() };
  useEffect(() => { if (query.data) setDraft({ frequency: query.data.frequency, weekday: query.data.weekday, hour: query.data.hour }); }, [query.data]);
  const dirty = query.data ? JSON.stringify(draft) !== JSON.stringify({ frequency: query.data.frequency, weekday: query.data.weekday, hour: query.data.hour }) : false;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await orgApi(orgPath(organizationId, '/digest/defaults'), { method: 'PUT', body: draft });
      showAlert({ title: t('tb.saved', 'Saved.'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby={`${ids.frequency}-heading`} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="min-w-0">
        <Heading as="h3" size="sm" weight="semibold" id={`${ids.frequency}-heading`} className="flex items-center gap-g8"><MailCheck className="size-g16" aria-hidden="true" />{t('data.digest.title', 'Digest e-mail default')}</Heading>
        <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('data.digest.desc', 'Members receive a daily or weekly summary of what needs attention, limited to what they can see. This is the default for members who have not chosen for themselves; a change takes effect from the next send time. The time follows the organization time zone.')}</Text>
      </div>
      {query.isLoading ? <Skeleton height={64} /> : query.isError ? <Text size="sm" tone="destructive">{t('data.digest.load_failed', 'The digest settings could not be loaded.')}</Text> : (
        <form onSubmit={(event) => void save(event)} className="grid gap-g13 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor={ids.frequency}>{t('data.digest.frequency', 'Default')}</FieldLabel>
            <NativeSelect id={ids.frequency} value={draft.frequency} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as DefaultsDto['frequency'] })}>
              <option value="off">{t('digest.freq.off', 'Off')}</option>
              <option value="daily">{t('digest.freq.daily', 'Daily')}</option>
              <option value="weekly">{t('digest.freq.weekly', 'Weekly')}</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.weekday}>{t('data.digest.weekday', 'Weekly on')}</FieldLabel>
            <NativeSelect id={ids.weekday} value={draft.weekday} disabled={!canEdit || draft.frequency !== 'weekly'} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((day) => <option key={day} value={day}>{t(`data.digest.day.${day}`, String(day))}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.hour}>{t('data.digest.hour', 'Send at')}</FieldLabel>
            <NativeSelect id={ids.hour} value={draft.hour} disabled={!canEdit || draft.frequency === 'off'} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </NativeSelect>
            <FieldHelperText>{t('data.digest.hour_hint', 'In the organization time zone.')}</FieldHelperText>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={!canEdit || !dirty || busy}>{busy ? t('common.saving', 'Saving…') : t('data.digest.save', 'Save digest default')}</Button>
          </div>
        </form>
      )}
    </section>
  );
};
