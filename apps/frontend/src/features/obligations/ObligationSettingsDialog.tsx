import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { errorMessage } from '../../api/client';
import { obligationsApi } from '../../api/obligations';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';

/** The organization's default reminder lead time (days before the due date). */
export const ObligationSettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const id = useId();
  const settings = useQuery({ queryKey: ['obligations', 'settings'], queryFn: () => obligationsApi.settings(), staleTime: 0 });
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = value ?? String(settings.data?.leadDays ?? 7);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const days = Number(shown);
    if (!Number.isInteger(days) || days < 0 || days > 365) { setError(t('obligations.settings.invalid', 'Enter a whole number of days from 0 to 365.')); return; }
    try {
      await obligationsApi.saveSettings(days);
      showAlert({ title: t('obligations.settings.saved', 'Reminder lead time saved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['obligations'] });
      onClose();
    } catch (err) { setError(errorMessage(err, t('obligations.error.save', 'The obligation could not be saved.'))); }
  };
  return (
    <ModalFrame size="sm" onClose={onClose}>
      <DialogHeader title={t('obligations.reminder_settings', 'Reminders')} onClose={onClose} />
      <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-g13 p-g21">
        <Field>
          <FieldLabel htmlFor={id}>{t('obligations.settings.lead', 'Remind this many days before the due date')}</FieldLabel>
          <Input id={id} type="number" min={0} max={365} value={shown} onChange={(e) => setValue(e.target.value)} />
          <FieldHelperText>{t('obligations.settings.hint', 'The person responsible gets an e-mail and an in-app notice once, and again when the obligation is overdue. An obligation can set its own lead time.')}</FieldHelperText>
        </Field>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={settings.isLoading}>{t('common.save', 'Save')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};
