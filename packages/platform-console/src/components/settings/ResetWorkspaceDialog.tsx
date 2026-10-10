import { AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useEffect, useId, useState } from 'react';
import { Dialog } from 'radix-ui';
import { RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { localize } from '@legalio/shared/policy';
import { Button } from '@legalio/ui-components/button';

import { fieldControlClass } from '@legalio/ui-components/input';
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

const fieldClass = fieldControlClass;
const labelClass = 'mb-1.5 block text-sm font-medium text-ink ';

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
      const res = await fetch('/api/admin/reset-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmKeyword: confirmText.trim(),
          mode,
          organization: mode === 'empty' ? { name: name.trim(), countryCode, industry, language } : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      onDone(data.message || '', data.defaultOrgId || '');
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.message || String(err) });
    }
  };

  const radioClass = (active: boolean) =>
    `flex cursor-pointer gap-3 rounded-xl border p-3 ${active ? 'border-status-danger-border bg-status-danger-soft  dark:bg-status-danger-soft/30' : 'border-hairline '}`;

  return (
    <Dialog.Root open={open} onOpenChange={(value) => status.kind !== 'running' && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-1000 bg-ink/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-1001 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface shadow-2xl">
          <div className="flex items-start gap-3 border-b border-status-danger-border bg-status-danger-soft/60 p-5 dark:border-status-danger-border/40 dark:bg-status-danger-soft/20">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-danger" aria-hidden="true" />
            <div className="flex-1">
              <Dialog.Title className="ds-modal-title flex items-center gap-2">
                {t('settings.reset_modal_title', 'Reset workspace')}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-status-danger">
                {t('settings.reset_modal_warning', 'This action is permanent and cannot be undone.')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-soft hover:bg-surface/60 dark:hover:bg-surface-2" aria-label={t('common.close', 'Close')}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={submit} noValidate aria-busy={status.kind === 'running'} className="space-y-4 p-5">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-ink dark:text-white">{t('settings.reset.mode_label', 'After the reset')}</legend>
              <label className={radioClass(mode === 'empty')}>
                <input type="radio" name="reset-mode" value="empty" checked={mode === 'empty'} onChange={() => setMode('empty')} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{t('settings.reset.mode_empty', 'Start empty with my organization')}</span>
                  <span className="block text-sm text-ink-soft">{t('settings.reset.mode_empty_desc', 'Removes all data and creates one organization from the profile below.')}</span>
                </span>
              </label>
              <label className={radioClass(mode === 'demo')}>
                <input type="radio" name="reset-mode" value="demo" checked={mode === 'demo'} onChange={() => setMode('demo')} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{t('settings.reset.mode_demo', 'Reload the demo data')}</span>
                  <span className="block text-sm text-ink-soft">{t('settings.reset.mode_demo_desc', 'Removes all data and loads the Bank Mindiri demo workspace (Indonesia, Banking) again.')}</span>
                </span>
              </label>
            </fieldset>

            {mode === 'empty' && (
              <div className="grid gap-3 sm:grid-cols-2 ds-grid">
                <div className="sm:col-span-2">
                  <label htmlFor={ids.name} className={labelClass}>{t('settings.reset.org_name', 'Organization name')}</label>
                  <input
                    id={ids.name}
                    className={fieldClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    aria-invalid={status.kind === 'error' && nameMissing}
                    aria-describedby={status.kind === 'error' ? ids.error : undefined}
                  />
                </div>
                <div>
                  <label htmlFor={ids.country} className={labelClass}>{t('settings.region.country', 'Country / jurisdiction pack')}</label>
                  <AlphabeticalSelect id={ids.country} className={fieldClass} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </AlphabeticalSelect>
                </div>
                <div>
                  <label htmlFor={ids.industry} className={labelClass}>{t('settings.region.industry', 'Industry pack')}</label>
                  <AlphabeticalSelect id={ids.industry} className={fieldClass} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                    {industries.map((i) => <option key={i.key} value={i.key}>{localize(i.name, language)}</option>)}
                  </AlphabeticalSelect>
                </div>
              </div>
            )}

            <p className="text-sm text-ink-soft">{t('settings.reset.keeps_accounts', 'Login accounts, AI and e-mail provider settings are kept.')}</p>

            <div>
              <label htmlFor={ids.confirm} className={labelClass}>{t('settings.reset.confirm_hint', 'Type RESET NOW to confirm.')}</label>
              <input
                id={ids.confirm}
                className={`ds-input${fieldClass} `}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t('settings.reset_modal_input_placeholder', 'RESET NOW')}
                autoComplete="off"
              />
            </div>

            {status.kind === 'error' && (
              <p id={ids.error} role="alert" className="ds-alert ds-status-danger border">{status.message}</p>
            )}

            <div className="flex justify-end gap-2 border-t border-hairline pt-4">
              <Dialog.Close asChild>
                <Button size="lg" type="button" variant="outline" disabled={status.kind === 'running'}>
                  {t('common.cancel', 'Cancel')}
                </Button>
              </Dialog.Close>
              <Button size="lg" type="submit" variant="destructive" className="" disabled={!canSubmit}>
                {status.kind === 'running' ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />{t('settings.resetting_db', 'Resetting…')}</>
                ) : (
                  <><Trash2 className="h-4 w-4" aria-hidden="true" />{t('settings.confirm_reset_btn', 'Reset workspace')}</>
                )}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
