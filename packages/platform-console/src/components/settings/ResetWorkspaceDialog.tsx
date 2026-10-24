import { AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useEffect, useId, useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { api } from '@legalio/shared/apiClient';
import { localize } from '@legalio/shared/policy';
import { Button } from '@legalio/ui-components/button';

import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Dialog, DialogBackdrop, DialogBody, DialogCloseIcon, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPositioner, DialogTitle } from '@legalio/ui-components/dialog';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemHiddenInput, RadioGroupItemText, RadioGroupLabel } from '@legalio/ui-components/radio-group';
import { Text } from '@legalio/ui-components/text';
type ResetMode = 'empty' | 'demo';

type ResetStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

export interface ResetWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the server message after a successful reset. */
  onDone: (message: string, defaultOrgId: string) => void;
}


/**
 * Superuser "reset & set up" flow: wipe business data, then either create
 * one organization from a chosen country/industry profile or reload the
 * multi-country demo workspace.
 */
export const ResetWorkspaceDialog: React.FC<ResetWorkspaceDialogProps> = ({ open, onOpenChange, onDone }) => {
  const { t, language } = useLanguage();
  const { countries, industries } = useTenantSettings();
  const [mode, setMode] = useState<ResetMode>('empty');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('INTL');
  const [industry, setIndustry] = useState('general');
  const [confirmText, setConfirmText] = useState('');
  const [status, setStatus] = useState<ResetStatus>({ kind: 'idle' });
  const ids = { name: useId(), country: useId(), industry: useId(), confirm: useId(), confirmHint: useId(), error: useId() };

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setStatus({ kind: 'idle' });
    }
  }, [open]);

  const nameMissing = mode === 'empty' && !name.trim();
  const canSubmit = confirmText.trim() === 'RESET NOW' && !nameMissing && status.kind !== 'running';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (nameMissing) {
      setStatus({ kind: 'error', message: t('settings.reset.org_name_required', 'Enter the organization name.') });
      return;
    }
    if (!canSubmit) return;
    setStatus({ kind: 'running' });
    try {
      const data = await api.post<{ message?: string; defaultOrgId?: string }>('/admin/reset-database', {
        confirmKeyword: confirmText.trim(),
        mode,
        organization: mode === 'empty' ? { name: name.trim(), countryCode, industry, language } : undefined,
      });
      onDone(data.message || '', data.defaultOrgId || '');
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.message || String(err) });
    }
  };

  const modes: Array<{ value: ResetMode; title: string; description: string }> = [
    { value: 'empty', title: t('settings.reset.mode_empty', 'Start empty with my organization'), description: t('settings.reset.mode_empty_desc', 'Removes all data and creates one organization from the profile below.') },
    { value: 'demo', title: t('settings.reset.mode_demo', 'Reload the demo data'), description: t('settings.reset.mode_demo_desc', 'Removes all data and loads the Bank Mindiri demo workspace (Indonesia, Banking) again.') },
  ];

  return (
    <Dialog role="alertdialog" open={open} onOpenChange={(details) => status.kind !== 'running' && onOpenChange(details.open)}>
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent className="flex w-full max-w-g610 flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-status-danger-border bg-status-danger-soft px-g21 py-g13">
            <DialogTitle className="flex items-center gap-g8"><ShieldAlert className="size-g21 text-status-danger" aria-hidden="true" />{t('settings.reset_modal_title', 'Reset workspace')}</DialogTitle>
            <DialogCloseIcon aria-label={t('common.close', 'Close')} />
            <DialogDescription className="text-status-danger">{t('settings.reset_modal_warning', 'This action is permanent and cannot be undone.')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} noValidate aria-busy={status.kind === 'running'} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="mt-0 grid gap-g13 overflow-y-auto px-g21 py-g21 text-foreground">
              <RadioGroup className="grid gap-g8 sm:grid-cols-2" value={mode} onValueChange={(details) => details.value && setMode(details.value as ResetMode)}>
                <RadioGroupLabel className="sm:col-span-2">{t('settings.reset.mode_label', 'After the reset')}</RadioGroupLabel>
                {modes.map((option) => (
                  <RadioGroupItem key={option.value} value={option.value} className="grid h-full w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-g8 gap-y-g3 rounded-lg border border-border p-g13 data-[state=checked]:border-status-danger-border data-[state=checked]:bg-status-danger-soft">
                    <RadioGroupItemControl className="mt-g2" />
                    <span className="grid min-w-0 gap-g3">
                      <RadioGroupItemText className="font-semibold">{option.title}</RadioGroupItemText>
                      <Text as="span" size="sm" tone="muted" className="leading-5">{option.description}</Text>
                    </span>
                    <RadioGroupItemHiddenInput />
                  </RadioGroupItem>
                ))}
              </RadioGroup>

              {mode === 'empty' && (
                <div className="grid gap-g13 sm:grid-cols-2">
                  <Field className="sm:col-span-2" required invalid={status.kind === 'error' && nameMissing}>
                    <FieldLabel htmlFor={ids.name}>{t('settings.reset.org_name', 'Organization name')}</FieldLabel>
                    <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={status.kind === 'error' ? ids.error : undefined} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={ids.country}>{t('settings.region.country', 'Country / jurisdiction pack')}</FieldLabel>
                    <AlphabeticalSelect id={ids.country} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="w-full" controlProps={{ className: 'w-full' }}>
                      {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </AlphabeticalSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={ids.industry}>{t('settings.region.industry', 'Industry pack')}</FieldLabel>
                    <AlphabeticalSelect id={ids.industry} value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full" controlProps={{ className: 'w-full' }}>
                      {industries.map((i) => <option key={i.key} value={i.key}>{localize(i.name, language)}</option>)}
                    </AlphabeticalSelect>
                  </Field>
                </div>
              )}

              <Text size="sm" tone="muted">{t('settings.reset.keeps_accounts', 'Login accounts, AI and e-mail provider settings are kept.')}</Text>

              <Field>
                <FieldLabel htmlFor={ids.confirm}>{t('settings.reset.confirm_hint', 'Type RESET NOW to confirm.')}</FieldLabel>
                <Input id={ids.confirm} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={t('settings.reset_modal_input_placeholder', 'RESET NOW')} autoComplete="off" />
              </Field>

              {status.kind === 'error' && (
                <Alert status="error" id={ids.error} role="alert"><AlertIndicator /><AlertContent><AlertDescription>{status.message}</AlertDescription></AlertContent></Alert>
              )}
            </DialogBody>
            <DialogFooter className="mt-0 border-t border-border px-g21 py-g13">
              <Button variant="outline" disabled={status.kind === 'running'} onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" variant="destructive" loading={status.kind === 'running'} disabled={!canSubmit}>
                <Trash2 aria-hidden="true" />
                {status.kind === 'running' ? t('settings.resetting_db', 'Resetting…') : t('settings.confirm_reset_btn', 'Reset workspace')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogPositioner>
    </Dialog>
  );
};
